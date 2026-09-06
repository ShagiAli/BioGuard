/**
 * Seeds a fictional hospital.
 *
 * The fleet is twenty devices, each one written down with the dates that
 * put it where it is. An earlier version rolled 184 from a seeded PRNG,
 * which was reproducible but not meaningful: the same arbitrary numbers
 * every time rather than a position anyone chose. See DEVICES below.
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
import { prisma } from "../src/lib/prisma.js";
import { generateToken, hashPassword } from "../src/lib/security.js";

const HOSPITAL = "Northfield Teaching Hospital";
const TODAY = new Date();

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

  /**
   * The reset, as one transaction so a half-cleared database is never a
   * state anybody sees.
   *
   * The timeout is raised well above Prisma's 5s default because this is
   * seventeen statements and therefore seventeen round trips. Against
   * localhost that is milliseconds; against a managed database on
   * another continent it is seconds, and the default expires mid-way —
   * P2028, with every statement reported as a separate failure. The
   * work has not grown, only the distance, so the honest fix is a limit
   * that reflects how far away the database might be rather than
   * splitting a reset that ought to be atomic.
   */
  await prisma.$transaction(
    [
      prisma.auditLog.deleteMany(),
      // Stale sweep rows would make a freshly reset demo report a
      // healthy cron that has never actually run.
      prisma.sweepRun.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.notificationDispatch.deleteMany(),
      // Work orders reference alerts, and alerts reference the users and
      // equipment deleted below.
      prisma.workOrder.deleteMany(),
      prisma.alert.deleteMany(),
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
    ],
    { maxWait: 10_000, timeout: 30_000 }
  );

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

  const alertsHead = await prisma.user.create({
    data: {
      email: "alerts@bioguard.local",
      passwordHash: await hashPassword(demoPassword),
      fullName: "Priya Raman",
      role: "HEAD_OF_ALERTS",
    },
  });

  const nurse = await prisma.user.create({
    data: {
      email: "nurse@bioguard.local",
      passwordHash: await hashPassword(demoPassword),
      fullName: "Grace Miller",
      role: "STAFF",
      departmentId: departments.get("Intensive care")!,
    },
  });

  // --- equipment ---------------------------------------------------
  /**
   * Twenty devices, written down rather than rolled.
   *
   * The previous seed generated 184 at random. It filled the screens,
   * but it meant nothing: the overdue list was whatever the dice said,
   * and the ward with the worst backlog changed on every reset. Twenty
   * named devices with chosen dates make the demo legible — every figure
   * on the dashboard traces to a device you can point at, and the ones
   * that are off the floor carry the alert and the work order that put
   * them there.
   *
   * `sincePM` is days since the last preventive service. Subtract it
   * from the category interval to read the device's position: negative
   * is overdue, and that subtraction is the whole dataset. Everything is
   * relative to the day the seed runs, so the shape holds however long
   * the demo sits between resets — five overdue, five due inside a
   * month, six devices unavailable.
   */
  const DEVICES = [
    // Overdue. The first is the one that should hurt: a ventilator, out
    // of service, two months past a ninety-day service.
    {
      name: "Ventilator",
      dept: "Intensive care",
      room: 1,
      mfr: "Dräger",
      model: "Evita V600",
      serial: "ARZM-44718",
      status: "OUT_OF_SERVICE",
      sincePM: 147,
      installed: 2190,
      price: 41200,
      warranty: -240,
      fault: {
        priority: "EMERGENCY",
        status: "IN_PROGRESS",
        raisedDaysAgo: 9,
        ackHours: 1,
        engineer: 0,
        description:
          "Ventilator failed self-test on start-up and will not deliver volume. Taken out of service and swapped for the spare.",
        wo: {
          status: "AWAITING_PARTS",
          findings:
            "Self-test fails at the flow sensor stage. Sensor reads zero against a known flow.",
          diagnosis:
            "Expiratory flow sensor assembly has failed. Not field-repairable — needs the sealed unit.",
          part: {
            name: "Expiratory flow sensor assembly",
            partNumber: "DR-8412-EX",
            status: "ORDERED",
            orderedDaysAgo: 6,
          },
        },
      },
    },
    {
      name: "Defibrillator",
      dept: "Emergency",
      room: 2,
      mfr: "Philips",
      model: "HeartStart XL+",
      serial: "PH-99210",
      status: "OPERATIONAL",
      sincePM: 118,
      installed: 1460,
      price: 12800,
      warranty: 120,
    },
    {
      name: "Infant incubator",
      dept: "Neonatal ICU",
      room: 1,
      mfr: "Getinge",
      model: "Isolette 8000",
      serial: "GT-31088",
      status: "AWAITING_PARTS",
      sincePM: 104,
      installed: 1825,
      price: 28600,
      warranty: -95,
      fault: {
        priority: "EMERGENCY",
        status: "ASSIGNED",
        raisedDaysAgo: 4,
        ackHours: 2,
        engineer: 3,
        description:
          "Incubator will not hold set temperature — drifts 1.5°C low over an hour. Infant moved to the adjacent unit.",
        wo: {
          status: "AWAITING_PARTS",
          findings:
            "Chamber heats slowly and undershoots setpoint. Air probe agrees with an external thermometer, so the reading is not the problem.",
          diagnosis: "Heater element degraded. Replacement quoted at eight working days.",
          part: {
            name: "Heater element, 230V",
            partNumber: "GT-HE-230",
            status: "REQUESTED",
            requestedDaysAgo: 3,
          },
        },
      },
    },
    {
      name: "Dialysis machine",
      dept: "Dialysis unit",
      room: 3,
      mfr: "Fresenius",
      model: "5008S CorDiax",
      serial: "FR-70452",
      status: "OPERATIONAL",
      sincePM: 131,
      installed: 1095,
      price: 24900,
      warranty: 210,
    },
    {
      name: "Autoclave",
      dept: "Operating theatres",
      room: 2,
      mfr: "Getinge",
      model: "HS66",
      serial: "GT-55031",
      status: "UNDER_REPAIR",
      sincePM: 189,
      installed: 2920,
      price: 47500,
      warranty: -640,
      fault: {
        priority: "MEDIUM",
        status: "IN_PROGRESS",
        raisedDaysAgo: 2,
        ackHours: 3,
        engineer: 1,
        description:
          "Cycle aborting at the drying stage with a door-seal fault. Theatre list moved to the second autoclave.",
        wo: {
          status: "IN_REPAIR",
          findings: "Door gasket has taken a set and no longer seals under vacuum.",
          diagnosis: "Gasket replacement and a vacuum-hold test. Spare held in stores.",
        },
      },
    },

    // Due inside thirty days. Nothing wrong with these yet — they are
    // what the reminder engine exists to catch before the group above
    // happens again.
    {
      name: "Anaesthesia machine",
      dept: "Operating theatres",
      room: 1,
      mfr: "Dräger",
      model: "Perseus A500",
      serial: "DR-11723",
      status: "OPERATIONAL",
      sincePM: 87,
      installed: 1460,
      price: 68400,
      warranty: 45,
    },
    {
      name: "Patient monitor",
      dept: "Intensive care",
      room: 2,
      mfr: "Philips",
      model: "IntelliVue MX750",
      serial: "PH-40217",
      status: "OPERATIONAL",
      sincePM: 173,
      installed: 1095,
      price: 14300,
      warranty: 300,
    },
    {
      name: "Infusion pump",
      dept: "Paediatrics",
      room: 4,
      mfr: "B. Braun",
      model: "Infusomat Space",
      serial: "BB-62094",
      status: "OPERATIONAL",
      sincePM: 166,
      installed: 730,
      price: 2450,
      warranty: 400,
    },
    {
      name: "X-ray unit",
      dept: "Radiology",
      room: 1,
      mfr: "Siemens Healthineers",
      model: "Ysio Max",
      serial: "SI-20884",
      status: "OPERATIONAL",
      sincePM: 344,
      installed: 2555,
      price: 186000,
      warranty: -420,
    },
    {
      name: "Syringe pump",
      dept: "Neonatal ICU",
      room: 2,
      mfr: "B. Braun",
      model: "Perfusor Space",
      serial: "BB-73310",
      status: "OPERATIONAL",
      sincePM: 152,
      installed: 1095,
      price: 1980,
      warranty: 165,
    },

    // Off the floor for reasons that have nothing to do with the service
    // schedule. A device can be broken and perfectly up to date.
    {
      name: "Ultrasound scanner",
      dept: "Radiology",
      room: 3,
      mfr: "GE Healthcare",
      model: "Logiq E10",
      serial: "GE-58127",
      status: "UNDER_REPAIR",
      sincePM: 96,
      installed: 1460,
      price: 92700,
      warranty: 60,
      fault: {
        priority: "MEDIUM",
        status: "IN_PROGRESS",
        raisedDaysAgo: 5,
        ackHours: 6,
        engineer: 2,
        description:
          "Intermittent dropout on the curvilinear probe — image freezes for a second or two mid-scan.",
        wo: {
          status: "INVESTIGATING",
          findings:
            "Fault follows the probe rather than the port, so the console is likely fine. Swapped to a loan probe to confirm.",
        },
      },
    },
    {
      name: "ECG machine",
      dept: "Cardiology",
      room: 2,
      mfr: "Nihon Kohden",
      model: "ECG-2550",
      serial: "NK-13905",
      status: "AWAITING_PARTS",
      sincePM: 41,
      installed: 1825,
      price: 6200,
      warranty: -310,
      fault: {
        priority: "LOW",
        status: "ASSIGNED",
        raisedDaysAgo: 11,
        ackHours: 20,
        engineer: 1,
        description: "Two chest leads reading noise. Traced to the patient cable, not the machine.",
        wo: {
          status: "AWAITING_PARTS",
          findings: "Cable continuity fails on V3 and V4. Machine passes on a known-good cable.",
          diagnosis: "Replace the ten-lead patient cable.",
          part: {
            name: "10-lead patient cable",
            partNumber: "NK-PC-2550",
            status: "ORDERED",
            orderedDaysAgo: 7,
          },
        },
      },
    },
    // Raised and never picked up. The SLA clock on this one has been
    // running for two days, which is the case the alert queue exists to
    // make visible.
    {
      name: "Suction unit",
      dept: "Emergency",
      room: 5,
      mfr: "Medtronic",
      model: "SU-200",
      serial: "MD-84663",
      status: "OUT_OF_SERVICE",
      sincePM: 210,
      installed: 2190,
      price: 1150,
      warranty: -730,
      fault: {
        priority: "MEDIUM",
        status: "OPEN",
        raisedDaysAgo: 2,
        description:
          "No suction at the wall unit. Canister seals look intact. Bay taken out of use.",
      },
    },

    // Healthy, spread across the cycle so the fleet does not read as a
    // hospital where everything is broken.
    {
      name: "Ventilator",
      dept: "Intensive care",
      room: 3,
      mfr: "Dräger",
      model: "Evita V600",
      serial: "ARZM-44720",
      status: "OPERATIONAL",
      sincePM: 22,
      installed: 1095,
      price: 41200,
      warranty: 480,
    },
    {
      name: "Defibrillator",
      dept: "Cardiology",
      room: 1,
      mfr: "Philips",
      model: "HeartStart XL+",
      serial: "PH-99244",
      status: "OPERATIONAL",
      sincePM: 45,
      installed: 730,
      price: 12800,
      warranty: 560,
    },
    {
      name: "Patient monitor",
      dept: "Cardiology",
      room: 3,
      mfr: "Mindray",
      model: "BeneVision N15",
      serial: "MR-27519",
      status: "OPERATIONAL",
      sincePM: 35,
      installed: 365,
      price: 11700,
      warranty: 640,
    },
    {
      name: "Infusion pump",
      dept: "Intensive care",
      room: 4,
      mfr: "B. Braun",
      model: "Infusomat Space",
      serial: "BB-62131",
      status: "OPERATIONAL",
      sincePM: 70,
      installed: 730,
      price: 2450,
      warranty: 380,
    },
    {
      name: "Surgical light",
      dept: "Operating theatres",
      room: 3,
      mfr: "Getinge",
      model: "Maquet PowerLED II",
      serial: "GT-46200",
      status: "OPERATIONAL",
      sincePM: 200,
      installed: 2555,
      price: 21400,
      warranty: -395,
    },
    {
      name: "Centrifuge",
      dept: "Laboratory",
      room: 2,
      mfr: "Siemens Healthineers",
      model: "Labofuge 400",
      serial: "SI-63472",
      status: "OPERATIONAL",
      sincePM: 120,
      installed: 1825,
      price: 4300,
      warranty: -180,
    },
    {
      name: "Pulse oximeter",
      dept: "Internal medicine",
      room: 5,
      mfr: "Mindray",
      model: "PM-60A",
      serial: "MR-90183",
      status: "OPERATIONAL",
      sincePM: 60,
      installed: 1095,
      price: 480,
      warranty: 275,
    },
  ] as const;

  type Spec = (typeof DEVICES)[number];
  type Fault = Extract<Spec, { fault: unknown }>["fault"];
  type WorkOrderSpec = Extract<Fault, { wo: unknown }>["wo"];
  type PartSpec = Extract<WorkOrderSpec, { part: unknown }>["part"];

  const deptOf = (name: string) => DEPARTMENTS.find((d) => d.name === name)!;

  for (const [i, spec] of DEVICES.entries()) {
    const meta = categories.get(spec.name)!;
    const dept = deptOf(spec.dept);
    const engineer = engineers[i % engineers.length]!;
    const roomCode = `${dept.floor}${String(spec.room).padStart(2, "0")}`;
    const lastCompletedAt = addDays(TODAY, -spec.sincePM);
    const nextDueAt = addDays(lastCompletedAt, meta.interval);

    const device = await prisma.equipment.create({
      data: {
        tag: `BG-EQ-${String(i + 1).padStart(6, "0")}`,
        publicToken: generateToken(16), // opaque, not derivable from the tag
        assetNo: `${dept.building.charAt(0)}${1000 + i}`,
        name: spec.name,
        categoryId: meta.id,
        manufacturerId: manufacturers.get(spec.mfr)!,
        model: spec.model,
        serialNo: spec.serial,
        departmentId: departments.get(spec.dept)!,
        roomId: rooms.get(`${spec.dept}:${roomCode}`) ?? null,
        criticality: meta.criticality as never,
        operationalStatus: spec.status as never,
        engineerId: engineer.id,
        intervalDays: meta.interval,
        intervalSource: "MANUFACTURER",
        scheduleMode: "GRACE",
        lastCompletedAt,
        nextDueAt,
        installedAt: addDays(TODAY, -spec.installed),
        purchasedAt: addDays(TODAY, -spec.installed - 30),
        purchasePrice: spec.price,
        warrantyEndsAt: addDays(TODAY, spec.warranty),
      },
    });

    await prisma.maintenanceRecord.create({
      data: {
        equipmentId: device.id,
        type: "PREVENTIVE",
        completedOn: lastCompletedAt,
        engineerId: engineer.id,
        workPerformed:
          "Scheduled service completed. Electrical safety and functional checks passed.",
        cost: Math.floor(spec.price * 0.03) + 120,
        downtimeHours: 2,
        nextDueAfter: nextDueAt,
      },
    });

    const fault: Fault | undefined = "fault" in spec ? spec.fault : undefined;
    if (!fault) continue;

    /**
     * The corrective chain behind a device that is not on the floor.
     *
     * Alert first, then work order, because that is the only way one
     * legitimately exists: a work order without the alert that raised it
     * is a row the application itself could not have produced, and it
     * would read as a bug the first time anyone opened it.
     */
    const openedAt = addDays(TODAY, -fault.raisedDaysAgo);
    const ackHours: number | undefined = "ackHours" in fault ? fault.ackHours : undefined;
    const assignee = "engineer" in fault ? engineers[fault.engineer]! : null;

    const alert = await prisma.alert.create({
      data: {
        equipmentId: device.id,
        raisedById: nurse.id,
        description: fault.description,
        priority: fault.priority as never,
        status: fault.status as never,
        openedAt,
        // The unacknowledged one keeps null timestamps, so its SLA is
        // still running rather than quietly satisfied by a backdated ack.
        acknowledgedAt:
          ackHours === undefined ? null : new Date(openedAt.getTime() + ackHours * 3_600_000),
        acknowledgedById: ackHours === undefined ? null : alertsHead.id,
        assignedToId: assignee?.id ?? null,
        assignedAt: assignee ? new Date(openedAt.getTime() + (ackHours ?? 1) * 3_600_000) : null,
      },
    });

    const wo: WorkOrderSpec | undefined = "wo" in fault ? fault.wo : undefined;
    if (!wo || !assignee) continue;

    const workOrder = await prisma.workOrder.create({
      data: {
        alertId: alert.id,
        equipmentId: device.id,
        engineerId: assignee.id,
        status: wo.status as never,
        priority: fault.priority as never,
        findings: wo.findings,
        diagnosis: "diagnosis" in wo ? wo.diagnosis : null,
      },
    });

    const part: PartSpec | undefined = "part" in wo ? wo.part : undefined;
    if (!part) continue;

    // Ordered parts were requested the day before they went out, which
    // is the ordinary case and keeps the two timestamps consistent.
    const orderedDaysAgo = "orderedDaysAgo" in part ? part.orderedDaysAgo : undefined;
    const requestedDaysAgo =
      "requestedDaysAgo" in part ? part.requestedDaysAgo : orderedDaysAgo! + 1;

    await prisma.workOrderPart.create({
      data: {
        workOrderId: workOrder.id,
        name: part.name,
        partNumber: part.partNumber,
        quantity: 1,
        status: part.status as never,
        requestedAt: addDays(TODAY, -requestedDaysAgo),
        orderedAt: orderedDaysAgo === undefined ? null : addDays(TODAY, -orderedDaysAgo),
      },
    });
  }

  const left = (d: Spec) => categories.get(d.name)!.interval - d.sincePM;
  const overdue = DEVICES.filter((d) => left(d) < 0).length;
  const dueSoon = DEVICES.filter((d) => left(d) >= 0 && left(d) <= 30).length;
  const down = DEVICES.filter((d) => d.status !== "OPERATIONAL").length;

  console.log(
    `\nSeed complete. ${DEVICES.length} devices across 10 departments — ` +
      `${overdue} overdue, ${dueSoon} due within 30 days, ${down} not in service.\n`
  );
  console.log("  Administrator:  " + admin.email + "  /  " + adminPassword);
  console.log("  Engineer:       engineer1@bioguard.local  /  " + demoPassword);
  console.log("  Manager:        manager@bioguard.local  /  " + demoPassword);
  console.log("  Head of alerts: alerts@bioguard.local  /  " + demoPassword);
  console.log("  Ward staff:     nurse@bioguard.local  /  " + demoPassword);
  console.log("\nThese are printed once. Note them now.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
