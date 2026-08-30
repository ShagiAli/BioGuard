import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../env.js";
import { recordAudit } from "../../lib/audit.js";
import { canSeeCosts, equipmentScope, requireAuth, requireRole } from "../../middleware/auth.js";
import { addDays, pmState, toDay } from "../../scheduler/rules.js";

export const equipmentRouter = Router();

const uuid = z.uuid();

/** Route params are untrusted. Anything not a UUID is simply not found. */
function parseId(raw: unknown): string | null {
  const parsed = uuid.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The filter axes are shared with the dashboard on purpose. Every
 * headline figure is one of these queries, so a count and the list
 * behind it are produced by the same predicate and cannot disagree.
 */
const listQuery = z
  .object({
    q: z.string().max(120).optional(),
    departmentId: z.uuid().optional(),
    criticality: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
    operationalStatus: z
      .enum([
        "OPERATIONAL",
        "UNDER_MAINTENANCE",
        "UNDER_REPAIR",
        "AWAITING_PARTS",
        "OUT_OF_SERVICE",
        "RETIRED",
      ])
      .optional(),
    pm: z.enum(["OVERDUE", "DUE_30", "DUE_NOW", "DUE_SOON", "SCHEDULED"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

/** Turns a PM filter into a date range over the indexed nextDueAt column. */
function pmWhere(pm: string | undefined, today: Date) {
  switch (pm) {
    case "OVERDUE":
      return { nextDueAt: { lt: today } };
    case "DUE_NOW":
      return { nextDueAt: { gte: today, lte: addDays(today, 7) } };
    case "DUE_SOON":
      return { nextDueAt: { gt: addDays(today, 7), lte: addDays(today, 30) } };
    case "DUE_30":
      return { nextDueAt: { gte: today, lte: addDays(today, 30) } };
    case "SCHEDULED":
      return { nextDueAt: { gt: addDays(today, 30) } };
    default:
      return {};
  }
}

equipmentRouter.get("/", requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Unrecognised filter." });

  const { q, page, pageSize, pm, ...filters } = parsed.data;
  const today = toDay(new Date());

  const where = {
    ...equipmentScope(req.user!), // scope first, always
    ...filters,
    ...pmWhere(pm, today),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { assetNo: { contains: q, mode: "insensitive" as const } },
            { serialNo: { contains: q, mode: "insensitive" as const } },
            { model: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.equipment.count({ where }),
    prisma.equipment.findMany({
      where,
      orderBy: [{ nextDueAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        department: { select: { name: true } },
        manufacturer: { select: { name: true } },
        engineer: { select: { id: true, fullName: true } },
        room: { select: { code: true, floor: true, building: { select: { name: true } } } },
      },
    }),
  ]);

  res.json({
    total,
    page,
    pageSize,
    // publicToken is the key to the unauthenticated scan endpoint. It
    // leaves the server only as a QR image, never in a list payload.
    rows: rows.map(({ publicToken, ...r }) => ({ ...r, pmState: pmState(r.nextDueAt, today) })),
  });
});

/** Dashboard counts. Same predicates as the list, so they always agree. */
equipmentRouter.get("/summary", requireAuth, async (req, res) => {
  const today = toDay(new Date());
  const scope = equipmentScope(req.user!);

  const [total, operational, due30, overdue, criticalOverdue] = await Promise.all([
    prisma.equipment.count({ where: scope }),
    prisma.equipment.count({ where: { ...scope, operationalStatus: "OPERATIONAL" } }),
    prisma.equipment.count({ where: { ...scope, ...pmWhere("DUE_30", today) } }),
    prisma.equipment.count({ where: { ...scope, ...pmWhere("OVERDUE", today) } }),
    prisma.equipment.count({
      where: { ...scope, ...pmWhere("OVERDUE", today), criticality: "CRITICAL" },
    }),
  ]);

  res.json({ total, operational, due30, overdue, criticalOverdue });
});

equipmentRouter.get("/:id", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "Equipment not found." });

  const device = await prisma.equipment.findFirst({
    where: { id, ...equipmentScope(req.user!) },
    include: {
      department: true,
      manufacturer: true,
      category: true,
      engineer: { select: { id: true, fullName: true, email: true } },
      room: { include: { building: true } },
      maintenance: { orderBy: { completedOn: "desc" }, take: 50 },
    },
  });

  // 404 rather than 403 for out-of-scope devices: a 403 confirms the
  // record exists, which is itself a disclosure.
  if (!device) return res.status(404).json({ error: "Equipment not found." });

  const { publicToken, ...safe } = device;

  // Ward staff see the service record but not what it cost.
  const maintenance = canSeeCosts(req.user!)
    ? device.maintenance
    : device.maintenance.map(({ cost, ...rest }) => rest);

  res.json({ ...safe, maintenance, pmState: pmState(device.nextDueAt, toDay(new Date())) });
});

/**
 * One device's change history.
 *
 * Scoped rather than restricted to oversight roles: the engineer
 * responsible for a device is exactly the person who needs to see what
 * was changed on it and by whom. The device is resolved through
 * equipmentScope first, so an out-of-scope id returns 404 before any
 * audit row is read — the same disclosure rule as everywhere else here.
 */
equipmentRouter.get("/:id/audit", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "Equipment not found." });

  const device = await prisma.equipment.findFirst({
    where: { id, ...equipmentScope(req.user!) },
    select: { id: true },
  });
  if (!device) return res.status(404).json({ error: "Equipment not found." });

  const rows = await prisma.auditLog.findMany({
    where: { entity: "Equipment", entityId: device.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { actor: { select: { fullName: true } } },
  });

  res.json({ rows });
});

