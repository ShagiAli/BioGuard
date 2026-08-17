/**
 * Environment is validated once, at boot, and the process refuses to
 * start if anything required is missing. No secret gets a fallback
 * default: a server that silently runs on a guessable session secret is
 * worse than one that will not start.
 *
 * dotenv must be imported before anything reads process.env. The Prisma
 * CLI loads .env by itself, which is why migrations and seeding work
 * without this, but the application gets no such help.
 */
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().url(),
  TIMEZONE: z.string().default("Europe/Istanbul"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  MAIL_DRIVER: z.enum(["smtp", "log"]).default("smtp"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default("BioGuard <noreply@bioguard.local>"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
