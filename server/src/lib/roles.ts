/**
 * What each role is called, and what holding it means.
 *
 * Written for the person reading about their own account, so each
 * meaning is phrased to follow "As <role>, " — a sentence addressed to
 * them rather than a description of a permission table.
 *
 * Typed as Record<Role, …> on purpose. The list of roles has drifted out
 * of step before: a hand-written array knew five roles while the schema
 * had six, and the sixth could not be assigned. A record keyed by the
 * generated enum cannot fall behind it — add a role to the schema and
 * this file stops compiling until the new role says what it is.
 *
 * Kept to what each role can genuinely do, so the email is a promise the
 * application keeps rather than a job description it does not enforce.
 */
import type { Role } from "@prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  HEAD_OF_ALERTS: "Head of alerts",
  HEAD_OF_ENGINEERING: "Head of engineering",
  ENGINEER: "Engineer",
  STAFF: "Ward staff",
};

export const ROLE_MEANING: Record<Role, string> = {
  ADMIN:
    "you can manage everyone's accounts, see every device and repair across the hospital, " +
    "and change anything in the system.",
  MANAGER:
    "you oversee the equipment programme. You can manage people, add and edit devices, and " +
    "record what repairs cost, and you are told about emergencies and parts that need ordering.",
  HEAD_OF_ALERTS:
    "you are told about every fault as it is reported, and you acknowledge each one and " +
    "assign an engineer to it.",
  HEAD_OF_ENGINEERING:
    "you check finished repairs and either accept them, which returns the device to service, " +
    "or send them back to the engineer with a reason.",
  ENGINEER:
    "you service your department's devices and carry out the repairs assigned to you, and you " +
    "are reminded when your devices fall due.",
  STAFF:
    "you can report faults with equipment, and you are told what happened to the faults you " +
    "reported.",
};
