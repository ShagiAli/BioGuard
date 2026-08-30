/**
 * Integration tests against a real Postgres database.
 *
 * These assert the properties that unit tests cannot reach: that
 * authorisation actually filters rows, that the QR token never leaves
 * in a list payload, and that recording maintenance moves the schedule
 * the way the rules say it should.
 *
 * Requires a database, and a dedicated one — see assertTestDatabase
 * below. CI provides it as a service container.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/security.js";
import { assertTestDatabase } from "./assert-test-database.js";
let app: Express;

const PASSWORD = "correct-horse-battery-staple";

interface Seeded {
  engineerEmail: string;
  otherEngineerEmail: string;
  adminEmail: string;
  ownDeviceId: string;
  otherDeviceId: string;
}

let seeded: Seeded;

/**
 * Signs in and returns the session cookie.
 *
 * `set-cookie` is typed as possibly absent, which is honest — a login
 * that returns 200 without a cookie would be a real bug. Asserting it
 * here means every caller gets a defined value and a missing cookie
 * fails loudly at the point it happens.
 */
const sessions = new Map<string, string[]>();

async function login(email: string, password = PASSWORD): Promise<string[]> {
  // Cached per user. The account limiter allows ten attempts per quarter
  // hour keyed on the submitted address, and that ceiling is a real
  // defence worth keeping at its production value in tests — so the
  // suite reuses sessions instead of raising it. Argon2 verification is
  // deliberately slow, so this is also the faster path.
  const cached = sessions.get(email);
  if (cached) return cached;

  const res = await request(app).post("/api/auth/login").send({ email, password }).expect(200);

  const raw = res.headers["set-cookie"] as string[] | string | undefined;
  expect(raw, "login returned no session cookie").toBeDefined();
  const cookie = Array.isArray(raw) ? raw : [raw as string];
  sessions.set(email, cookie);
  return cookie;
}

beforeAll(async () => {
  // Before anything destructive happens.
  assertTestDatabase(process.env.DATABASE_URL);

  process.env.NODE_ENV = "test";
  const { createApp } = await import("../src/app.js");
  app = createApp();

  // Clean slate. Order matters: children before parents.
  await prisma.auditLog.deleteMany();
  await prisma.sweepRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.sentEmail.deleteMany();
  await prisma.notificationDispatch.deleteMany();
  await prisma.maintenanceRecord.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.session.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.room.deleteMany();
  await prisma.building.deleteMany();
  await prisma.department.deleteMany();
  await prisma.equipmentCategory.deleteMany();
  await prisma.manufacturer.deleteMany();

  const hash = await hashPassword(PASSWORD);
  const [icu, theatre] = await Promise.all([
    prisma.department.create({ data: { name: "Intensive care" } }),
    prisma.department.create({ data: { name: "Operating theatres" } }),
  ]);
  const category = await prisma.equipmentCategory.create({
    data: { name: "Ventilator", defaultInterval: 90 },
  });
  const manufacturer = await prisma.manufacturer.create({ data: { name: "TestCorp" } });

  const engineer = await prisma.user.create({
    data: {
      email: "eng.icu@test.local",
      passwordHash: hash,
      fullName: "ICU Engineer",
      role: "ENGINEER",
      departmentId: icu.id,
    },
  });
  const other = await prisma.user.create({
    data: {
      email: "eng.theatre@test.local",
      passwordHash: hash,
      fullName: "Theatre Engineer",
      role: "ENGINEER",
      departmentId: theatre.id,
    },
  });
  const admin = await prisma.user.create({
    data: { email: "admin@test.local", passwordHash: hash, fullName: "Admin", role: "ADMIN" },
  });

  const base = {
    categoryId: category.id,
    manufacturerId: manufacturer.id,
    model: "T-1",
    criticality: "CRITICAL" as const,
    intervalDays: 90,
    scheduleMode: "GRACE" as const,
  };

  const ownDevice = await prisma.equipment.create({
    data: {
      ...base,
      tag: "BG-EQ-900001",
      publicToken: "test-token-own-000000001",
      assetNo: "T9001",
      name: "ICU Ventilator",
      serialNo: "111111",
      departmentId: icu.id,
      engineerId: engineer.id,
      lastCompletedAt: new Date("2026-05-01"),
      nextDueAt: new Date("2026-07-30"),
    },
  });

  const otherDevice = await prisma.equipment.create({
    data: {
      ...base,
      tag: "BG-EQ-900002",
      publicToken: "test-token-other-00000001",
      assetNo: "T9002",
      name: "Theatre Ventilator",
      serialNo: "222222",
      departmentId: theatre.id,
      engineerId: other.id,
      lastCompletedAt: new Date("2026-06-01"),
      nextDueAt: new Date("2026-08-30"),
    },
  });

  seeded = {
    engineerEmail: engineer.email,
    otherEngineerEmail: other.email,
    adminEmail: admin.email,
    ownDeviceId: ownDevice.id,
    otherDeviceId: otherDevice.id,
  };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("authentication", () => {
  it("rejects an unauthenticated request", async () => {
    await request(app).get("/api/equipment/summary").expect(401);
  });

  it("issues a session on valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: seeded.engineerEmail, password: PASSWORD })
      .expect(200);

    expect(res.body.user.email).toBe(seeded.engineerEmail);
    const cookies = String(res.headers["set-cookie"]);
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Strict");
    // The session token must never be readable by scripts.
    expect(res.body).not.toHaveProperty("token");
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: seeded.engineerEmail, password: "nope" })
      .expect(401);
    const missing = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.local", password: "nope" })
      .expect(401);

    // Differing messages would turn login into an account-enumeration oracle.
    expect(wrong.body.error).toBe(missing.body.error);
  });

  it("does not reveal whether an email exists on password reset", async () => {
    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: seeded.engineerEmail })
      .expect(200);
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ghost@test.local" })
      .expect(200);

    expect(known.body).toEqual(unknown.body);
  });
});

