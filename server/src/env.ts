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

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    APP_URL: z.url(),
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

    /**
     * How the nightly sweep gets run.
     *
     * "worker" is a long-lived process holding a pg-boss worker, which is
     * what the Docker image runs. "cron" is for platforms that freeze a
     * function the moment it responds — there is nothing there to poll a
     * queue, so the platform's own scheduler calls /api/cron/sweep and
     * that endpoint runs exactly what the worker would have.
     */
    SCHEDULER_MODE: z.enum(["worker", "cron"]).default("worker"),
    /** Shared secret the platform scheduler presents. Required in cron mode. */
    CRON_SECRET: z.string().min(16).optional(),
    /**
     * Where rate-limit counters live. The in-memory default is correct
     * for one process and actively misleading for several: see
     * lib/rateLimitStore.ts.
     */
    RATE_LIMIT_STORE: z.enum(["memory", "postgres"]).default("memory"),
  })
  .superRefine((cfg, ctx) => {
    // An unauthenticated endpoint that runs the sweep is not something to
    // leave open because a variable was forgotten. Refusing to boot is the
    // only version of this check that cannot be ignored.
    if (cfg.SCHEDULER_MODE === "cron" && !cfg.CRON_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["CRON_SECRET"],
        message: "CRON_SECRET is required when SCHEDULER_MODE=cron",
      });
    }
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
