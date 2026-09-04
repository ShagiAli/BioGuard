/**
 * Reading the audit trail.
 *
 * `recordAudit()` has been populating AuditLog since the first release —
 * every status change, every maintenance record, each written through a
 * per-entity field allowlist. Nothing read it, which made "an auditable
 * trail of every schedule change" a claim rather than a feature.
 *
 * Two views, because two questions are being asked. "What happened to
 * this device?" is answered per device and scoped like any other
 * equipment query. "Where is the programme slipping?" is an estate-wide
 * question, so it is limited to the oversight roles.
 */
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { EXPORT_ROW_LIMIT, orderByFrom, sendCsv, sortSchema } from "../../lib/listing.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const auditRouter = Router();

const SORTABLE = ["createdAt", "action", "actor"] as const;

const AUDIT_ORDER: Record<
  (typeof SORTABLE)[number],
  (d: "asc" | "desc") => Prisma.AuditLogOrderByWithRelationInput
> = {
  createdAt: (d) => ({ createdAt: d }),
  action: (d) => ({ action: d }),
  actor: (d) => ({ actor: { fullName: d } }),
};

const feedQuery = z
  .object({
    action: z.string().max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    ...sortSchema(SORTABLE),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict();

/**
 * Attaches the device each entry refers to.
 *
 * AuditLog.entityId is a bare uuid with no relation — deliberately, so
 * the table can outlive the rows it describes. Resolving names therefore
 * takes one batched query rather than a join, and an entry whose device
 * has since been deleted simply resolves to null instead of vanishing.
 */
async function withEquipment<T extends { entity: string; entityId: string }>(rows: T[]) {
  const ids = [...new Set(rows.filter((r) => r.entity === "Equipment").map((r) => r.entityId))];
  if (ids.length === 0) return rows.map((row) => ({ ...row, equipment: null }));

  const devices = await prisma.equipment.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, assetNo: true },
  });
  const byId = new Map(devices.map((d) => [d.id, d]));

  return rows.map((row) => ({ ...row, equipment: byId.get(row.entityId) ?? null }));
}

/**
 * The estate-wide feed.
 *
 * Restricted to the roles that oversee the programme rather than a
 * department. Filtering on `maintenance.recorded_rebased` gives the
 * slippage report the schedule design argues for: a re-base is the
 * signal that the programme is drifting, and it should be visible in
 * reporting rather than quietly absorbed.
 */
auditRouter.get("/", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const parsed = feedQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Unrecognised filter." });

  const { action, page, pageSize, sort, dir, format } = parsed.data;
  const where = action ? { action } : {};

  const orderBy = orderByFrom(sort, dir, AUDIT_ORDER, {
    createdAt: "desc" as const,
  }) as Prisma.AuditLogOrderByWithRelationInput;

  if (format === "csv") {
    const all = await withEquipment(
      await prisma.auditLog.findMany({
        where,
        orderBy,
        take: EXPORT_ROW_LIMIT,
        include: { actor: { select: { fullName: true } } },
      })
    );

    return sendCsv(
      res,
      `activity-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { header: "Time", value: (r) => r.createdAt },
        { header: "Action", value: (r) => r.action },
        { header: "Entity", value: (r) => r.entity },
        { header: "Equipment", value: (r) => r.equipment?.name ?? "" },
        { header: "Asset no.", value: (r) => r.equipment?.assetNo ?? "" },
        { header: "Actor", value: (r) => r.actor?.fullName ?? "System" },
      ],
      all
    );
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { fullName: true } } },
    }),
  ]);

  res.json({ total, page, pageSize, rows: await withEquipment(rows) });
});

/** The distinct actions present, so the UI filter is not a hardcoded list. */
auditRouter.get("/actions", requireAuth, requireRole("ADMIN", "MANAGER"), async (_req, res) => {
  const rows = await prisma.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  res.json({ actions: rows.map((r) => r.action) });
});