equipmentRouter.get("/:id/qr", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "Equipment not found." });

  const device = await prisma.equipment.findFirst({
    where: { id, ...equipmentScope(req.user!) },
    select: { publicToken: true, assetNo: true },
  });
  if (!device) return res.status(404).json({ error: "Equipment not found." });

  // The QR carries the opaque token, never the sequential asset tag.
  const png = await QRCode.toBuffer(`${env.APP_URL}/e/${device.publicToken}`, {
    width: 512,
    margin: 2,
  });
  res
    .type("image/png")
    .set("Content-Disposition", `inline; filename="${device.assetNo}.png"`)
    .send(png);
});

/**
 * The scan target. Unauthenticated so a nurse can use it one-handed at
 * the bedside, which means it returns the bare minimum and nothing
 * that would be useful to someone who found a discarded label.
 */
const scanLimiter = rateLimit({ windowMs: 60_000, limit: 30 });

equipmentRouter.get("/public/:token", scanLimiter, async (req, res) => {
  const token = z.string().min(20).max(64).safeParse(req.params.token);
  if (!token.success) return res.status(404).json({ error: "Unknown code." });

  const device = await prisma.equipment.findUnique({
    where: { publicToken: token.data },
    select: {
      id: true,
      name: true,
      assetNo: true,
      operationalStatus: true,
      department: { select: { name: true } },
      room: { select: { code: true } },
    },
  });
  if (!device) return res.status(404).json({ error: "Unknown code." });

  res.json({
    name: device.name,
    assetNo: device.assetNo,
    status: device.operationalStatus,
    location: `${device.department.name}${device.room ? `, room ${device.room.code}` : ""}`,
  });
});

// ------------------------------------------------------------ status edit

const statusSchema = z
  .object({
    operationalStatus: z.enum([
      "OPERATIONAL",
      "UNDER_MAINTENANCE",
      "UNDER_REPAIR",
      "AWAITING_PARTS",
      "OUT_OF_SERVICE",
      "RETIRED",
    ]),
  })
  .strict(); // .strict() blocks mass assignment of role, engineerId, intervals

equipmentRouter.patch(
  "/:id/status",
  requireAuth,
  requireRole("ADMIN", "ENGINEER"),
  async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a valid status." });

    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Equipment not found." });

    const before = await prisma.equipment.findFirst({
      where: { id, ...equipmentScope(req.user!) },
    });
    if (!before) return res.status(404).json({ error: "Equipment not found." });

    const after = await prisma.equipment.update({
      where: { id: before.id },
      data: { operationalStatus: parsed.data.operationalStatus },
    });

    await recordAudit({
      actorId: req.user!.id,
      action: "equipment.status_changed",
      entity: "Equipment",
      entityId: before.id,
      before,
      after,
    });

    res.json(after);
  }
);
