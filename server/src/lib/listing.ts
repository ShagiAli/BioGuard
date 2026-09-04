/**
 * Shared machinery for the list endpoints: ordering that cannot be
 * abused, and CSV that cannot be misread as a formula.
 *
 * Both exist once rather than four times because the four lists differ
 * only in which columns they expose, and a rule enforced in one of them
 * and forgotten in another is not a rule.
 */
import type { Response } from "express";
import { z } from "zod";

export type SortDirection = "asc" | "desc";

/**
 * The direction is free, the column is not.
 *
 * A caller may name any column the endpoint has published and nothing
 * else. The alternative — handing the query string to `orderBy` — lets
 * the caller order by fields the list does not return, which is a way
 * to read a column indirectly: sort by it, and the order of the rows
 * tells you what the values are. Prisma would reject an unknown name,
 * but a *known* name that the endpoint never meant to expose is exactly
 * the case an allowlist catches and a type does not.
 */
export function sortSchema<const T extends readonly [string, ...string[]]>(columns: T) {
  return {
    sort: z.enum(columns).optional(),
    dir: z.enum(["asc", "desc"]).default("asc"),
  };
}

/**
 * Turns a validated column name into a Prisma `orderBy`.
 *
 * The map is explicit so a column can order by something other than
 * itself — a device's department sorts by the department's *name*, not
 * by the foreign key, which would order the table by an opaque UUID and
 * look broken.
 *
 * `fallback` is what an unsorted list uses, and stays the order each
 * list was designed around: soonest due first for equipment, newest
 * first for anything chronological.
 */
export function orderByFrom<K extends string>(
  sort: K | undefined,
  dir: SortDirection,
  map: Record<K, (d: SortDirection) => unknown>,
  fallback: unknown
): unknown {
  if (!sort) return fallback;
  const build = map[sort];
  return build ? build(dir) : fallback;
}

/**
 * The number of rows an export may contain.
 *
 * An export is one unbounded query away from being a way to pull the
 * whole database through a link. This is generous for the estate the
 * application is built for and small enough that the query stays a
 * query.
 */
export const EXPORT_ROW_LIMIT = 5000;

/**
 * Escapes one CSV field.
 *
 * The quoting is ordinary. The leading apostrophe is not: a value
 * beginning =, +, - or @ is treated as a formula by Excel and Sheets,
 * so a device someone named `=cmd|...` becomes an instruction when the
 * export is opened. Prefixing breaks that without changing what the
 * cell reads as.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Writes rows as a CSV download.
 *
 * The BOM is there so Excel reads the file as UTF-8; without it a
 * device named in anything but ASCII arrives mangled, which for a
 * hospital inventory is most of the interesting names.
 */
export function sendCsv<T>(
  res: Response,
  filename: string,
  columns: { header: string; value: (row: T) => unknown }[],
  rows: T[]
): void {
  const lines = [
    columns.map((c) => csvField(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => csvField(c.value(row))).join(",")),
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("﻿" + lines.join("\r\n"));
}
