import { Router } from "express";
import rateLimit from "express-rate-limit";
import { limiterStore } from "../../lib/rateLimitStore.js";
import { z } from "zod";
import QRCode from "qrcode";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { EXPORT_ROW_LIMIT, orderByFrom, sendCsv, sortSchema } from "../../lib/listing.js";
import { env } from "../../env.js";
import { recordAudit } from "../../lib/audit.js";
import { canSeeCosts, equipmentScope, requireAuth, requireRole } from "../../middleware/auth.js";
import { addDays, graceDays, pmState, toDay } from "../../scheduler/rules.js";
import { generateToken } from "../../lib/security.js";
import express from "express";
import {
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  deletePhoto,
  isPhotoType,
  putPhoto,
  signedPhotoUrl,
  storageConfigured,
} from "../../lib/storage.js";

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
/**
 * The columns a caller may order by, and how each one is ordered.
 *
 * Department and engineer sort by name rather than by their foreign
 * key, which would order the table by an opaque UUID and look broken.
 */
const SORTABLE = ["name", "assetNo", "nextDueAt", "criticality", "operationalStatus"] as const;

const EQUIPMENT_ORDER: Record<
  (typeof SORTABLE)[number],
  (d: "asc" | "desc") => Prisma.EquipmentOrderByWithRelationInput
