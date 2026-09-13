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
 *
 * Returns each row's id so delivery can be written back against it.
 * Null where the insert failed, which is survivable: losing the record
 * must never stop the message going out.
 */
async function record(mails: Mail[]): Promise<(string | null)[]> {
  try {
    const rows = await prisma.sentEmail.createManyAndReturn({
      data: mails.map((m) => ({ to: m.to, subject: m.subject, body: m.text })),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  } catch (err) {
    // Losing the audit line is bad; losing the email is worse.
    logger.error({ err, count: mails.length }, "outbox write failed");
    return mails.map(() => null);
  }
}

/** Writes the outcome back, and never lets that failure matter. */
async function markOutcome(id: string | null, data: Record<string, unknown>): Promise<void> {
  if (!id) return;
  try {
    await prisma.sentEmail.update({ where: { id }, data });
  } catch (err) {
    logger.error({ err, id }, "could not record the delivery outcome");
  }
}

async function deliver(mail: Mail, id: string | null): Promise<void> {
  if (!transport) {
    logger.info({ to: mail.to, subject: mail.subject }, "mail recorded, not sent (no transport)");
    await markOutcome(id, { deliveryError: "No mail transport is configured." });
    return;
  }

  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    await markOutcome(id, { deliveredAt: new Date(), deliveryError: null });
  } catch (err) {
    /*
     * A failed message must never take down the sweep that produced it,
     * which is why this is caught — but swallowing it into a log made
     * "the email never arrived" unanswerable without the host's console.
     * The reason is kept instead, because it is the whole value:
     * authentication rejected and connection refused are different
     * problems with different fixes.
     */
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: mail.to }, "mail delivery failed");
    await markOutcome(id, { deliveryError: reason.slice(0, 500) });
  }
}

export async function sendMailMany(mails: Mail[]): Promise<void> {
  if (mails.length === 0) return;
  const ids = await record(mails);
  // SMTP has no batch equivalent; send them one at a time.
  for (const [i, mail] of mails.entries()) await deliver(mail, ids[i] ?? null);
}

export async function sendMail(mail: Mail): Promise<void> {
  const [id] = await record([mail]);
  await deliver(mail, id ?? null);
}
