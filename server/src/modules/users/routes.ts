/**
 * The people the system writes to.
 *
 * Until now accounts existed only because the seed created them, which
 * meant an address could be changed in one place: the database. For a
 * system whose whole purpose is that the right person hears about the
 * right device, "ask someone with SQL access" is not an answer.
 *
 * Passwords are deliberately absent. Nobody sets another person's
 * password here, not even an administrator — a new or corrected address
 * goes through the reset flow, so the only person who ever knows the
 * password is the person it belongs to. That also means changing
 * somebody's email hands them their account rather than taking it.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { recordAudit } from "../../lib/audit.js";
import { generateToken, hashPassword, hashToken } from "../../lib/security.js";
import { sendMail } from "../../lib/email.js";
import { ROLE_LABELS, ROLE_MEANING } from "../../lib/roles.js";
import { env } from "../../env.js";

export const usersRouter = Router();

/**
 * Read from the generated client rather than written out again.
 *
 * This was a hand-kept array, and it drifted the moment a role was
 * added: the schema, the database and the frontend all knew about the
 * new one, while the form that assigns roles validated against a list
 * that did not. Choosing it returned "Check the details." — a message
 * about the submission, for a fault entirely in the receiver.
 *
 * Nothing in the compiler could have caught that. The array was a
 * standalone const with no relationship to Prisma's enum, so the two
 * were free to disagree. Derived, they cannot.
 */
const ROLES = Object.values(Role) as [Role, ...Role[]];

/** Never includes passwordHash, and cannot be widened into doing so. */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
} as const;

/**
 * What a person still holds.
 *
 * Completed work is deliberately absent. A service James signed stays
 * James's for ever — that is the record an inspector reads, and moving
 * it would say somebody serviced a device before they were hired. Only
 * live obligations transfer.
 */
async function liveWork(userId: string) {
  const [devices, alerts, workOrders] = await Promise.all([
    prisma.equipment.count({
      where: { engineerId: userId, operationalStatus: { not: "RETIRED" } },
    }),
    prisma.alert.count({
      where: { assignedToId: userId, status: { notIn: ["RESOLVED", "CANCELLED"] } },
    }),
    prisma.workOrder.count({
      where: { engineerId: userId, status: { notIn: ["CLOSED", "CANCELLED"] } },
    }),
  ]);
  return { devices, alerts, workOrders, total: devices + alerts + workOrders };
}

/**
 * What the record would lose if this account were erased.
 *
 * Different from liveWork, which asks whether somebody can leave today.
 * This asks whether they can be forgotten, and the answer is almost
 * always no: an engineer who signed a service is part of that device's
 * history for as long as the device exists, and a hospital that cannot
 * say who worked on a ventilator has a maintenance record worth
 * nothing.
 *
 * The database enforces this already — these relations are required and
 * do not cascade, so the delete fails on a foreign key. Counting first
 * turns that into an answer with numbers in it rather than a 500 and a
 * constraint name.
 *
 * Sessions, reset tokens, notifications and saved views are absent on
 * purpose. They cascade, and none of them is a record of anything: they
 * are what the account was doing, not what the person did.
 */
async function historyOf(userId: string) {
  const [services, alerts, workOrders, notes, devices, actions] = await Promise.all([
    prisma.maintenanceRecord.count({ where: { engineerId: userId } }),
    prisma.alert.count({ where: { raisedById: userId } }),
    prisma.workOrder.count({ where: { engineerId: userId } }),
    prisma.note.count({ where: { authorId: userId } }),
    prisma.equipment.count({ where: { engineerId: userId } }),
    prisma.auditLog.count({ where: { actorId: userId } }),
  ]);

  return {
    services,
    alerts,
    workOrders,
    notes,
    devices,
    actions,
    total: services + alerts + workOrders + notes + devices + actions,
  };
}

/**
 * Roles a manager may not grant, edit or remove.
 *
 * Administrators were the only protected role, which closed one version
 * of the attack and left its twin open. The review step exists so that a
 * repair is signed by one person and accepted by another; a manager who
 * could make somebody a head of engineering, or quietly take over the one
 * who exists, could be both. So the reviewer is protected the way an
 * administrator is, and for the same reason.
 */
const PROTECTED_FROM_MANAGERS: readonly Role[] = ["ADMIN", "HEAD_OF_ENGINEERING"];

