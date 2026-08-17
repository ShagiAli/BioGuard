/**
 * Email behind an interface so the transport is a configuration
 * choice, not a code change. Locally this points at Mailpit; in
 * production at SMTP or an API provider.
 */
import nodemailer from "nodemailer";
import { env } from "../env.js";
import { logger } from "./logger.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const transport =
  env.MAIL_DRIVER === "smtp"
    ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false })
    : null;

export async function sendMail(mail: Mail): Promise<void> {
  if (!transport) {
    logger.info({ to: mail.to, subject: mail.subject }, "mail (log driver)");
    return;
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail });
  } catch (err) {
    // A failed reminder must never take down the sweep.
    logger.error({ err, to: mail.to }, "mail send failed");
  }
}
