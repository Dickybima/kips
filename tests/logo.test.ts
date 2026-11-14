import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn(async (_path: string, _opts: Record<string, unknown>) => ({
  statusCode: 200 as const,
  stream: new Blob([new Uint8Array([1, 2, 3])]).stream(),
}));
vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  get: (path: string, opts: Record<string, unknown>) => get(path, opts),
}));

const { GET, LOGO_ID } = await import("../api/logo");

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e.webp";
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const call = (id: string) => GET(new Request(`https://www.trykips.app/api/logo?id=${encodeURIComponent(id)}`));

describe("api/logo", () => {
  beforeEach(() => {
    env.BLOB_STORE_ID = "store_test";
    get.mockClear();
  });
  afterEach(() => {
    delete env.BLOB_STORE_ID;
  });

  it("serves a stored private logo with long caching", async () => {
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(get).toHaveBeenCalledWith(`agents/${ID}`, { access: "private", storeId: "store_test" });
  });

  it("only reads ids that uploads create", async () => {
    expect(LOGO_ID.test(ID)).toBe(true);
    for (const bad of ["../secret.webp", "x.webp", `${ID}/../a`, ID.replace("webp", "svg"), ""]) {
      expect((await call(bad)).status).toBe(404);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing logo", async () => {
    get.mockResolvedValueOnce(null as never);
    expect((await call(ID)).status).toBe(404);
  });
});
