/**
 * What a device form is allowed to write.
 *
 * This is a security boundary rather than a validation detail. The
 * endpoints accept a body straight from a browser, so the only thing
 * standing between a caller and the fields the server owns is
 * `.strict()` — and a schema that quietly starts accepting `nextDueAt`
 * would let somebody mark a ventilator serviced without any service
 * having happened.
 *
 * Pure, so it runs without a database.
 */
import { describe, expect, it } from "vitest";
import { createSchema, updateSchema } from "../src/modules/equipment/routes.js";

const valid = {
  name: "Infusion Pump IP-22",
  assetNo: "IP-22-00456",
  serialNo: "GPI2345678",
  model: "Alaris GP",
  categoryId: "0195c1f0-0000-7000-8000-000000000001",
  manufacturerId: "0195c1f0-0000-7000-8000-000000000002",
  departmentId: "0195c1f0-0000-7000-8000-000000000003",
  criticality: "HIGH",
  intervalDays: 180,
};

describe("registering a device", () => {
  it("accepts a complete record", () => {
    expect(createSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses the fields the server owns", () => {
    // Each of these is issued or derived by the server. A caller that
    // could set them could pick another device's tag, mint its own QR
    // token, or move a due date without recording a service.
    for (const field of ["tag", "publicToken", "nextDueAt", "lastCompletedAt", "id"]) {
      expect(createSchema.safeParse({ ...valid, [field]: "x" }).success).toBe(false);
    }
  });

  it("refuses operational status, which has its own endpoint", () => {
    // Taking a device out of service is a different event from
    // correcting its record, and is audited as one.
    expect(createSchema.safeParse({ ...valid, operationalStatus: "OUT_OF_SERVICE" }).success).toBe(
      false
    );
  });

  it("requires the fields a device cannot exist without", () => {
    for (const field of ["name", "assetNo", "categoryId", "departmentId", "intervalDays"]) {
      const { [field as keyof typeof valid]: _removed, ...rest } = valid;
      expect(createSchema.safeParse(rest).success).toBe(false);
    }
  });

  it("refuses an interval that is not a real service cycle", () => {
    expect(createSchema.safeParse({ ...valid, intervalDays: 0 }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, intervalDays: -30 }).success).toBe(false);
    expect(createSchema.safeParse({ ...valid, intervalDays: 4000 }).success).toBe(false);
  });

  it("refuses a criticality outside the enum", () => {
    expect(createSchema.safeParse({ ...valid, criticality: "URGENT" }).success).toBe(false);
  });
});

describe("editing a device", () => {
  it("takes one field on its own", () => {
    expect(updateSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("refuses an empty body", () => {
    // A PATCH with nothing in it is a bug in the caller, not a no-op
    // worth writing an audit row for.
    expect(updateSchema.safeParse({}).success).toBe(false);
  });

  it("refuses the server's fields here too", () => {
    expect(updateSchema.safeParse({ tag: "BG-EQ-000001" }).success).toBe(false);
    expect(updateSchema.safeParse({ publicToken: "stolen" }).success).toBe(false);
  });
});