const PROTECTED = {
  error: "Only an administrator can manage administrators and heads of engineering.",
};

function managerOverreach(actorRole: Role, ...roles: (Role | undefined)[]): boolean {
  return actorRole !== "ADMIN" && roles.some((r) => r && PROTECTED_FROM_MANAGERS.includes(r));
}

/**
 * Whether a real person is using this account.
 *
 * The line that decides who may redirect it. An account created by
 * invitation has a password nobody knows, so until its owner sets one
 * nobody can have used it — correcting its address is fixing a typo, and
 * a manager should be able to. Once somebody has set a password, or
 * signed in at all, the address is how that person recovers their account,
 * and whoever changes it chooses where the next reset link goes.
 *
 * Sessions count as well as passwords because seeded accounts sign in
 * with a known password and never set their own. Both signals are
 * durable: logging out revokes a session rather than deleting it, and
 * nothing deletes them otherwise. The second of slack absorbs the two
 * separate defaults that stamp createdAt and passwordChangedAt when a row
 * is first written.
 */
async function isEstablished(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, passwordChangedAt: true },
  });
  if (!user) return false;
  if (user.passwordChangedAt.getTime() - user.createdAt.getTime() > 1000) return true;
  return (await prisma.session.count({ where: { userId } })) > 0;
}

/** Enough of an address to recognise, not enough to hand anybody. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "an address you do not recognise";
  return `${email[0]}${"\u2022".repeat(Math.max(3, at - 1))}${email.slice(at)}`;
}

const createSchema = z
  .object({
    email: z.email().max(254).trim().toLowerCase(),
    fullName: z.string().min(1).max(120).trim(),
    role: z.enum(ROLES),
    departmentId: z.uuid().nullable().optional(),
  })
  .strict();

const handoverSchema = z.object({ toId: z.uuid() }).strict();

const updateSchema = z
  .object({
    // Lowercased because the login lookup is exact and a capitalised
    // address would simply fail to match, silently.
    email: z.email().max(254).trim().toLowerCase().optional(),
    fullName: z.string().min(1).max(120).trim().optional(),
    role: z.enum(ROLES).optional(),
    departmentId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });

/**
 * Ordered so the list reads as an organisation rather than an alphabet:
 * who answers for the estate, then who triages, then who fixes things.
 */
const ORDER: Prisma.UserOrderByWithRelationInput[] = [{ role: "asc" }, { fullName: "asc" }];

usersRouter.get("/", requireAuth, requireRole("ADMIN", "MANAGER"), async (_req, res) => {
  const rows = await prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: ORDER });
  res.json({ rows });
});

/**
 * A new colleague.
 *
 * No password is set here. The account is created with one nobody
 * knows — random bytes, hashed, never shown — and an invitation goes out
 * on the same path a forgotten password uses. So the only person who
 * ever knows the password is the person it belongs to, and an
 * administrator cannot sign in as somebody they hired.
 */
usersRouter.post("/", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Check the details.",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const actor = req.user!;
  if (managerOverreach(actor.role, parsed.data.role)) {
    return res.status(403).json(PROTECTED);
  }

  if (parsed.data.departmentId) {
    const exists = await prisma.department.count({ where: { id: parsed.data.departmentId } });
    if (exists === 0) return res.status(400).json({ error: "That department does not exist." });
  }

  try {
    const created = await prisma.user.create({
      data: {
        ...parsed.data,
        departmentId: parsed.data.departmentId ?? null,
        // Unguessable and never communicated. The invitation below is
        // the only way in.
        passwordHash: await hashPassword(generateToken(32)),
      },
      select: { ...PUBLIC_FIELDS, departmentId: true },
    });

    const token = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: created.id,
        tokenHash: hashToken(token),
        // Longer than a reset: an invitation may arrive while somebody
        // is not yet at a desk, and a dead link on day one is a support
        // request rather than a security control.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      },
    });

    await sendMail({
      to: created.email,
      subject: "Your BioGuard account",
      text:
        `An account has been created for you on BioGuard.\n\n` +
        `Set your password within 7 days:\n\n` +
        `${env.APP_URL}/reset-password?token=${token}\n\n` +
        `You will sign in with this address.`,
    });

    await recordAudit({
      actorId: actor.id,
      action: "user.created",
      entity: "User",
      entityId: created.id,
      after: created,
    });

    res.status(201).json(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Another account already uses that email address." });
    }
    throw err;
  }
});

