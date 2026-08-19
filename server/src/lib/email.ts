/**
 * Email behind an interface, so the transport is configuration rather
 * than a code change.
 *
 *  smtp — a real server. Mailpit locally, a provider in production.
 *  db   — stores the message so recipients can read it inside the app.
 *         Used for the public demo: the seeded engineers have
 *         @bioguard.local addresses that do not exist, and sending to
 *         them would produce nothing but bounces.
 *  log  — writes a line and discards the message.
 */
import nodemailer from "nodemailer";
import { env } from "../env.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const transport =
  env.MAIL_DRIVER === "smtp"
    ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false })
    : null;

/**
 * Batched delivery. The db driver writes every message in one insert,
 * which matters for the sweep: one round trip instead of one per
 * recipient, and the difference is minutes when the database is on
 * another continent.
 */
export async function sendMailMany(mails: Mail[]): Promise<void> {
  if (mails.length === 0) return;

  try {
    if (env.MAIL_DRIVER === "db") {
      await prisma.sentEmail.createMany({
        data: mails.map((m) => ({ to: m.to, subject: m.subject, body: m.text })),
      });
      return;
    }
    // SMTP has no batch equivalent; send them one at a time.
    for (const mail of mails) await sendMail(mail);
  } catch (err) {
    logger.error({ err, count: mails.length }, "batch mail delivery failed");
  }
}

export async function sendMail(mail: Mail): Promise<void> {
  try {
    if (env.MAIL_DRIVER === "db") {
      await prisma.sentEmail.create({
        data: { to: mail.to, subject: mail.subject, body: mail.text },
      });
      return;
    }

    if (transport) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
      return;
    }

    logger.info({ to: mail.to, subject: mail.subject }, "mail (log driver)");
  } catch (err) {
    // A failed message must never take down the sweep that produced it.
    logger.error({ err, to: mail.to }, "mail delivery failed");
  }
}
