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

// ------------------------------------------------------------- review

interface ReviewContext {
  workOrder: { id: string; seq: number; createdAt: Date; priority: Priority };
  equipment: {
    id: string;
    name: string;
    assetNo: string;
    departmentId: string;
    department: { name: string };
  };
}

/**
 * Who reviews a finished repair on this device.
 *
 * The head of the department the device belongs to, and nobody else —
 * a head answers for their own ward's equipment. Administrators are the
 * fallback rather than a second reviewer: without one, a department with
 * no head appointed would leave every completed repair sitting unread,
 * which is the failure this whole gate is supposed to prevent.
 */
export async function reviewersFor(departmentId: string) {
  const heads = await prisma.user.findMany({
    where: { role: "HEAD_OF_DEPARTMENT", departmentId, isActive: true },
    select: { id: true, email: true },
  });
  if (heads.length > 0) return { heads, viaFallback: false };

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, email: true },
  });
  return { heads: admins, viaFallback: true };
}

/** A repair is finished and waiting on somebody to accept it. */
export async function notifyAwaitingReview({ workOrder, equipment }: ReviewContext): Promise<void> {
  const { heads, viaFallback } = await reviewersFor(equipment.departmentId);
  if (heads.length === 0) return;

  const reference = workOrderNumber(workOrder.seq, workOrder.createdAt);
  const title = `Ready for review: ${equipment.name} (${equipment.assetNo})`;
  const body =
    `${equipment.name}, asset ${equipment.assetNo}, in ${equipment.department.name} has been ` +
    `repaired and is waiting to be checked.\n\n` +
    `Work order: ${reference}\n\n` +
    (viaFallback
      ? `No head of department is appointed for ${equipment.department.name}, so this has ` +
        `come to the administrators instead.\n\n`
      : "") +
    `The device stays out of service until the repair is accepted.`;

  try {
    await prisma.notification.createMany({
      data: heads.map((h) => ({
        recipientId: h.id,
        equipmentId: equipment.id,
        level: notifyLevelFor(workOrder.priority),
        title,
        body,
      })),
    });

    await sendMailMany(
      heads.map((h) => ({
        to: h.email,
        subject: title,
        text: `${body}\n\nOpen in BioGuard: ${env.APP_URL}/work-orders/${workOrder.id}`,
      }))
    );
  } catch (err) {
    // Never roll back a completed repair because telling somebody about
    // it failed — the same rule the part notifier and audit writer follow.
    logger.error({ err, workOrderId: workOrder.id }, "review notification failed");
  }
}

/**
 * A repair was not accepted, and the engineer has to know why.
 *
 * To the named engineer rather than to a role: this is one person's work
 * coming back, and a rejection addressed to a rota is a rejection nobody
 * owns. The reason travels with it because sending somebody back to a
 * device without telling them what was wrong is how the same repair gets
 * done twice.
 */
export async function notifyRepairRejected({
  workOrder,
  equipment,
  engineer,
  reason,
  reviewer,
}: ReviewContext & {
  engineer: { id: string; email: string };
  reason: string;
  reviewer: { fullName: string };
}): Promise<void> {
  const reference = workOrderNumber(workOrder.seq, workOrder.createdAt);
  const title = `Sent back: ${equipment.name} (${equipment.assetNo})`;
  const body =
    `The repair to ${equipment.name}, asset ${equipment.assetNo}, in ` +
    `${equipment.department.name} was reviewed and not accepted.\n\n` +
    `Reviewed by: ${reviewer.fullName}\n` +
    `Reason: ${reason}\n\n` +
    `Work order: ${reference}\n\n` +
    `The work order is open again and the device stays out of service.`;

  try {
    await prisma.notification.create({
      data: {
        recipientId: engineer.id,
        equipmentId: equipment.id,
        // Urgent regardless of the repair's priority: somebody believed
        // this device was fixed, and it is not.
        level: "URGENT",
        title,
        body,
      },
    });

    await sendMailMany([
      {
        to: engineer.email,
        subject: title,
        text: `${body}\n\nOpen in BioGuard: ${env.APP_URL}/work-orders/${workOrder.id}`,
      },
    ]);
  } catch (err) {
    logger.error({ err, workOrderId: workOrder.id }, "rejection notification failed");
  }
}