describe("authorisation and scoping", () => {
  it("shows an engineer only their own department", async () => {
    const cookie = await login(seeded.engineerEmail);
    const res = await request(app).get("/api/equipment").set("Cookie", cookie).expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].assetNo).toBe("T9001");
  });

  it("shows an administrator the whole estate", async () => {
    const cookie = await login(seeded.adminEmail);
    const res = await request(app).get("/api/equipment").set("Cookie", cookie).expect(200);
    expect(res.body.total).toBe(2);
  });

  it("returns 404, not 403, for a device outside scope", async () => {
    const cookie = await login(seeded.engineerEmail);
    // A 403 would confirm the record exists, which is itself a disclosure.
    await request(app)
      .get(`/api/equipment/${seeded.otherDeviceId}`)
      .set("Cookie", cookie)
      .expect(404);
  });

  it("refuses to record maintenance on a device outside scope", async () => {
    const cookie = await login(seeded.engineerEmail);
    await request(app)
      .post("/api/maintenance")
      .set("Cookie", cookie)
      .send({
        equipmentId: seeded.otherDeviceId,
        type: "PREVENTIVE",
        completedOn: "2026-08-01",
        workPerformed: "Should not be permitted",
      })
      .expect(404);
  });

  it("blocks a non-admin from the scheduler simulation", async () => {
    const cookie = await login(seeded.engineerEmail);
    await request(app)
      .post("/api/admin/simulate")
      .set("Cookie", cookie)
      .send({ days: 30 })
      .expect(403);
  });
});

