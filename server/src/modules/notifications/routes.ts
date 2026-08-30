/**
 * In-app reminder stream.
 *
 * Every route here is scoped by `oversees()`: an engineer sees the
 * reminders addressed to them, an administrator or manager sees the
 * whole programme. The scope goes into the `where` clause rather than
 * being filtered after the fact, so an out-of-scope row is never read.
 */
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { oversees, requireAuth } from "../../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, async (req, res) => {
  const all = oversees(req.user!);
  const where = all ? {} : { recipientId: req.user!.id };

  // The unread figure is counted, not derived from `rows`. The list is
  // capped at 100, so counting within it would quietly plateau the
  // sidebar badge as soon as a sweep produces more than that.
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        equipment: { select: { id: true, name: true, assetNo: true } },
        recipient: { select: { id: true, fullName: true } },
      },
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  res.json({ rows, unread, scope: all ? "all" : "own" });
});

notificationsRouter.post("/read-all", requireAuth, async (req, res) => {
  const where = oversees(req.user!) ? {} : { recipientId: req.user!.id };
  await prisma.notification.updateMany({
    where: { ...where, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
});
