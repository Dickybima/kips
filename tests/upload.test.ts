import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn(async (path: string, _body: unknown, _opts: Record<string, unknown>) => ({
  url: `https://store.public.blob.vercel-storage.com/${path}`,
}));
vi.mock("@vercel/blob", () => ({
  put: (path: string, body: unknown, opts: Record<string, unknown>) => put(path, body, opts),
}));

const { POST, GET, MAX_BYTES, looksLike } = await import("../api/upload");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

const req = (body: Uint8Array, type: string) =>
  new Request("https://kips.test/api/upload", { method: "POST", headers: { "content-type": type }, body: new Blob([body as BlobPart]) });

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

describe("api/upload", () => {
  beforeEach(() => {
    env.BLOB_READ_WRITE_TOKEN = "test-token";
    put.mockClear();
  });
  afterEach(() => {
    delete env.BLOB_READ_WRITE_TOKEN;
  });

  it("recognises real image bytes", () => {
    expect(looksLike("image/png", PNG)).toBe(true);
    expect(looksLike("image/jpeg", JPG)).toBe(true);
    expect(looksLike("image/webp", WEBP)).toBe(true);
    expect(looksLike("image/png", JPG)).toBe(false);
  });

  it("stores a valid image and returns its public URL", async () => {
    const res = await POST(req(WEBP, "image/webp"));
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(/^https:\/\/store\.public\.blob\.vercel-storage\.com\/agents\/[0-9a-f-]{36}\.webp$/);
    expect(url.length).toBeLessThan(512); // fits the token's on-chain logo field
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][2]).toMatchObject({ access: "public", contentType: "image/webp" });
  });

  it("refuses other file types and disguised files", async () => {
    expect((await POST(req(PNG, "image/svg+xml"))).status).toBe(415);
    expect((await POST(req(PNG, "text/html"))).status).toBe(415);
    expect((await POST(req(JPG, "image/png"))).status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses empty and oversized uploads", async () => {
    expect((await POST(req(new Uint8Array(), "image/png"))).status).toBe(400);
    const big = new Uint8Array(MAX_BYTES + 1);
    big.set(PNG);
    expect((await POST(req(big, "image/png"))).status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it("explains when no Blob store is connected", async () => {
    delete env.BLOB_READ_WRITE_TOKEN;
    const res = await POST(req(PNG, "image/png"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Vercel Blob/);
  });

  it("reports storage failures without leaking details", async () => {
    put.mockRejectedValueOnce(new Error("secret internal detail"));
    const res = await POST(req(PNG, "image/png"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });

  it("only accepts POST", () => {
    expect(GET().status).toBe(405);
  });
});