/** What would have to move before this person could be deactivated. */
usersRouter.get("/:id/workload", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "User not found." });

  const exists = await prisma.user.count({ where: { id: id.data } });
  if (exists === 0) return res.status(404).json({ error: "User not found." });

  res.json(await liveWork(id.data));
});

/**
 * Hand a leaver's live work to somebody who is staying.
 *
 * One transaction, because a half-moved handover is worse than none: the
 * devices would be watched by the new engineer while the open repair
 * still sat with a person who has gone.
 */
usersRouter.post(
  "/:id/handover",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: "User not found." });

    const parsed = handoverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose who takes this on." });
    if (parsed.data.toId === id.data) {
      return res.status(400).json({ error: "Choose somebody other than the person leaving." });
    }

    const [from, to] = await Promise.all([
      prisma.user.findUnique({ where: { id: id.data }, select: { id: true, fullName: true } }),
      prisma.user.findUnique({
        where: { id: parsed.data.toId },
        select: { id: true, fullName: true, role: true, isActive: true },
      }),
    ]);
    if (!from) return res.status(404).json({ error: "User not found." });

    // Devices, alerts and work orders all name an engineer. Handing them
    // to anybody else would put work where the application will not let
    // the recipient act on it.
    if (!to || !to.isActive || to.role !== "ENGINEER") {
      return res.status(400).json({ error: "Work can only be handed to an active engineer." });
    }

    const before = await liveWork(from.id);

    await prisma.$transaction([
      prisma.equipment.updateMany({
        where: { engineerId: from.id, operationalStatus: { not: "RETIRED" } },
        data: { engineerId: to.id },
      }),
      prisma.alert.updateMany({
        where: { assignedToId: from.id, status: { notIn: ["RESOLVED", "CANCELLED"] } },
        data: { assignedToId: to.id },
      }),
      prisma.workOrder.updateMany({
        where: { engineerId: from.id, status: { notIn: ["CLOSED", "CANCELLED"] } },
        data: { engineerId: to.id },
      }),
    ]);

    await recordAudit({
      actorId: req.user!.id,
      action: "user.handover",
      entity: "User",
      entityId: from.id,
      before: { fullName: from.fullName },
      after: { fullName: to.fullName },
    });

    res.json({ moved: before, to: { id: to.id, fullName: to.fullName } });
  }
);

