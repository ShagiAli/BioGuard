/**
 * A rate-limit store backed by Postgres, so a limit means the same
 * thing across every process serving the application.
 *
 * express-rate-limit's default MemoryStore is correct for exactly one
 * long-lived process, which is what the Docker deployment runs. On a
 * serverless platform each concurrent invocation has its own memory, so
 * a limit of five login attempts becomes five *per warm instance* —
 * the control still reports healthy numbers while protecting nobody.
 * SECURITY.md documents these limits; this is what makes them true off
 * a single container as well as on one.
 */
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { env } from "../env.js";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

interface HitRow {
  hits: number;
  expiresAt: Date;
}

export class PostgresRateLimitStore implements Store {
  /** Keys are shared, not per-instance. */
  localKeys = false;

  private windowMs = 60_000;

  /**
   * Namespaces the key. The five limiters key on overlapping values —
   * two of them on a client IP — so without a prefix a login attempt
   * and a QR scan from the same address would consume one another's
   * budget.
   */
  constructor(private readonly keyPrefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private id(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  /**
   * One statement, so concurrent requests cannot interleave a read and
   * a write and lose a count between them — the race that makes a
   * naive read-modify-write limiter passable under exactly the load it
   * exists to stop.
   *
   * An expired row is reset rather than deleted: the window restarts at
   * one hit, which is the same result with no second round trip.
   */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const expires = new Date(Date.now() + this.windowMs);

    try {
      const rows = await prisma.$queryRaw<HitRow[]>`
        INSERT INTO "RateLimitHit" ("key", "hits", "expiresAt")
        VALUES (${this.id(key)}, 1, ${expires})
        ON CONFLICT ("key") DO UPDATE SET
          "hits" = CASE
            WHEN "RateLimitHit"."expiresAt" <= NOW() THEN 1
            ELSE "RateLimitHit"."hits" + 1
          END,
          "expiresAt" = CASE
            WHEN "RateLimitHit"."expiresAt" <= NOW() THEN ${expires}
            ELSE "RateLimitHit"."expiresAt"
          END
        RETURNING "hits", "expiresAt"
      `;

      const row = rows[0];
      if (!row) throw new Error("upsert returned no row");
      return { totalHits: row.hits, resetTime: row.expiresAt };
    } catch (err) {
      /**
       * Fail open, loudly.
       *
       * The alternative locks every user out of a working application
       * because one table is unreachable. It costs nothing here that
       * closing would save: every route behind these limiters needs the
       * same database to authenticate a session or check a password, so
       * a store that cannot be read is a store whose requests were
       * going to fail anyway.
       */
      logger.error({ err, prefix: this.keyPrefix }, "rate limit store unavailable — allowing request");
      return { totalHits: 1, resetTime: expires };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await prisma.$executeRaw`
        UPDATE "RateLimitHit"
        SET "hits" = GREATEST("hits" - 1, 0)
        WHERE "key" = ${this.id(key)}
      `;
    } catch (err) {
      logger.error({ err, prefix: this.keyPrefix }, "could not decrement rate limit");
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await prisma.rateLimitHit.deleteMany({ where: { key: this.id(key) } });
    } catch (err) {
      logger.error({ err, prefix: this.keyPrefix }, "could not reset rate limit key");
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const row = await prisma.rateLimitHit.findUnique({ where: { key: this.id(key) } });
    if (!row || row.expiresAt <= new Date()) return undefined;
    return { totalHits: row.hits, resetTime: row.expiresAt };
  }
}

/**
 * Drops windows that have already closed.
 *
 * Expired rows are never read — `increment` resets them in place — so
 * this is housekeeping, not correctness, and it runs on the nightly
 * sweep rather than on a fraction of requests. A user-facing request
 * should not occasionally pay for a table scan.
 */
export async function pruneExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimitHit.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

/**
 * The store to hand a limiter, or undefined to leave express-rate-limit
 * on its own in-memory default.
 *
 * A factory rather than one shared instance: express-rate-limit calls
 * init() on the store with the owning limiter's options, so a store
 * handed to two limiters would take the window of whichever registered
 * last.
 */
export function limiterStore(prefix: string): Store | undefined {
  if (env.RATE_LIMIT_STORE !== "postgres") return undefined;
  return new PostgresRateLimitStore(prefix);
}
