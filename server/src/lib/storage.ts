/**
 * Photo storage, over Supabase Storage's REST API.
 *
 * Plain fetch rather than the Supabase SDK: two endpoints are needed —
 * put an object, sign a link — and a client library for that would be a
 * dependency carrying an auth model this application deliberately does
 * not use.
 *
 * The bucket is private. BioGuard decides who may see a device, and it
 * decides that per request against the person asking; a public bucket
 * would hand out a URL that outlives the permission that produced it.
 * Reads go through a signed link that expires.
 *
 * Optional by design. With no credentials configured the module reports
 * itself unavailable and the interface omits the upload control, rather
 * than offering a button that fails.
 */
import { randomUUID } from "node:crypto";

const BUCKET = "equipment-photos";

/** What the bucket itself enforces, restated so a bad request fails here first. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoType = (typeof ALLOWED_PHOTO_TYPES)[number];

function credentials(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

/** Whether photos can be stored at all. Read by the API so it can say so honestly. */
export function storageConfigured(): boolean {
  return credentials() !== null;
}

export function isPhotoType(value: string): value is PhotoType {
  return (ALLOWED_PHOTO_TYPES as readonly string[]).includes(value);
}

/**
 * Stores a photo and returns its object key.
 *
 * The key carries a random component rather than being derived from the
 * device id alone, so replacing a photo writes a new object instead of
 * overwriting one that a signed link may still be pointing at.
 */
export async function putPhoto(
  equipmentId: string,
  body: Buffer,
  contentType: PhotoType
): Promise<string> {
  const creds = credentials();
  if (!creds) throw new Error("Photo storage is not configured.");

  const extension =
    contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `${equipmentId}/${randomUUID()}.${extension}`;

  const res = await fetch(`${creds.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${creds.key}`,
      "content-type": contentType,
      "cache-control": "3600",
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    throw new Error(`Storage rejected the upload (${res.status}).`);
  }

  return path;
}

/**
 * A link that works for an hour.
 *
 * Short because it is the only thing standing between a private photo
 * and anyone the link is forwarded to. An hour outlives a page view and
 * not much else.
 */
export async function signedPhotoUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;

  const res = await fetch(`${creds.url}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${creds.key}`, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });

  if (!res.ok) return null;
  const signed = (await res.json()) as { signedURL?: string };
  return signed.signedURL ? `${creds.url}/storage/v1${signed.signedURL}` : null;
}

/** Removes an object. Failure is logged by the caller, never fatal: a stray file is not worth a failed request. */
export async function deletePhoto(path: string): Promise<boolean> {
  const creds = credentials();
  if (!creds) return false;

  const res = await fetch(`${creds.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${creds.key}` },
  });
  return res.ok;
}
