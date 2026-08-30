/**
 * The integration suite truncates every table, so the check that decides
 * which database it may point at is safety-critical. It is pure, so it
 * is tested here in the unit suite rather than in the suite it guards —
 * by the time api.test.ts runs, the decision has already been made.
 */
import { afterEach, describe, expect, it } from "vitest";
import { assertTestDatabase } from "./assert-test-database.js";

const base = "postgresql://bioguard:pw@localhost:5432";

afterEach(() => {
  delete process.env.BIOGUARD_ALLOW_DESTRUCTIVE_TESTS;
});

describe("integration-test database guard", () => {
  it("accepts a database named for testing", () => {
    expect(() => assertTestDatabase(`${base}/bioguard_test?schema=public`)).not.toThrow();
    expect(() => assertTestDatabase(`${base}/test_bioguard`)).not.toThrow();
    expect(() => assertTestDatabase(`${base}/bioguard-test`)).not.toThrow();
  });

  it("refuses the working database", () => {
    // The exact mistake this exists to prevent: .env points here.
    expect(() => assertTestDatabase(`${base}/bioguard?schema=public`)).toThrow(/Refusing to run/);
  });

  it("refuses a production-looking database", () => {
    expect(() => assertTestDatabase(`${base}/bioguard_prod`)).toThrow(/Refusing to run/);
  });

  it("does not accept 'test' merely as a substring", () => {
    // "latest" contains "test"; a plain includes() check would pass it.
    expect(() => assertTestDatabase(`${base}/latest_snapshot`)).toThrow(/Refusing to run/);
    expect(() => assertTestDatabase(`${base}/contested`)).toThrow(/Refusing to run/);
  });

  it("refuses a missing or unparseable URL rather than guessing", () => {
    expect(() => assertTestDatabase(undefined)).toThrow(/DATABASE_URL is not set/);
    expect(() => assertTestDatabase("not-a-url")).toThrow(/not a valid URL/);
  });

  it("names the offending database so the fix is obvious", () => {
    expect(() => assertTestDatabase(`${base}/bioguard`)).toThrow(/"bioguard"/);
  });

  it("can be overridden deliberately", () => {
    process.env.BIOGUARD_ALLOW_DESTRUCTIVE_TESTS = "1";
    expect(() => assertTestDatabase(`${base}/bioguard`)).not.toThrow();
  });

  it("is not overridden by any other value", () => {
    process.env.BIOGUARD_ALLOW_DESTRUCTIVE_TESTS = "true";
    expect(() => assertTestDatabase(`${base}/bioguard`)).toThrow(/Refusing to run/);
  });
});
