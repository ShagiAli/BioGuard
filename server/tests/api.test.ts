/**
 * Integration tests against a real Postgres database.
 *
 * These assert the properties that unit tests cannot reach: that
 * authorisation actually filters rows, that the QR token never leaves
 * in a list payload, and that recording maintenance moves the schedule
 * the way the rules say it should.
 *
 * Requires a database. Run `npm run test:integration` with Docker up;
 * CI provides one as a service container.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/security.js";

const prisma = new PrismaClient();
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
async function login(email: string, password = PASSWORD): Promise<string[]> {
  const res = await request(app).post("/api/auth/login").send({ email, password }).expect(200);

  const raw = res.headers["set-cookie"] as string[] | string | undefined;
  expect(raw, "login returned no session cookie").toBeDefined();
  return Array.isArray(raw) ? raw : [raw as string];
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  const { createApp } = await import("../src/app.js");
  app = createApp();

  // Clean slate. Order matters: children before parents.
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
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
