/**
 * Authentication, authorisation and query scoping.
 *
 * Two rules drive the design:
 *
 *  1. Default deny. A route that does not declare a permission is
 *     unreachable, not public. Forgetting an annotation fails closed.
 *  2. Role checks are not enough. A device belonging to another
 *     department is an IDOR even when the caller's role is correct, so
 *     every query carries a scope derived from the session.
 */

import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../lib/security.js";

export const SESSION_COOKIE = "bg_session";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  departmentId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

/**
 * Resolves the session cookie. Does not reject on its own — that is
 * `requireAuth`'s job — so public routes can still know who is calling.
 */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  // signedCookies, not cookies: express puts `false` here when the
  // signature does not verify, so a tampered value never reaches the
  // session lookup.
  const raw = req.signedCookies?.[SESSION_COOKIE];
  if (!raw || typeof raw !== "string") return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    !session.user.isActive ||
    // A password change invalidates every session issued before it.
    session.createdAt < session.user.passwordChangedAt
  ) {
    return next();
  }

  req.sessionId = session.id;
  req.user = {
    id: session.user.id,
    email: session.user.email,
    fullName: session.user.fullName,
    role: session.user.role,
    departmentId: session.user.departmentId,
  };
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Sign in to continue." });
  next();
}

/** Explicit allowlist of roles. Anything not listed is refused. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Sign in to continue." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Your role does not allow this action." });
    }
    next();
  };
}

/**
 * The scope filter every equipment query must spread into its `where`.
 * Admins and managers see the estate; engineers and ward staff see
 * their own department. Centralised so it cannot be forgotten per
 * route.
 */
export function equipmentScope(user: SessionUser) {
  // Estate-wide roles. HEAD_OF_ALERTS belongs here because triage is
  // hospital-wide: faults arrive from every ward, and somebody who
  // cannot see the device an alert names cannot judge it. Without this
  // they fall to the department branch below, hold no department, and
  // silently see nothing at all.
  if (user.role === "ADMIN" || user.role === "MANAGER" || user.role === "HEAD_OF_ALERTS") {
    return {};
  }
  if (!user.departmentId) return { id: "00000000-0000-0000-0000-000000000000" }; // matches nothing
  return { departmentId: user.departmentId };
}

/** Fields a ward-staff caller is allowed to see. Costs are not among them. */
export function canSeeCosts(user: SessionUser): boolean {
  return (
    user.role === "ADMIN" ||
    user.role === "ENGINEER" ||
    user.role === "MANAGER" ||
    // Triage weighs a repair against replacing the device, which needs
    // the figures. Ward staff remain the only role without them.
    user.role === "HEAD_OF_ALERTS"
  );
}

/**
 * Whether the caller oversees the whole programme rather than their own
 * workload.
 *
 * Reminders and mail are addressed to the engineer responsible for a
 * device. Administrators and managers hold no equipment of their own, so
 * scoping them to their own inbox would show them an empty list while
 * the estate fills with overdue work — they see the whole stream, and
 * who each item is for.
 *
 * Defined here, beside the other scope helpers, because it decides what
 * a caller may read and delete. Inlining the role comparison at each
 * call site is how the notification rule and the mail rule drift apart.
 */
export function oversees(user: SessionUser): boolean {
  return user.role === "ADMIN" || user.role === "MANAGER";
}

/**
 * Who triages incoming alerts.
 *
 * Deliberately not `oversees()`. That decides who sees the whole
 * preventive programme; this decides who may acknowledge an alert and
 * hand it to an engineer. A manager watching maintenance drift should not
 * silently acquire the power to assign work, which is exactly what would
 * happen if these shared a helper.
 */
export function triagesAlerts(user: SessionUser): boolean {
  return user.role === "ADMIN" || user.role === "HEAD_OF_ALERTS";
}

/**
 * The scope filter every alert query must spread into its `where`.
 *
 * Mirrors equipmentScope: centralised so that omitting it is a visible
 * mistake rather than a silent leak.
 *
 *  - triage roles and managers see the whole stream
 *  - an engineer sees what is assigned to them, plus their department's
 *  - everyone else sees what they raised
 *
 * Ward staff are scoped to what they raised rather than to their
 * department, because an alert is a personal thread: the nurse who
 * reported the fault is the one waiting on an answer.
 */
export function alertScope(user: SessionUser) {
  if (triagesAlerts(user) || user.role === "MANAGER") return {};

  if (user.role === "ENGINEER") {
    return {
      OR: [
        { assignedToId: user.id },
        ...(user.departmentId ? [{ equipment: { departmentId: user.departmentId } }] : []),
      ],
    };
  }

  return { raisedById: user.id };
}
