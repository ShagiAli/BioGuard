/**
 * Delivered mail, readable inside the app.
 *
 * The `db` mail driver writes messages here instead of to SMTP, so a
 * deployment whose recipients are fictional can still show what the
 * scheduler produced. Scope works the same way as the notification
 * stream: an engineer sees mail addressed to them, oversight roles see
 * the whole outbox — otherwise the administrator who runs the sweep can
 * never see what it sent.
 *
 * Mail is addressed by email string rather than by a user relation, so
 * the scope here is a different code path from `equipmentScope` and
 * carries its own tests.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { oversees, requireAuth } from "../../middleware/auth.js";

export const mailRouter = Router();

/** Same shape as the equipment list, so paging behaves identically. */
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

mailRouter.get("/", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Unrecognised filter." });

  const { page, pageSize } = parsed.data;
  const all = oversees(req.user!);
  const where = all ? {} : { to: req.user!.email };

  // Counted rather than derived from `rows`, for the same reason as the
  // notification badge: `rows` is one page, not the mailbox.
  const [total, rows, unread] = await Promise.all([
    prisma.sentEmail.count({ where }),
    prisma.sentEmail.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sentEmail.count({ where: { ...where, readAt: null } }),
  ]);

  res.json({ total, page, pageSize, rows, unread, scope: all ? "all" : "own" });
});

mailRouter.post("/read-all", requireAuth, async (req, res) => {
  const where = oversees(req.user!) ? {} : { to: req.user!.email };
  await prisma.sentEmail.updateMany({
    where: { ...where, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
});

/**
 * Clear read messages. Declared before the :id route so "read" is never
 * mistaken for an identifier.
 *
 * Only read messages go, and only within the caller's scope — an unread
 * reminder is the one thing a mailbox must not lose.
 */
mailRouter.delete("/read", requireAuth, async (req, res) => {
  const where = oversees(req.user!) ? {} : { to: req.user!.email };
  const { count } = await prisma.sentEmail.deleteMany({
    where: { ...where, readAt: { not: null } },
  });
  res.json({ deleted: count });
});

mailRouter.delete("/:id", requireAuth, async (req, res) => {
  const parsed = z.uuid().safeParse(req.params.id);
  if (!parsed.success) return res.status(404).json({ error: "Message not found." });

  const where = oversees(req.user!) ? {} : { to: req.user!.email };

  // deleteMany rather than delete: the scope goes in the where clause,
  // so a message belonging to someone else matches nothing instead of
  // being deleted by id alone.
  const { count } = await prisma.sentEmail.deleteMany({
    where: { ...where, id: parsed.data },
  });

  if (count === 0) return res.status(404).json({ error: "Message not found." });
  res.status(204).end();
});
