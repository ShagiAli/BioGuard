/**
 * In-app reminder stream.
 *
 * Every route here is scoped by `oversees()`: an engineer sees the
 * reminders addressed to them, an administrator or manager sees the
 * whole programme. The scope goes into the `where` clause rather than
 * being filtered after the fact, so an out-of-scope row is never read.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { oversees, requireAuth } from "../../middleware/auth.js";

export const notificationsRouter = Router();

/** Same shape as the equipment list, so paging behaves identically. */
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

notificationsRouter.get("/", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Unrecognised filter." });

  const { page, pageSize } = parsed.data;
  const all = oversees(req.user!);
  const where = all ? {} : { recipientId: req.user!.id };

  // The unread figure is counted rather than derived from `rows`: the
  // list is a page, so counting within it would report the unread badge
  // for one page instead of the mailbox.
  const [total, rows, unread] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        equipment: { select: { id: true, name: true, assetNo: true } },
        recipient: { select: { id: true, fullName: true } },
      },
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  res.json({ total, page, pageSize, rows, unread, scope: all ? "all" : "own" });
});

notificationsRouter.post("/read-all", requireAuth, async (req, res) => {
  const where = oversees(req.user!) ? {} : { recipientId: req.user!.id };
  await prisma.notification.updateMany({
    where: { ...where, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
});
