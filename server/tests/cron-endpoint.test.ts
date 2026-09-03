/**
 * The cron sweep endpoint, which is the one route in the application
 * that runs privileged work with no session behind it.
 *
 * Two properties matter enough to pin down, and neither needs a
 * database: an unauthenticated caller is refused before anything runs,
 * and the route does not exist at all on a deployment whose own worker
 * owns the schedule. Both rejections return before the first query, so
 * this belongs in the unit suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const SECRET = "cron-secret-of-sufficient-length";

const BASE_ENV = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:4000",
  DATABASE_URL: "postgresql://bioguard:pw@localhost:5432/bioguard_test",
  SESSION_SECRET: "a-session-secret-that-is-long-enough-to-pass",
};

const saved = { ...process.env };

/**
 * env.ts validates once, at import, so each mode needs a fresh module
 * graph rather than a mutated object.
 */
async function appFor(overrides: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, BASE_ENV, overrides);
  const { createApp } = await import("../src/app.js");
  return createApp();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...saved };
});

describe("cron sweep endpoint", () => {
  describe("in cron mode", () => {
    const cronMode = { SCHEDULER_MODE: "cron", CRON_SECRET: SECRET };

    it("refuses a request carrying no secret", async () => {
      const app = await appFor(cronMode);
      await request(app).get("/api/cron/sweep").expect(401);
    });

    it("refuses a wrong secret of the same length", async () => {
      // Same length, so the rejection cannot come from the length check
      // alone — this is the comparison itself being exercised.
      const wrong = "x".repeat(SECRET.length);
      expect(wrong).toHaveLength(SECRET.length);

      const app = await appFor(cronMode);
      await request(app)
        .get("/api/cron/sweep")
        .set("authorization", `Bearer ${wrong}`)
        .expect(401);
    });

    it("refuses a secret of a different length without erroring", async () => {
      // timingSafeEqual throws on mismatched lengths. If that throw
      // escaped, this would be a 500 and the response would tell an
      // attacker the length was wrong rather than the value.
      const app = await appFor(cronMode);
      await request(app)
        .get("/api/cron/sweep")
        .set("authorization", "Bearer short")
        .expect(401);
    });

    it("refuses the bare secret without the Bearer scheme", async () => {
      const app = await appFor(cronMode);
      await request(app).get("/api/cron/sweep").set("authorization", SECRET).expect(401);
    });
  });

  describe("in worker mode", () => {
    it("does not mount the route at all", async () => {
      // The Docker deployment's pg-boss worker owns the schedule, so
      // there is no reason to carry a second, secret-only trigger there.
      // 404 rather than 401: the route is absent, not merely guarded.
      const app = await appFor({ SCHEDULER_MODE: "worker" });
      await request(app)
        .get("/api/cron/sweep")
        .set("authorization", `Bearer ${SECRET}`)
        .expect(404);
    });
  });
});
