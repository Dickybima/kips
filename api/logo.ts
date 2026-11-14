// Vercel Function: serves an agent logo kept in a private Vercel Blob store.
// Uploads go to a public store when the project has one; a private store
// cannot hand out public URLs, so its logos are read here and served from
// this site at /api/logo?id=<uuid>.<ext>, which is the URL stored on-chain.
import { get } from "@vercel/blob";

declare const process: { env: Record<string, string | undefined> };

// Same lookup as upload.ts. Kept here because a Vercel Function cannot import
// another function file at runtime.
function blobAuth(env = process.env): { token: string } | { storeId: string } | Record<string, never> {
  for (const [key, value] of Object.entries(env)) {
    if (value && (key === "BLOB_READ_WRITE_TOKEN" || (key.endsWith("READ_WRITE_TOKEN") && value.startsWith("vercel_blob_rw_")))) {
      return { token: value };
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (value && (key === "BLOB_STORE_ID" || (key.endsWith("STORE_ID") && value.startsWith("store_")))) return { storeId: value };
  }
  return {};
}

/** Logo ids are the names upload.ts gives them, nothing else. */
export const LOGO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|png|jpg)$/;

const TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" };

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!LOGO_ID.test(id)) return text("Unknown logo.", 404);
  try {
    const found = await get(`agents/${id}`, {
      access: "private",
      ...blobAuth(),
    });
    if (!found || found.statusCode !== 200) return text("Unknown logo.", 404);
    return new Response(found.stream, {
      status: 200,
      headers: {
        // The type comes from the id, which upload.ts derived from checked bytes.
        "content-type": TYPES[id.split(".")[1]],
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return text("The logo could not be loaded.", 502);
  }
}
