import { Router } from "express";
import rateLimit from "express-rate-limit";
import { limiterStore } from "../../lib/rateLimitStore.js";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { env, isProd } from "../../env.js";
import { logger } from "../../lib/logger.js";
import { sendMail } from "../../lib/email.js";
import {
  dummyHash,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../../lib/security.js";
import { SESSION_COOKIE, requireAuth } from "../../middleware/auth.js";

export const authRouter = Router();

const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/**
 * Two limiters rather than one.
 *
 * A single key of "ip + email" needs a custom keyGenerator, and a
 * custom generator that handles req.ip must normalise IPv6 itself —
 * express-rate-limit validates this strictly and a loopback ::1 address
 * is enough to trip it. Splitting the concern avoids touching req.ip at
 * all: the default generator handles the address, and a second limiter
 * keyed only on the submitted email covers the account.
 *
 * Both are needed. IP-only is defeated by a botnet; account-only lets
 * one attacker lock every user out of the hospital.
 */
const TOO_MANY = { error: "Too many attempts. Wait a few minutes and try again." };

const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  store: limiterStore("login-ip"),
});

const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.body?.email ?? "unknown").toLowerCase(),
  message: TOO_MANY,
  store: limiterStore("login-account"),
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  store: limiterStore("password-reset"),
});

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict", // primary CSRF defence for a cookie session
    signed: true, // verified in loadSession before any query runs
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

// ------------------------------------------------------------------ login

const loginSchema = z
  .object({
    email: z.email().max(255),
    password: z.string().min(1).max(200),
  })
  .strict();

authRouter.post("/login", loginIpLimiter, loginAccountLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter an email address and password." });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // Same message and comparable cost whether or not the account exists,
  // so login is not an account-enumeration oracle.
  const invalid = () => res.status(401).json({ error: "Email or password is incorrect." });

  if (!user) {
    // Same work as a real verification, so response time does not
    // reveal whether the address is registered.
    await verifyPassword(await dummyHash(), password);
    return invalid();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({
      error: "Too many failed attempts. Try again in a few minutes or reset your password.",
    });
  }

  const ok = user.isActive && (await verifyPassword(user.passwordHash, password));

  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    logger.warn({ userId: user.id, failed }, "failed login");
    return invalid();
  }

  const token = generateToken();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    }),
    prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent")?.slice(0, 255) ?? null,
      },
    }),
  ]);

  setSessionCookie(res, token);
  res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      departmentId: user.departmentId,
    },
  });
});

// ----------------------------------------------------------------- logout

authRouter.post("/logout", requireAuth, async (req, res) => {
  if (req.sessionId) {
    await prisma.session.update({
      where: { id: req.sessionId },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(SESSION_COOKIE, { path: "/", signed: true });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --------------------------------------------------------- password reset

const forgotSchema = z.object({ email: z.email().max(255) }).strict();

authRouter.post("/forgot-password", resetLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);

  // Always the same response. Anything else leaks the staff directory.
  const generic = { message: "If that email is registered, a reset link is on its way." };
  if (!parsed.success) return res.json(generic);

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user || !user.isActive) return res.json(generic);

  const token = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token), // raw token never stored
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });

  await sendMail({
    to: user.email,
    subject: "Reset your BioGuard password",
    text:
      `Open this link within 30 minutes to set a new password:\n\n` +
      `${env.APP_URL}/reset-password?token=${token}\n\n` +
      `If you did not request this, no action is needed.`,
  });

  res.json(generic);
});

const resetSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(12).max(200),
  })
  .strict();

authRouter.post("/reset-password", resetLimiter, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Choose a password of at least 12 characters." });
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: "That reset link has expired. Request a new one." });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(parsed.data.password),
        passwordChangedAt: new Date(), // invalidates every existing session
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  res.json({ message: "Password updated. Sign in with your new password." });
});
