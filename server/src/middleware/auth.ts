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
  const raw = req.cookies?.[SESSION_COOKIE];
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
  if (user.role === "ADMIN" || user.role === "MANAGER") return {};
  if (!user.departmentId) return { id: "00000000-0000-0000-0000-000000000000" }; // matches nothing
  return { departmentId: user.departmentId };
}

/** Fields a ward-staff caller is allowed to see. Costs are not among them. */
export function canSeeCosts(user: SessionUser): boolean {
  return user.role === "ADMIN" || user.role === "ENGINEER" || user.role === "MANAGER";
}
