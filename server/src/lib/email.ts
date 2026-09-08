/**
 * Email leaves the building. It is not a second inbox inside the
 * application.
 *
 * Notifications are what somebody sees when they open BioGuard. Mail is
 * what reaches them when they have not opened it. Those are different
 * jobs, and for a while they were not: the `db` driver wrote messages to
 * a table that the application then rendered as a mailbox, so both ended
 * up as the same list on two pages.
 *
 * Now every message is recorded and, when a mail server is configured,
 * also delivered:
 *
 *  - The SentEmail row is the outbox — proof of what was sent, to whom
 *    and when. Nothing renders it; it is a record, not a feature.
 *  - MAIL_DRIVER=smtp delivers as well. Anything else records and stops,
 *    which is what the public demo wants: its engineers have
 *    @bioguard.local addresses that do not exist, and sending to them
 *    would produce nothing but bounces.
 *
 * So turning real email on is credentials plus one setting, and turning
 * it off never loses the history of what would have gone.
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
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        // Omitted entirely rather than passed as undefined: nodemailer
        // treats the presence of `auth` as a request to authenticate,
        // and Mailpit rejects the attempt.
        ...(env.SMTP_USER && env.SMTP_PASS
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
          : {}),
      })
    : null;

/**
 * The outbox write, batched. One insert for the whole sweep rather than
 * one per recipient — the difference is minutes when the database is on
 * another continent.
 */
async function record(mails: Mail[]): Promise<void> {
  try {
    await prisma.sentEmail.createMany({
      data: mails.map((m) => ({ to: m.to, subject: m.subject, body: m.text })),
    });
  } catch (err) {
    // The record failing must not stop the message going out. Losing the
    // audit line is bad; losing the email is worse.
    logger.error({ err, count: mails.length }, "outbox write failed");
  }
}

async function deliver(mail: Mail): Promise<void> {
  try {
    if (transport) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
      return;
    }
    logger.info({ to: mail.to, subject: mail.subject }, "mail recorded, not sent (no transport)");
  } catch (err) {
    // A failed message must never take down the sweep that produced it.
    logger.error({ err, to: mail.to }, "mail delivery failed");
  }
}

export async function sendMailMany(mails: Mail[]): Promise<void> {
  if (mails.length === 0) return;
  await record(mails);
  // SMTP has no batch equivalent; send them one at a time.
  for (const mail of mails) await deliver(mail);
}

export async function sendMail(mail: Mail): Promise<void> {
  await record([mail]);
  await deliver(mail);
}