describe("data exposure", () => {
  it("never returns the QR token in a list or detail payload", async () => {
    const cookie = await login(seeded.adminEmail);

    const list = await request(app).get("/api/equipment").set("Cookie", cookie).expect(200);
    for (const row of list.body.rows) {
      expect(row).not.toHaveProperty("publicToken");
    }

    const detail = await request(app)
      .get(`/api/equipment/${seeded.ownDeviceId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(detail.body).not.toHaveProperty("publicToken");
  });

  it("serves the public scan endpoint without a session, minimally", async () => {
    const res = await request(app)
      .get("/api/equipment/public/test-token-own-000000001")
      .expect(200);

    expect(res.body.assetNo).toBe("T9001");
    // Nothing beyond what somebody standing at the bedside needs.
    expect(res.body).not.toHaveProperty("purchasePrice");
    expect(res.body).not.toHaveProperty("maintenance");
    expect(res.body).not.toHaveProperty("id");
  });

  it("rejects mass assignment of fields the caller may not set", async () => {
    const cookie = await login(seeded.adminEmail);
    await request(app)
      .patch(`/api/equipment/${seeded.ownDeviceId}/status`)
      .set("Cookie", cookie)
      .send({ operationalStatus: "UNDER_REPAIR", intervalDays: 1, criticality: "LOW" })
      .expect(400); // .strict() refuses unknown keys outright
  });
});

describe("recording maintenance", () => {
  it("moves the schedule and records the lateness", async () => {
    const cookie = await login(seeded.adminEmail);

    const res = await request(app)
      .post("/api/maintenance")
      .set("Cookie", cookie)
      .send({
        equipmentId: seeded.ownDeviceId,
        type: "PREVENTIVE",
        completedOn: "2026-08-05",
        workPerformed: "Annual service, all checks passed",
        cost: 1200,
        downtimeHours: 3,
      })
      .expect(201);

    // Due 30 Jul, done 5 Aug: 6 days late, inside the 18-day window, so
    // the anchor holds at 30 Jul + 90 days.
    expect(res.body.schedule.rebased).toBe(false);
    expect(res.body.schedule.latenessDays).toBe(6);
    expect(res.body.nextDueAt.slice(0, 10)).toBe("2026-10-28");
  });

  it("refuses a completion date in the future", async () => {
    const cookie = await login(seeded.adminEmail);
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    await request(app)
      .post("/api/maintenance")
      .set("Cookie", cookie)
      .send({
        equipmentId: seeded.ownDeviceId,
        type: "PREVENTIVE",
        completedOn: future,
        workPerformed: "Time travel",
      })
      .expect(400);
  });

  it("requires a description of the work", async () => {
    const cookie = await login(seeded.adminEmail);
    await request(app)
      .post("/api/maintenance")
      .set("Cookie", cookie)
      .send({
        equipmentId: seeded.ownDeviceId,
        type: "PREVENTIVE",
        completedOn: "2026-08-05",
        workPerformed: "",
      })
      .expect(400);
  });
});

describe("mailbox", () => {
  /**
   * Mail is addressed by email string rather than by a user relation,
   * so scoping here is a different code path from the equipment scope
   * and needs its own coverage.
   */
  async function seedMail() {
    await prisma.sentEmail.deleteMany();
    await prisma.sentEmail.createMany({
      data: [
        { to: seeded.engineerEmail, subject: "Read, mine", body: "x", readAt: new Date() },
        { to: seeded.engineerEmail, subject: "Unread, mine", body: "x" },
        { to: seeded.otherEngineerEmail, subject: "Read, theirs", body: "x", readAt: new Date() },
      ],
    });
  }

  it("shows an engineer only their own mail", async () => {
    await seedMail();
    const cookie = await login(seeded.engineerEmail);
    const res = await request(app).get("/api/mail").set("Cookie", cookie).expect(200);

    expect(res.body.rows).toHaveLength(2);
    expect(res.body.scope).toBe("own");
    for (const row of res.body.rows) {
      expect(row.to).toBe(seeded.engineerEmail);
    }
  });

  it("shows an administrator the whole outbox", async () => {
    await seedMail();
    const cookie = await login(seeded.adminEmail);
    const res = await request(app).get("/api/mail").set("Cookie", cookie).expect(200);

    expect(res.body.rows).toHaveLength(3);
    expect(res.body.scope).toBe("all");
  });

  it("refuses to delete a message belonging to someone else", async () => {
    await seedMail();
    const theirs = await prisma.sentEmail.findFirstOrThrow({
      where: { to: seeded.otherEngineerEmail },
    });

    const cookie = await login(seeded.engineerEmail);
    // 404 rather than 403: confirming the message exists is a disclosure.
    await request(app).delete(`/api/mail/${theirs.id}`).set("Cookie", cookie).expect(404);

    expect(await prisma.sentEmail.count({ where: { id: theirs.id } })).toBe(1);
  });

  it("deletes only the caller's own read mail in bulk", async () => {
    await seedMail();
    const cookie = await login(seeded.engineerEmail);

    const res = await request(app).delete("/api/mail/read").set("Cookie", cookie).expect(200);
    expect(res.body.deleted).toBe(1);

    // The unread one survives — losing an unseen reminder is the one
    // failure a mailbox must not have.
    const mine = await prisma.sentEmail.findMany({ where: { to: seeded.engineerEmail } });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.readAt).toBeNull();

    // And another engineer's mail is untouched.
    expect(await prisma.sentEmail.count({ where: { to: seeded.otherEngineerEmail } })).toBe(1);
  });
});

describe("scheduler idempotency", () => {
  it("does not send the same reminder twice", async () => {
    const cookie = await login(seeded.adminEmail);

    const first = await request(app)
      .post("/api/admin/simulate")
      .set("Cookie", cookie)
      .send({ days: 120 })
      .expect(200);

    const second = await request(app)
      .post("/api/admin/simulate")
      .set("Cookie", cookie)
      .send({ days: 120 })
      .expect(200);

    expect(first.body.notificationsSent).toBeGreaterThan(0);
    // The unique constraint on NotificationDispatch is what enforces this.
    expect(second.body.notificationsSent).toBe(0);
  });
});

describe("audit trail", () => {
  /**
   * The audit rows are produced by real requests rather than inserted
   * directly, so these also assert that recordAudit is still wired into
   * the routes that are supposed to write it.
   */
  async function changeStatus(status: string) {
    const cookie = await login(seeded.adminEmail);
    await request(app)
      .patch(`/api/equipment/${seeded.ownDeviceId}/status`)
      .set("Cookie", cookie)
      .send({ operationalStatus: status })
      .expect(200);
  }

  it("records what changed, and the allowlist keeps the rest out", async () => {
    await changeStatus("UNDER_REPAIR");

    const cookie = await login(seeded.adminEmail);
    const res = await request(app)
      .get(`/api/equipment/${seeded.ownDeviceId}/audit`)
      .set("Cookie", cookie)
      .expect(200);

    const entry = res.body.rows[0];
    expect(entry.action).toBe("equipment.status_changed");
    expect(entry.after.operationalStatus).toBe("UNDER_REPAIR");
    expect(entry.actor.fullName).toBe("Admin");
    // The writer takes named fields only; a whole row would carry more.
    expect(entry.after).not.toHaveProperty("publicToken");
    expect(entry.after).not.toHaveProperty("id");
  });

  it("lets the responsible engineer read their own device's history", async () => {
    await changeStatus("OPERATIONAL");

    const cookie = await login(seeded.engineerEmail);
    const res = await request(app)
      .get(`/api/equipment/${seeded.ownDeviceId}/audit`)
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body.rows.length).toBeGreaterThan(0);
  });

  it("returns 404, not 403, for a device outside scope", async () => {
    const cookie = await login(seeded.engineerEmail);
    // Same disclosure rule as the device itself: a 403 would confirm it exists.
    await request(app)
      .get(`/api/equipment/${seeded.otherDeviceId}/audit`)
      .set("Cookie", cookie)
      .expect(404);
  });

  it("keeps the estate-wide feed to the oversight roles", async () => {
    const engineer = await login(seeded.engineerEmail);
    await request(app).get("/api/audit").set("Cookie", engineer).expect(403);

    const admin = await login(seeded.adminEmail);
    const res = await request(app).get("/api/audit").set("Cookie", admin).expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    // Entries resolve to the device they describe, for a readable feed.
    expect(res.body.rows[0].equipment.assetNo).toBe("T9001");
  });

  it("filters the feed by action, which is what makes a slippage report", async () => {
    const cookie = await login(seeded.adminEmail);
    const res = await request(app)
      .get("/api/audit?action=equipment.status_changed")
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body.rows.length).toBeGreaterThan(0);
    for (const row of res.body.rows) {
      expect(row.action).toBe("equipment.status_changed");
    }
  });

  it("rejects an unknown filter key outright", async () => {
    const cookie = await login(seeded.adminEmail);
    await request(app).get("/api/audit?nonsense=1").set("Cookie", cookie).expect(400);
  });
});

describe("scheduler health", () => {
  it("reports the scheduler without requiring a session, but only coarsely", async () => {
    const res = await request(app).get("/api/health").expect(200);

    expect(res.body.status).toBe("ok");
    // The suite never starts a scheduler, so this is the degraded case.
    expect(res.body.scheduler.healthy).toBe(false);
    // Unauthenticated: no timestamps, no failure text.
    expect(res.body.scheduler).not.toHaveProperty("lastSweepAt");
    expect(res.body.scheduler).not.toHaveProperty("lastError");
  });

  it("stays 200 when the scheduler is down", async () => {
    // The container HEALTHCHECK exits non-zero on a non-2xx, and the API
    // is deliberately usable without the scheduler. Failing here would
    // turn a degraded system into a restart loop.
    await request(app).get("/api/health").expect(200);
  });

  it("keeps the detailed view to the oversight roles", async () => {
    const engineer = await login(seeded.engineerEmail);
    await request(app).get("/api/admin/scheduler").set("Cookie", engineer).expect(403);

    const admin = await login(seeded.adminEmail);
    const res = await request(app).get("/api/admin/scheduler").set("Cookie", admin).expect(200);
    expect(res.body.running).toBe(false);
    expect(res.body.freshness).toBe("unknown");
    expect(res.body.staleAfterHours).toBe(26);
  });

  it("does not count the admin simulation as a nightly run", async () => {
    const cookie = await login(seeded.adminEmail);
    await request(app).post("/api/admin/simulate").set("Cookie", cookie).send({ days: 30 });

    // A hand-run must not make a dead cron look alive.
    expect(await prisma.sweepRun.count()).toBe(0);

    const res = await request(app).get("/api/admin/scheduler").set("Cookie", cookie).expect(200);
    expect(res.body.lastSweepAt).toBeNull();
  });
});