usersRouter.patch("/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "User not found." });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Check the details.",
      issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }

  const target = await prisma.user.findUnique({
    where: { id: id.data },
    select: { ...PUBLIC_FIELDS, departmentId: true },
  });
  if (!target) return res.status(404).json({ error: "User not found." });

  const actor = req.user!;
  const changes = parsed.data;

  /**
   * A manager may not touch an administrator or a head of engineering,
   * nor make either.
   *
   * Without this the escalation is two steps and needs no password: set
   * their email to your own, and the reset link comes to you. It was
   * closed for administrators only, which left the reviewer open — and a
   * manager who could become the reviewer could accept a repair signed in
   * somebody else's name.
   */
  if (managerOverreach(actor.role, target.role, changes.role)) {
    return res.status(403).json(PROTECTED);
  }

  // Locking yourself out is not a thing the interface should let you do
  // by accident, and it is never what was meant.
  if (target.id === actor.id) {
    if (changes.isActive === false) {
      return res.status(409).json({ error: "You cannot deactivate your own account." });
    }
    if (changes.role && changes.role !== target.role) {
      return res.status(409).json({ error: "You cannot change your own role." });
    }
  }

  /**
   * The estate must keep an administrator.
   *
   * Checked against the database rather than a count held in memory,
   * because the answer changes with every other edit in flight.
   */
  const losingAdmin =
    target.role === "ADMIN" &&
    ((changes.role && changes.role !== "ADMIN") || changes.isActive === false);

  if (losingAdmin) {
    const remaining = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: target.id } },
    });
    if (remaining === 0) {
      return res.status(409).json({ error: "This is the last active administrator." });
    }
  }

  /**
   * Nobody leaves holding live work.
   *
   * Deactivating an engineer who still watches devices does not stop the
   * reminders — it makes them silent, addressed to somebody who has
   * gone. So the work moves first, and the refusal says how much of it
   * there is rather than only that there is some.
   */
  if (changes.isActive === false) {
    const held = await liveWork(target.id);
    if (held.total > 0) {
      const parts = [
        held.devices && `${held.devices} device${held.devices === 1 ? "" : "s"}`,
        held.alerts && `${held.alerts} open alert${held.alerts === 1 ? "" : "s"}`,
        held.workOrders && `${held.workOrders} open work order${held.workOrders === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return res.status(409).json({
        error: `Hand over their work first: ${parts.join(", ")}.`,
        workload: held,
      });
    }
  }

  if (changes.departmentId) {
    const exists = await prisma.department.count({ where: { id: changes.departmentId } });
    if (exists === 0) return res.status(400).json({ error: "That department does not exist." });
  }

  /**
   * A corrected address has to reach the person it now belongs to, and
   * has to stop reaching the one it does not.
   *
   * The docblock at the top of this file has always said a corrected
   * address goes through the reset flow. It did not: the row changed and
   * nothing was sent, which is merely unhelpful when the old address was
   * a typo of the right person's, and considerably worse when it was
   * somebody else's mailbox. That invitation is a live seven-day link to
   * an account with a role attached, sitting in a stranger's inbox, and
   * correcting the address did nothing to it.
   *
   * So both halves happen together: every outstanding link dies, and a
   * new one goes to the new address. Sessions are left alone on purpose
   * — setting a password already revokes them all, so if the wrong
   * person did get in, the right person accepting this invitation is
   * what puts them out.
   */
  const emailChanged = !!changes.email && changes.email !== target.email;

  /*
   * Redirecting an account somebody uses is an administrator's decision.
   *
   * The protected roles above are one half. This is the other: an
   * engineer's account is not protected by role, but it signs maintenance
   * records, and a manager who could point it at their own inbox would
   * receive the link that makes them that engineer. So a manager may still
   * correct the address on an invitation nobody has taken up — which is
   * what the feature is for — but not on an account that is in use.
   */
  const established = emailChanged ? await isEstablished(target.id) : false;
  if (emailChanged && established && actor.role !== "ADMIN") {
    return res.status(403).json({
      error:
        "This person already uses their account, so only an administrator can change the " +
        "address it signs in with.",
    });
  }

  const invite = emailChanged ? generateToken() : null;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: target.id },
        data: changes,
        select: { ...PUBLIC_FIELDS, departmentId: true },
      });

      if (invite) {
        // Anything already issued was sent to the previous address.
        await tx.passwordResetToken.updateMany({
          where: { userId: target.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: target.id,
            tokenHash: hashToken(invite),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
          },
        });
      }

      return saved;
    });

    if (invite) {
      /*
       * Tell the address it used to be.
       *
       * Only for an account in use. A takeover that locks somebody out
       * with no word to the inbox they actually read looks, from their
       * side, like being signed out for no reason; this is the message
       * that makes it look like what it is. An invitation nobody took up
       * gets no such notice, because its old address is usually the typo
       * being corrected — possibly a stranger's inbox, and not one to send
       * details of the account to.
       */
      if (established) {
        await sendMail({
          to: target.email,
          subject: "Your BioGuard sign-in address was changed",
          text:
            `The address you sign in to BioGuard with was changed to ` +
            `${maskEmail(updated.email)} by ${actor.fullName}.\n\n` +
            `If you expected this, there is nothing to do. If you did not, contact an ` +
            `administrator straight away: the account will no longer accept this address, ` +
            `and a link to set its password has gone to the new one.`,
        });
      }

      /*
       * Worded for someone who may already have a password and someone
       * who never had one, because the record cannot tell them apart:
       * passwordChangedAt is set at creation, so "never set" and "set
       * on the first day" look identical.
       */
      await sendMail({
        to: updated.email,
        subject: "Your BioGuard sign-in address has changed",
        text:
          `Your sign-in address for BioGuard is now ${updated.email}.\n\n` +
          `Use it the next time you sign in. If you have not set a password ` +
          `yet, or you need a new one, follow this link within 7 days:\n\n` +
          `${env.APP_URL}/reset-password?token=${invite}\n\n` +
          `Any link sent to your previous address has stopped working.`,
      });
    }

    /*
     * Tell somebody when what they are allowed to do has changed.
     *
     * A role decides what the application shows a person, what it lets
     * them do and what it writes to them about, so changing one silently
     * is changing their job without saying so. The first they would know
     * is a page missing from the sidebar, or reminders that stopped — or
     * worse, a button they now hold that nobody mentioned, like the one
     * that returns a device to a ward.
     *
     * Says what the new role means rather than only its name, because
     * "Head of engineering" tells nobody that they now accept repairs.
     * And says who made the change, which is the first question anybody
     * asks about a change to their own account.
     *
     * To the address as it stands after this edit, in case it changed in
     * the same save. Not to somebody who has just been deactivated: a
     * person leaving does not need to be told what their new job is.
     */
    if (changes.role && changes.role !== target.role && updated.isActive) {
      const from = ROLE_LABELS[target.role];
      const to = ROLE_LABELS[changes.role];

      await sendMail({
        to: updated.email,
        subject: "Your BioGuard role has changed",
        text:
          `Your role in BioGuard has changed from ${from} to ${to}. ` +
          `The change was made by ${actor.fullName}.\n\n` +
          `As ${to}, ${ROLE_MEANING[changes.role]}\n\n` +
          `It takes effect straight away. If you have BioGuard open, reload the page to see it.\n\n` +
          `Open BioGuard: ${env.APP_URL}`,
      });
    }

    await recordAudit({
      actorId: actor.id,
      action: "user.updated",
      entity: "User",
      entityId: target.id,
      before: target,
      after: updated,
    });

    res.json(updated);
  } catch (err) {
    // The unique index on email is the guarantee; this turns it into an
    // answer rather than a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Another account already uses that email address." });
    }
    throw err;
  }
});

/**
 * Erase an account that never became part of the record.
 *
 * Deactivating is the normal end of a working relationship, and it is
 * what the People page does: the person stops receiving mail and stops
 * being able to sign in, and everything they did stays attached to their
 * name. That is the right default, and it is why this refuses anybody
 * with history rather than offering to cascade.
 *
 * What it is for is the other case: an address typed wrongly, a
 * colleague invited who never arrived, a duplicate. Those accounts are
 * not history, they are clutter, and keeping them forever only makes the
 * list harder to read.
 *
 * Deactivate first, always. Two steps rather than one, because the
 * button that ends somebody's access and the button that erases them
 * should not be adjacent, and because an active account with no history
 * is usually somebody who started yesterday.
 */
usersRouter.delete("/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "User not found." });

  const target = await prisma.user.findUnique({
    where: { id: id.data },
    select: { ...PUBLIC_FIELDS, departmentId: true },
  });
  if (!target) return res.status(404).json({ error: "User not found." });

  const actor = req.user!;

  // The same protection the patch route applies: a manager who could
  // delete the protected roles could clear the way to grant them.
  if (managerOverreach(actor.role, target.role)) {
    return res.status(403).json(PROTECTED);
  }

  if (target.id === actor.id) {
    return res.status(409).json({ error: "You cannot delete your own account." });
  }

  if (target.isActive) {
    return res.status(409).json({
      error: "Deactivate the account first. Only a closed account can be deleted.",
    });
  }

  const history = await historyOf(target.id);
  if (history.total > 0) {
    const parts = [
      history.services && `${history.services} service${history.services === 1 ? "" : "s"} signed`,
      history.workOrders && `${history.workOrders} repair${history.workOrders === 1 ? "" : "s"}`,
      history.alerts && `${history.alerts} fault${history.alerts === 1 ? "" : "s"} reported`,
      history.notes && `${history.notes} note${history.notes === 1 ? "" : "s"}`,
      history.devices && `${history.devices} device${history.devices === 1 ? "" : "s"}`,
      history.actions && `${history.actions} recorded action${history.actions === 1 ? "" : "s"}`,
    ].filter(Boolean);

    return res.status(409).json({
      error:
        `This account is part of the record: ${parts.join(", ")}. ` +
        `It stays closed rather than deleted, so the history keeps their name.`,
      history,
    });
  }

  // Audited before the row goes, because afterwards there is nothing to
  // describe and the actorId would be the only thing left pointing at it.
  await recordAudit({
    actorId: actor.id,
    action: "user.deleted",
    entity: "User",
    entityId: target.id,
    before: target,
  });

  await prisma.user.delete({ where: { id: target.id } });

  res.status(204).end();
});
