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
  MAIL_DRIVER: z.enum(["smtp", "log", "db"]).default("smtp"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default("BioGuard <noreply@bioguard.local>"),
  // Single-origin deployment: the API also serves the built frontend
  // from ./public. Keeps the session cookie first-party, which
  // SameSite=Strict requires.
  SERVE_WEB: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Number of reverse proxies in front of the app. Wrong values break
  // rate limiting silently: too low and every client shares one bucket
  // behind the proxy's address, too high and clients can spoof their
  // own address through X-Forwarded-For. Render behind Cloudflare is 3.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
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
