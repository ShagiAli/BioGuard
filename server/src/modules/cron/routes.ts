/**
 * The nightly sweep, triggered by a platform scheduler instead of a
 * worker.
 *
 * A serverless function is frozen the moment it responds, so the
 * pg-boss worker in scheduler/job.ts has nothing to run on: it would
 * start, be suspended before its first poll, and never fire. Platforms
 * of that shape provide a cron that makes an HTTP request instead, and
 * this is the endpoint it calls.
 *
 * Mounted only in cron mode. On the Docker deployment the worker owns
 * the schedule and this route does not exist, so there is no second,
 * unauthenticated way to trigger a sweep on a host that never needed
 * one.
 */
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../../env.js";
import { logger } from "../../lib/logger.js";
import { pruneExpiredRateLimits } from "../../lib/rateLimitStore.js";
import { runScheduledSweep } from "../../scheduler/job.js";

export const cronRouter = Router();

/**
 * Constant-time comparison over the raw bytes.
 *
 * timingSafeEqual throws on a length mismatch, which would leak the
 * secret's length through the difference between a 401 and a 500, so
 * the lengths are checked first and a mismatch takes the same path as a
 * wrong value.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * GET rather than POST because that is what platform schedulers send.
 *
 * It is not a safe request — it sends mail and writes a SweepRun — so
 * it must never be reachable by anything that follows links. The secret
 * is what keeps it private; there is no session here, since the caller
 * is a scheduler and not a person.
 */
cronRouter.get("/sweep", async (req, res) => {
  const expected = env.CRON_SECRET;
  // env.ts refuses to boot in cron mode without this, so reaching here
  // means the route was mounted in a mode that has no business serving it.
  if (!expected) return res.status(503).json({ error: "Cron is not configured." });

  const header = req.get("authorization") ?? "";
  if (!secretMatches(header, `Bearer ${expected}`)) {
    logger.warn({ ip: req.ip }, "rejected an unauthenticated cron request");
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const result = await runScheduledSweep();
    // Housekeeping that wants a scheduled moment rather than a share of
    // user-facing requests.
    const pruned = await pruneExpiredRateLimits();

    logger.info({ ...result, pruned }, "cron sweep finished");
    res.json({ ok: true, ...result, rateLimitRowsPruned: pruned });
  } catch (err) {
    // runScheduledSweep has already recorded the failure against
    // SweepRun, which is what /api/health reads. Returning 500 is what
    // makes the platform's own cron log show it too.
    logger.error({ err }, "cron sweep failed");
    res.status(500).json({ ok: false, error: "Sweep failed." });
  }
});
