/**
 * Seeds a fictional hospital. Deterministic, so the demo shows the same
 * numbers every time it is reset.
 *
 * No password is hardcoded. If SEED_ADMIN_PASSWORD and
 * SEED_DEMO_PASSWORD are unset, random ones are generated and printed
 * once — a repository containing admin/admin123 ships with a back door.
 *
 * Set both in .env to get stable logins every time, which is what a
 * public demo wants: the credentials are published anyway, and a
 * reviewer following the README should not find them changed.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { generateToken, hashPassword } from "../src/lib/security.js";

const prisma = new PrismaClient();

const HOSPITAL = "Northfield Teaching Hospital";
const TODAY = new Date();

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260814);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(day(d).getTime() + n * 86_400_000);

const CATEGORIES = [
  { name: "Ventilator", defaultInterval: 90, criticality: "CRITICAL" },
  { name: "Anaesthesia machine", defaultInterval: 90, criticality: "CRITICAL" },
  { name: "Defibrillator", defaultInterval: 90, criticality: "CRITICAL" },
  { name: "Infant incubator", defaultInterval: 90, criticality: "CRITICAL" },
  { name: "Dialysis machine", defaultInterval: 120, criticality: "CRITICAL" },
  { name: "Patient monitor", defaultInterval: 180, criticality: "HIGH" },
  { name: "Infusion pump", defaultInterval: 180, criticality: "HIGH" },
  { name: "Syringe pump", defaultInterval: 180, criticality: "HIGH" },
  { name: "Autoclave", defaultInterval: 180, criticality: "HIGH" },
  { name: "X-ray unit", defaultInterval: 365, criticality: "HIGH" },
  { name: "ECG machine", defaultInterval: 180, criticality: "MEDIUM" },
  { name: "Ultrasound scanner", defaultInterval: 365, criticality: "MEDIUM" },
  { name: "Surgical light", defaultInterval: 365, criticality: "MEDIUM" },
  { name: "Centrifuge", defaultInterval: 365, criticality: "MEDIUM" },
  { name: "Pulse oximeter", defaultInterval: 365, criticality: "LOW" },
  { name: "Suction unit", defaultInterval: 365, criticality: "LOW" },
] as const;

const MANUFACTURERS = [
  "Dräger",
  "Philips",
  "GE Healthcare",
  "Mindray",
  "Siemens Healthineers",
  "Nihon Kohden",
  "B. Braun",
  "Fresenius",
  "Getinge",
  "Medtronic",
] as const;

const DEPARTMENTS = [
  { name: "Intensive care", building: "A Block", floor: 3 },
  { name: "Emergency", building: "A Block", floor: 0 },
  { name: "Operating theatres", building: "A Block", floor: 2 },
  { name: "Neonatal ICU", building: "B Block", floor: 3 },
  { name: "Cardiology", building: "B Block", floor: 1 },
  { name: "Paediatrics", building: "B Block", floor: 2 },
  { name: "Dialysis unit", building: "C Block", floor: 1 },
  { name: "Radiology", building: "C Block", floor: 0 },
  { name: "Internal medicine", building: "C Block", floor: 2 },
  { name: "Laboratory", building: "C Block", floor: 3 },
] as const;

async function main() {
  console.log(`Seeding ${HOSPITAL}…`);

  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.notificationDispatch.deleteMany(),
    // Mail is addressed by email string, not by foreign key, so it
    // survives the user rows being deleted. Without this, reminders
    // from the previous seed reappear in the new engineers' mailboxes.
    prisma.sentEmail.deleteMany(),
    prisma.maintenanceRecord.deleteMany(),
    prisma.equipment.deleteMany(),
    prisma.session.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.room.deleteMany(),
    prisma.building.deleteMany(),
    prisma.department.deleteMany(),
    prisma.equipmentCategory.deleteMany(),
    prisma.manufacturer.deleteMany(),
  ]);

  const buildings = new Map<string, string>();
  for (const name of ["A Block", "B Block", "C Block"]) {
    const b = await prisma.building.create({ data: { name } });
    buildings.set(name, b.id);
  }

  const departments = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const created = await prisma.department.create({ data: { name: d.name } });
    departments.set(d.name, created.id);
  }

  const rooms = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    for (let i = 1; i <= 6; i++) {
      const code = `${d.floor}${String(i).padStart(2, "0")}`;
      const room = await prisma.room.create({
        data: { buildingId: buildings.get(d.building)!, floor: d.floor, code },
      });
      rooms.set(`${d.name}:${code}`, room.id);
    }
  }

  const categories = new Map<string, { id: string; interval: number; criticality: string }>();
  for (const c of CATEGORIES) {
    const created = await prisma.equipmentCategory.create({
      data: { name: c.name, defaultInterval: c.defaultInterval },
    });
    categories.set(c.name, {
      id: created.id,
      interval: c.defaultInterval,
      criticality: c.criticality,
    });
  }

  const manufacturers = new Map<string, string>();
  for (const name of MANUFACTURERS) {
    const created = await prisma.manufacturer.create({ data: { name } });
    manufacturers.set(name, created.id);
  }

  // --- users -------------------------------------------------------
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || generateToken(12);
  const demoPassword = process.env.SEED_DEMO_PASSWORD || generateToken(12);

  const admin = await prisma.user.create({
    data: {
      email: (process.env.SEED_ADMIN_EMAIL || "admin@bioguard.local").toLowerCase(),
      passwordHash: await hashPassword(adminPassword),
      fullName: "System Administrator",
      role: "ADMIN",
    },
  });

  const engineerNames = ["James Carter", "Sarah Bennett", "Michael Doyle", "Emma Whitfield"];
  const engineers = [];
  for (const [i, fullName] of engineerNames.entries()) {
    engineers.push(
      await prisma.user.create({
        data: {
          email: `engineer${i + 1}@bioguard.local`,
          passwordHash: await hashPassword(demoPassword),
          fullName,
          role: "ENGINEER",
          departmentId: departments.get(DEPARTMENTS[i % DEPARTMENTS.length]!.name)!,
        },
      })
    );
  }

  await prisma.user.create({
    data: {
      email: "manager@bioguard.local",
      passwordHash: await hashPassword(demoPassword),
      fullName: "Laura Hughes",
      role: "MANAGER",
    },
  });

  await prisma.user.create({
    data: {
      email: "nurse@bioguard.local",
      passwordHash: await hashPassword(demoPassword),
      fullName: "Grace Miller",
      role: "STAFF",
      departmentId: departments.get("Intensive care")!,
    },
  });

  // --- equipment ---------------------------------------------------
  const statuses = [
    "OPERATIONAL",
    "OPERATIONAL",
    "OPERATIONAL",
    "OPERATIONAL",
    "OPERATIONAL",
    "OPERATIONAL",
    "UNDER_REPAIR",
    "AWAITING_PARTS",
    "OUT_OF_SERVICE",
  ] as const;

  for (let i = 0; i < 184; i++) {
    const cat = pick(CATEGORIES);
    const meta = categories.get(cat.name)!;
    const dept = pick(DEPARTMENTS);
    const manufacturer = pick(MANUFACTURERS);
    const engineer = pick(engineers);
    const roomCode = `${dept.floor}${String(Math.floor(rnd() * 6) + 1).padStart(2, "0")}`;

    // Spread across the cycle: most healthy, a tail already overdue.
    const position = rnd();
    let elapsed: number;
    if (position > 0.93) elapsed = meta.interval + Math.floor(rnd() * 45) + 2;
    else if (position > 0.82) elapsed = meta.interval - Math.floor(rnd() * 7);
    else if (position > 0.66) elapsed = meta.interval - 8 - Math.floor(rnd() * 22);
    else elapsed = Math.floor(rnd() * Math.max(meta.interval - 30, 10));

    const lastCompletedAt = addDays(TODAY, -elapsed);
    const seq = String(i + 1).padStart(6, "0");

    const device = await prisma.equipment.create({
      data: {
        tag: `BG-EQ-${seq}`,
        publicToken: generateToken(16), // opaque, not derivable from the tag
        assetNo: `${dept.building.charAt(0)}${1000 + i}`,
        name: cat.name,
        categoryId: meta.id,
        manufacturerId: manufacturers.get(manufacturer)!,
        model: `${manufacturer.slice(0, 3).toUpperCase()}-${100 + Math.floor(rnd() * 800)}`,
        serialNo: String(Math.floor(rnd() * 900000) + 100000),
        departmentId: departments.get(dept.name)!,
        roomId: rooms.get(`${dept.name}:${roomCode}`) ?? null,
        criticality: meta.criticality as never,
        operationalStatus: pick(statuses) as never,
        engineerId: engineer.id,
        intervalDays: meta.interval,
        intervalSource: rnd() > 0.75 ? "HOSPITAL_POLICY" : "MANUFACTURER",
        scheduleMode: meta.interval >= 365 && rnd() > 0.6 ? "ANCHORED" : "GRACE",
        lastCompletedAt,
        nextDueAt: addDays(lastCompletedAt, meta.interval),
        installedAt: addDays(TODAY, -Math.floor(rnd() * 3600) - 200),
        purchasePrice: Math.floor(rnd() * 400000) + 15000,
        warrantyEndsAt: addDays(TODAY, Math.floor(rnd() * 900) - 400),
      },
    });

    await prisma.maintenanceRecord.create({
      data: {
        equipmentId: device.id,
        type: "PREVENTIVE",
        completedOn: lastCompletedAt,
        engineerId: engineer.id,
        workPerformed: "Scheduled service completed. Functional and safety checks passed.",
        cost: Math.floor(rnd() * 3000) + 250,
        downtimeHours: Math.floor(rnd() * 5) + 1,
        nextDueAfter: addDays(lastCompletedAt, meta.interval),
      },
    });
  }

  console.log("\nSeed complete. 184 devices across 10 departments.\n");
  console.log("  Administrator:  " + admin.email + "  /  " + adminPassword);
  console.log("  Engineer:       engineer1@bioguard.local  /  " + demoPassword);
  console.log("  Manager:        manager@bioguard.local  /  " + demoPassword);
  console.log("  Ward staff:     nurse@bioguard.local  /  " + demoPassword);
  console.log("\nThese are printed once. Note them now.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