> = {
  name: (d) => ({ name: d }),
  assetNo: (d) => ({ assetNo: d }),
  nextDueAt: (d) => ({ nextDueAt: d }),
  criticality: (d) => ({ criticality: d }),
  operationalStatus: (d) => ({ operationalStatus: d }),
};

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
    ...sortSchema(SORTABLE),
    /** csv returns the whole filtered set rather than the current page. */
    format: z.enum(["json", "csv"]).default("json"),
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

  const { q, page, pageSize, pm, sort, dir, format, ...filters } = parsed.data;
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

  const orderBy = orderByFrom(sort, dir, EQUIPMENT_ORDER, { nextDueAt: "asc" as const });

  // An export is the filtered set, not the page someone happens to be
  // looking at — a spreadsheet of 25 of 184 devices is worse than none.
  if (format === "csv") {
    const all = await prisma.equipment.findMany({
      where,
      orderBy: orderBy as Prisma.EquipmentOrderByWithRelationInput,
      take: EXPORT_ROW_LIMIT,
      include: {
        department: { select: { name: true } },
        manufacturer: { select: { name: true } },
        engineer: { select: { fullName: true } },
      },
    });

    return sendCsv(
      res,
      `equipment-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { header: "Asset no.", value: (r) => r.assetNo },
        { header: "Name", value: (r) => r.name },
        { header: "Manufacturer", value: (r) => r.manufacturer.name },
        { header: "Model", value: (r) => r.model },
        { header: "Serial no.", value: (r) => r.serialNo },
        { header: "Department", value: (r) => r.department.name },
        { header: "Criticality", value: (r) => r.criticality },
        { header: "Status", value: (r) => r.operationalStatus },
        { header: "PM state", value: (r) => pmState(r.nextDueAt, today) },
        { header: "Next due", value: (r) => r.nextDueAt?.toISOString().slice(0, 10) ?? "" },
        { header: "Engineer", value: (r) => r.engineer?.fullName ?? "" },
      ],
      all
    );
  }

  const [total, rows] = await Promise.all([
    prisma.equipment.count({ where }),
    prisma.equipment.findMany({
      where,
      orderBy: orderBy as Prisma.EquipmentOrderByWithRelationInput,
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

  res.json({
    ...safe,
    maintenance,
    pmState: pmState(device.nextDueAt, toDay(new Date())),
    // Computed here from the same function the scheduler uses, so the
    // UI cannot drift from the rule by holding its own copy of the
    // ratio — which it previously did.
    graceWindow: graceDays(device.intervalDays, device.graceDaysOverride),
    // Told to the client so the interface can leave the upload control
    // out entirely rather than offering one that answers 503.
    photoUploadAvailable: storageConfigured(),
  });
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
const scanLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: limiterStore("qr-scan"),
});

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

/* ------------------------------------------------ registering devices */

/**
 * The shape of a device, for creating and editing.
 *
 * Deliberately absent: `tag` and `publicToken`, which the server owns;
 * `operationalStatus`, which has its own endpoint because taking a
 * device out of service is a different event from correcting its record;
 * and `lastCompletedAt` / `nextDueAt`, which belong to the maintenance
 * flow. Letting a form write the due date would let someone mark a
 * ventilator serviced without recording any service.
 */
const deviceFields = {
  name: z.string().min(1).max(160),
  assetNo: z.string().min(1).max(64),
  serialNo: z.string().min(1).max(64),
  model: z.string().min(1).max(120),
  categoryId: z.uuid(),
  manufacturerId: z.uuid(),
  departmentId: z.uuid(),
  roomId: z.uuid().nullable().optional(),
  engineerId: z.uuid().nullable().optional(),
  criticality: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  intervalDays: z.coerce.number().int().min(1).max(3650),
  intervalSource: z.enum(["MANUFACTURER", "HOSPITAL_POLICY", "RISK_BASED"]).optional(),
  scheduleMode: z.enum(["GRACE", "ANCHORED"]).optional(),
  graceDaysOverride: z.coerce.number().int().min(0).max(365).nullable().optional(),
  installedAt: z.coerce.date().nullable().optional(),
  purchasedAt: z.coerce.date().nullable().optional(),
  purchasePrice: z.coerce.number().min(0).nullable().optional(),
  warrantyEndsAt: z.coerce.date().nullable().optional(),
};

/**
 * Exported so the mass-assignment guard can be tested without a
 * database. What a form may write is a security boundary, not a
 * detail: .strict() is the only thing stopping a caller from posting
 * its own tag, publicToken or nextDueAt.
 */
export const createSchema = z.object(deviceFields).strict();
/** Every field optional, but at least one present — an empty PATCH is a mistake, not a no-op. */
export const updateSchema = z
  .object(deviceFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to change." });

/**
 * When a newly registered device is first due.
 *
 * A device with no due date is invisible to the nightly sweep, which
 * means registering one would quietly exclude it from the reminder
 * ladder forever — the precise failure this application exists to
 * prevent. So a new device is always due, counted from the last service
 * if one is known, otherwise from installation, otherwise from today.
 */
function firstDueDate(intervalDays: number, installedAt: Date | null | undefined): Date {
  return addDays(toDay(installedAt ?? new Date()), intervalDays);
}

/**
 * Registers a device.
 *
 * The tag is derived from the highest one already issued. It is read
 * and then written, so two people registering at the same moment can
 * collide — the unique constraint turns that into a failed insert
 * rather than two devices sharing a tag, and the retry picks the next
 * number up. A dedicated sequence would be tidier and needs a
 * migration; the constraint is what makes this safe either way.
 */
equipmentRouter.post("/", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the details." });
  }

  const { installedAt, purchasePrice, ...rest } = parsed.data;

  for (let attempt = 0; attempt < 5; attempt++) {
    const highest = await prisma.equipment.findFirst({
      orderBy: { tag: "desc" },
      select: { tag: true },
    });
    // Tags are zero-padded to six digits, so ordering them as text
    // orders them as numbers.
    const current = Number(highest?.tag.replace(/\D/g, "") ?? 0) || 0;
    const tag = `BG-EQ-${String(current + 1 + attempt).padStart(6, "0")}`;

    try {
      const device = await prisma.equipment.create({
        data: {
          ...rest,
          tag,
          publicToken: generateToken(16), // opaque, not derivable from the tag
          installedAt: installedAt ?? null,
          purchasePrice: purchasePrice ?? null,
          nextDueAt: firstDueDate(rest.intervalDays, installedAt),
        },
      });

      await recordAudit({
        actorId: req.user!.id,
        action: "equipment.created",
        entity: "Equipment",
        entityId: device.id,
        after: device,
      });

      const { publicToken: _hidden, ...safe } = device;
      return res.status(201).json(safe);
    } catch (err) {
      const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicate) throw err;

      // A clash on anything but the tag is the caller's to fix.
      const target = (err.meta?.target as string[] | undefined) ?? [];
      if (target.includes("assetNo")) {
        return res.status(409).json({ error: "That asset number is already in use." });
      }
      if (!target.includes("tag")) throw err;
    }
  }

  return res.status(503).json({ error: "Could not allocate a tag. Try again." });
});

/**
 * Corrects a device record.
 *
 * Changing the interval moves the next due date with it, counted from
 * the last service. Without that, shortening a six-month interval to
 * three would change nothing until the next time somebody serviced the
 * device — which is the one moment the change was meant to bring
 * forward.
 */
equipmentRouter.patch("/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the details." });
  }

  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "Equipment not found." });

  const before = await prisma.equipment.findFirst({
    where: { id, ...equipmentScope(req.user!) },
  });
  if (!before) return res.status(404).json({ error: "Equipment not found." });

  const data: Prisma.EquipmentUpdateInput = { ...parsed.data } as Prisma.EquipmentUpdateInput;

  if (parsed.data.intervalDays && parsed.data.intervalDays !== before.intervalDays) {
    const anchor = before.lastCompletedAt ?? before.installedAt ?? before.createdAt;
    data.nextDueAt = addDays(toDay(anchor), parsed.data.intervalDays);
  }

  try {
    const device = await prisma.equipment.update({ where: { id }, data });

    await recordAudit({
      actorId: req.user!.id,
      action: "equipment.updated",
      entity: "Equipment",
      entityId: device.id,
      before,
      after: device,
    });

    const { publicToken: _hidden, ...safe } = device;
    return res.json(safe);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "That asset number is already in use." });
    }
    throw err;
  }
});

/**
 * The lists a device form needs to offer.
 *
 * One request rather than five, because a form that renders before its
 * dropdowns have arrived is a form people submit with the wrong
 * department in it.
 */
equipmentRouter.get(
  "/meta/options",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (_req, res) => {
    const [categories, manufacturers, departments, rooms, engineers] = await Promise.all([
      prisma.equipmentCategory.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.manufacturer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.room.findMany({
        select: { id: true, code: true, building: { select: { name: true } } },
        orderBy: { code: "asc" },
      }),
      prisma.user.findMany({
        where: { role: "ENGINEER", isActive: true },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }),
    ]);

    res.json({ categories, manufacturers, departments, rooms, engineers });
  }
);

/* ------------------------------------------------------------ photos */

/**
 * Uploading a device photo.
 *
 * The body is the image itself rather than a multipart form, which
 * keeps a parser dependency out of the tree: express.raw is already
 * here, and a single file needs no envelope. The content type is the
 * declaration, and it is checked against a list rather than trusted.
 *
 * Registering and photographing a device are the same kind of act -- an
 * inventory change -- so this follows the same roles as the write
 * endpoints rather than the servicing ones.
 */
equipmentRouter.post(
  "/:id/photo",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  express.raw({ type: [...ALLOWED_PHOTO_TYPES], limit: MAX_PHOTO_BYTES }),
  async (req, res) => {
    if (!storageConfigured()) {
      // Said plainly rather than as a 500: nothing is broken, the
      // deployment simply has nowhere to put a file.
      return res.status(503).json({ error: "Photo storage is not configured." });
    }

    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Equipment not found." });

    const contentType = req.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!isPhotoType(contentType)) {
      return res.status(415).json({ error: "Send a JPEG, PNG or WebP image." });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "The image was empty." });
    }

    const device = await prisma.equipment.findFirst({
      where: { id, ...equipmentScope(req.user!) },
      select: { id: true, photoPath: true },
    });
    if (!device) return res.status(404).json({ error: "Equipment not found." });

    const path = await putPhoto(device.id, req.body, contentType);

    await prisma.equipment.update({ where: { id: device.id }, data: { photoPath: path } });

    await recordAudit({
      actorId: req.user!.id,
      action: "equipment.photo_set",
      entity: "Equipment",
      entityId: device.id,
    });

    // The old object is replaced, not orphaned. A failure here leaves a
    // stray file, which is not worth failing the request over.
    if (device.photoPath) {
      deletePhoto(device.photoPath).catch(() => {});
    }

    res.status(201).json({ url: await signedPhotoUrl(path) });
  }
);

/**
 * A link to the photo, signed and short-lived.
 *
 * Redirects rather than returning JSON so an <img src> can point
 * straight at it, and so the signature is minted per view instead of
 * being embedded in a page somebody might keep.
 */
equipmentRouter.get("/:id/photo", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "Equipment not found." });

  const device = await prisma.equipment.findFirst({
    where: { id, ...equipmentScope(req.user!) },
    select: { photoPath: true },
  });
  if (!device?.photoPath) return res.status(404).json({ error: "No photo." });

  const url = await signedPhotoUrl(device.photoPath);
  if (!url) return res.status(503).json({ error: "Photo storage is not configured." });

  res.redirect(url);
});
