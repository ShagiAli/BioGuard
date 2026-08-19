/**
 * Audit writing.
 *
 * The allowlist is the point. Handing a whole Prisma row to the audit
 * table would write passwordHash into a widely readable log, so the
 * writer only ever accepts named fields and the caller cannot opt out.
 */
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

const ALLOWED_FIELDS: Record<string, readonly string[]> = {
  Equipment: [
    "tag",
    "assetNo",
    "name",
    "operationalStatus",
    "criticality",
    "departmentId",
    "roomId",
    "engineerId",
    "intervalDays",
    "scheduleMode",
    "nextDueAt",
    "lastCompletedAt",
  ],
  MaintenanceRecord: ["type", "completedOn", "cost", "downtimeHours", "rebased", "nextDueAfter"],
  User: ["email", "fullName", "role", "departmentId", "isActive"], // never passwordHash
};

function pick(entity: string, source?: Record<string, unknown> | null) {
  if (!source) return undefined;
  const allowed = ALLOWED_FIELDS[entity];
  if (!allowed) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entity: keyof typeof ALLOWED_FIELDS | string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: pick(input.entity, input.before) as never,
        after: pick(input.entity, input.after) as never,
      },
    });
  } catch (err) {
    // Never let an audit failure roll back the user's actual work.
    logger.error({ err, action: input.action }, "audit write failed");
  }
}
