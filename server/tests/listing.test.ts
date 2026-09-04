/**
 * The shared list machinery: what a caller may order by, and what a CSV
 * export is allowed to contain.
 *
 * Both are pure, so they run in the unit suite. The CSV cases matter
 * more than they look: an export is a file that leaves the application
 * and is opened by a spreadsheet, which is a program that executes some
 * of what it reads.
 */
import { describe, expect, it } from "vitest";
import { orderByFrom, sendCsv, sortSchema } from "../src/lib/listing.js";

/** Just enough of an Express response to capture what sendCsv writes. */
function fakeRes() {
  const headers: Record<string, string> = {};
  let body = "";
  return {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    send(payload: string) {
      body = payload;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
  };
}

const columns = [{ header: "Name", value: (r: { name: string }) => r.name }];

function csvFor(rows: { name: string }[]): string {
  const res = fakeRes();
  sendCsv(res as never, "x.csv", columns, rows);
  return res.body;
}

/** The data line, with the header row and the byte order mark stripped. */
function firstValue(rows: { name: string }[]): string {
  return csvFor(rows).split("\r\n")[1] ?? "";
}

describe("sort allowlist", () => {
  const schema = sortSchema(["name", "assetNo"] as const);

  it("accepts a published column", () => {
    expect(schema.sort.safeParse("assetNo").success).toBe(true);
  });

  it("refuses a column the endpoint never published", () => {
    // The case this exists for: ordering by a field the list does not
    // return leaks it anyway, because the order of the rows describes it.
    expect(schema.sort.safeParse("passwordHash").success).toBe(false);
    expect(schema.sort.safeParse("id").success).toBe(false);
  });

  it("defaults to ascending and refuses anything else", () => {
    expect(schema.dir.parse(undefined)).toBe("asc");
    expect(schema.dir.safeParse("sideways").success).toBe(false);
  });
});

describe("orderBy", () => {
  const map = {
    name: (d: "asc" | "desc") => ({ name: d }),
    department: (d: "asc" | "desc") => ({ department: { name: d } }),
  };
  const fallback = { nextDueAt: "asc" };

  it("falls back when nothing is chosen", () => {
    expect(orderByFrom(undefined, "asc", map, fallback)).toBe(fallback);
  });

  it("orders a relation by its name, not its key", () => {
    // Ordering by the foreign key would sort the table by an opaque
    // UUID, which looks like no order at all.
    expect(orderByFrom("department", "desc", map, fallback)).toEqual({
      department: { name: "desc" },
    });
  });
});

describe("csv", () => {
  it("quotes separators and doubles quotes", () => {
    expect(firstValue([{ name: 'Pump, "GP"' }])).toBe('"Pump, ""GP"""');
  });

  it("neutralises values a spreadsheet would run as a formula", () => {
    // A device named like a formula is a device that runs when the
    // export is opened. The apostrophe is what stops that.
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(firstValue([{ name: dangerous }])).toBe(`"'${dangerous}"`);
    }
  });

  it("leaves an ordinary name alone", () => {
    expect(firstValue([{ name: "Infusion Pump IP-22" }])).toBe('"Infusion Pump IP-22"');
  });

  it("declares UTF-8 so non-ASCII names survive the trip", () => {
    const res = fakeRes();
    sendCsv(res as never, "x.csv", columns, [{ name: "Röntgen" }]);
    expect(res.headers["content-type"]).toContain("utf-8");
    // Excel needs the byte order mark or it guesses, and guesses wrong.
    expect(res.body.startsWith("﻿")).toBe(true);
    expect(res.headers["content-disposition"]).toContain("x.csv");
  });
});
