// Vercel Function: stores an agent logo in Vercel Blob and returns its public URL.
// The browser crops and shrinks the image first (src/lib/kips/image.ts), so a
// real upload is a few dozen kilobytes; anything over MAX_BYTES is refused.
import { put } from "@vercel/blob";

declare const process: { env: Record<string, string | undefined> };

export const MAX_BYTES = 1_000_000;

/**
 * The Blob store's read-write token. Connecting a store adds it as
 * BLOB_READ_WRITE_TOKEN, or as <PREFIX>_READ_WRITE_TOKEN when a prefix was
 * chosen, so any variable holding a Vercel Blob read-write token is accepted.
 */
export function blobToken(env: Record<string, string | undefined> = process.env): string | null {
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith("READ_WRITE_TOKEN") && value?.startsWith("vercel_blob_rw_")) return value;
  }
  return null;
}

/**
 * The store id for OIDC auth, which newer Blob stores use instead of a
 * read-write token: BLOB_STORE_ID, or <PREFIX>_STORE_ID holding a store_ id.
 */
export function blobStoreId(env: Record<string, string | undefined> = process.env): string | null {
  if (env.BLOB_STORE_ID) return env.BLOB_STORE_ID;
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith("STORE_ID") && value?.startsWith("store_")) return value;
  }
  return null;
}

/** Names (never values) of the Blob-related variables this function can see. */
export function blobVarNames(env: Record<string, string | undefined> = process.env): string[] {
  return Object.keys(env).filter((k) => /BLOB|STORE_ID|READ_WRITE_TOKEN/.test(k)).sort();
}

const TYPES: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** Checks the file's magic bytes, so a renamed file of another kind is refused. */
export function looksLike(type: string, b: Uint8Array): boolean {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (type === "image/webp") return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  return false;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function POST(request: Request): Promise<Response> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return json({ error: "Upload a PNG, JPEG or WebP image." }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return json({ error: "That image is too large (1 MB max)." }, 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: "The image is empty." }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "That image is too large (1 MB max)." }, 413);
  if (!looksLike(type, bytes)) return json({ error: "That file is not a valid image." }, 415);
  const token = blobToken();
  const storeId = token ? null : blobStoreId();
  try {
    const blob = await put(`agents/${crypto.randomUUID()}.${ext}`, new Blob([bytes], { type }), {
      access: "public",
      contentType: type,
      addRandomSuffix: false,
      cacheControlMaxAge: 31_536_000,
      ...(token ? { token } : storeId ? { storeId } : {}),
    });
    return json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("blob upload failed:", message);
    if (/credentials|storeId|OIDC|token/i.test(message)) {
      return json(
        {
          error: "Image uploads are not set up yet: connect a Vercel Blob store to this project, then redeploy.",
          detail: message,
          seen: blobVarNames(),
        },
        503,
      );
    }
    return json({ error: "The image could not be stored. Try again." }, 502);
  }
}

export function GET(): Response {
  return json({ error: "Use POST with the image as the request body." }, 405);
}
