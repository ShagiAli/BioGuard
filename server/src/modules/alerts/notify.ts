/**
 * Telling people an alert moved.
 *
 * Reuses the notification stream and mail transport the preventive
 * scheduler already writes to, so an alert and a maintenance reminder
 * arrive in the same inbox rather than in two parallel systems the reader
 * has to check separately.
 */
import type { Alert, Equipment, Priority, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { sendMailMany } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../env.js";
import { SLA_RESPONSE_MINUTES } from "../../lib/sla.js";
import { alertNumber, notifyLevelFor } from "./workflow.js";

type AlertWithEquipment = Alert & { equipment: Pick<Equipment, "name" | "assetNo"> };

const PRIORITY_LABEL: Record<Priority, string> = {
  EMERGENCY: "Emergency",
  MEDIUM: "Medium",
  LOW: "Low",
};

/** How long there is to acknowledge, said the way a person would say it. */
function responseWindow(priority: Priority): string {
  const minutes = SLA_RESPONSE_MINUTES[priority];
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Everyone who triages. An alert addressed to a single named person goes
 * unread the day that person is off, so it goes to the desk rather than
 * the individual.
 *
 * Managers join the list for emergencies only. They are accountable for
 * the estate, so a device down urgently is theirs to know about — but
 * copying them on every routine fault is how a person learns to filter
 * the sender, and then misses the one that mattered.
 */
async function triageRecipients(priority: Priority) {
  const roles: Role[] =
    priority === "EMERGENCY" ? ["HEAD_OF_ALERTS", "ADMIN", "MANAGER"] : ["HEAD_OF_ALERTS", "ADMIN"];

  return prisma.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { id: true, email: true },
  });
}

interface NotifyInput {
  alert: AlertWithEquipment;
  recipientIds: string[];
  emails: string[];
  title: string;
  body: string;
  priority: Priority;
}

async function deliver({ alert, recipientIds, emails, title, body, priority }: NotifyInput) {
  if (recipientIds.length === 0) return;

  try {
    await prisma.notification.createMany({
      data: recipientIds.map((recipientId) => ({
        recipientId,
        equipmentId: alert.equipmentId,
        alertId: alert.id,
        level: notifyLevelFor(priority),
        title,
        body,
      })),
    });

    await sendMailMany(
      emails.map((to) => ({
        to,
        subject: title,
        text: `${body}\n\nOpen in BioGuard: ${env.APP_URL}/alerts/${alert.id}`,
      }))
    );
  } catch (err) {
    // A notification failure must never roll back the transition that
    // caused it — the same rule the audit writer follows.
    logger.error({ err, alertId: alert.id }, "alert notification failed");
  }
}

const describe = (alert: AlertWithEquipment) =>
  `${alert.equipment.name} (${alert.equipment.assetNo})`;

/** A new alert goes to whoever is triaging. */
export async function notifyRaised(alert: AlertWithEquipment) {
  const recipients = await triageRecipients(alert.priority);
  await deliver({
    alert,
    recipientIds: recipients.map((r) => r.id),
    emails: recipients.map((r) => r.email),
    priority: alert.priority,
    title: `${alert.priority === "EMERGENCY" ? "EMERGENCY: " : ""}New alert ${alertNumber(alert.seq, alert.openedAt)} — ${describe(alert)}`,
    body: `${describe(alert)} has been reported as faulty.\n\n${alert.description}`,
  });
}

/** The person who reported it hears that somebody has picked it up. */
export async function notifyAcknowledged(alert: AlertWithEquipment) {
  const nurse = await prisma.user.findUnique({
    where: { id: alert.raisedById },
    select: { id: true, email: true },
  });
  if (!nurse) return;

  await deliver({
    alert,
    recipientIds: [nurse.id],
    emails: [nurse.email],
    priority: alert.priority,
    title: `Alert ${alertNumber(alert.seq, alert.openedAt)} has been received`,
    body: `Your report of ${describe(alert)} has been received and is being triaged.`,
  });
}

/** The engineer hears they have work, and the reporter hears who has it. */
export async function notifyAssigned(alert: AlertWithEquipment, engineerName: string) {
  const [engineer, nurse] = await Promise.all([
    alert.assignedToId
      ? prisma.user.findUnique({
          where: { id: alert.assignedToId },
          select: { id: true, email: true },
        })
      : null,
    prisma.user.findUnique({ where: { id: alert.raisedById }, select: { id: true, email: true } }),
  ]);

  if (engineer) {
    await deliver({
      alert,
      recipientIds: [engineer.id],
      emails: [engineer.email],
      priority: alert.priority,
      title: `${alert.priority === "EMERGENCY" ? "EMERGENCY: " : ""}Assigned to you: ${alertNumber(alert.seq, alert.openedAt)} — ${describe(alert)}`,
      body:
        `${describe(alert)} has been assigned to you.\n\n` +
        `Priority: ${PRIORITY_LABEL[alert.priority]}\n` +
        `Acknowledge within: ${responseWindow(alert.priority)} of the report\n\n` +
        `Reported fault: ${alert.description}`,
    });
  }

  if (nurse) {
    await deliver({
      alert,
      recipientIds: [nurse.id],
      emails: [nurse.email],
      priority: alert.priority,
      title: `Alert ${alertNumber(alert.seq, alert.openedAt)} assigned to an engineer`,
      body: `${describe(alert)} has been assigned to ${engineerName}.`,
    });
  }
}

/** The reporter is told the device is back, which is the answer they wanted. */
export async function notifyResolved(alert: AlertWithEquipment, resolution: string) {
  const nurse = await prisma.user.findUnique({
    where: { id: alert.raisedById },
    select: { id: true, email: true },
  });
  if (!nurse) return;

  await deliver({
    alert,
    recipientIds: [nurse.id],
    emails: [nurse.email],
    priority: alert.priority,
    title: `Resolved: ${alertNumber(alert.seq, alert.openedAt)} — ${describe(alert)}`,
    body: `${describe(alert)} has been repaired and returned to service.\n\n${resolution}`,
  });
}
