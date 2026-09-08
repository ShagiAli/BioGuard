/**
 * Telling the people who can authorise a purchase that a repair is
 * waiting on one.
 *
 * A part nobody orders is the quietest way for a device to stay off the
 * floor. The engineer knows — they wrote the line — but the engineer
 * cannot raise a purchase order, and until now nothing left the
 * application to say so. The work order simply sat at "awaiting parts"
 * until somebody happened to open it.
 *
 * So this goes to the roles that answer for the estate rather than to a
 * named person: an order addressed to somebody on leave is an order that
 * does not get placed.
 */
import type { Priority, WorkOrderPart } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { sendMailMany } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../env.js";
import { notifyLevelFor, workOrderNumber } from "../alerts/workflow.js";

interface PartContext {
  part: WorkOrderPart;
  workOrder: { id: string; seq: number; createdAt: Date; priority: Priority };
  equipment: { id: string; name: string; assetNo: string; department: { name: string } };
}

/** The people who can actually place an order. */
async function purchasingRecipients() {
  return prisma.user.findMany({
    where: { role: { in: ["ADMIN", "MANAGER"] }, isActive: true },
    select: { id: true, email: true },
  });
}

export async function notifyPartNeeded({ part, workOrder, equipment }: PartContext): Promise<void> {
  const recipients = await purchasingRecipients();
  if (recipients.length === 0) return;

  const reference = workOrderNumber(workOrder.seq, workOrder.createdAt);
  const quantity = part.quantity > 1 ? ` ×${part.quantity}` : "";
  const partNumber = part.partNumber ? ` (part no. ${part.partNumber})` : "";

  const title = `Part needed: ${part.name} — ${equipment.name} (${equipment.assetNo})`;
  const body =
    `${equipment.name}, asset ${equipment.assetNo}, in ${equipment.department.name} is ` +
    `waiting on a part before it can be repaired.\n\n` +
    `Part: ${part.name}${quantity}${partNumber}\n` +
    `Work order: ${reference}\n` +
    (part.notes ? `Notes: ${part.notes}\n` : "") +
    `\nThe device stays out of service until this is ordered and fitted.`;

  try {
    await prisma.notification.createMany({
      data: recipients.map((r) => ({
        recipientId: r.id,
        equipmentId: equipment.id,
        // The device is unavailable either way; the priority of the
        // repair decides how loudly that is said.
        level: notifyLevelFor(workOrder.priority),
        title,
        body,
      })),
    });

    await sendMailMany(
      recipients.map((r) => ({
        to: r.email,
        subject: title,
        text: `${body}\n\nOpen in BioGuard: ${env.APP_URL}/work-orders/${workOrder.id}`,
      }))
    );
  } catch (err) {
    // Never roll back the part line because telling somebody about it
    // failed — the same rule the alert notifier and the audit writer
    // follow.
    logger.error({ err, partId: part.id }, "part notification failed");
  }
}
