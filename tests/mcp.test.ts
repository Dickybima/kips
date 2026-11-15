import { describe, expect, it } from "vitest";
import { POST, GET, TOOLS, appLink, handle, parseHandle, quoteBuy as mcpBuy, quoteSell as mcpSell } from "../api/mcp";
import { quoteBuy, quoteSell } from "../src/lib/pons/quote";
import { hashParams, launchPrefill } from "../src/lib/kips/prefill";
import { parseTrade } from "../src/lib/kips/trade-intent";

const rpc = (body: unknown) => POST(new Request("https://www.trykips.app/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("MCP protocol", () => {
  it("initializes with a supported protocol version", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } });
    const { result } = await res.json();
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe("kips");
    const fallback = await (await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json();
    expect(fallback.result.protocolVersion).toBe("2025-06-18");
  });
  it("accepts notifications with 202 and no body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });
  it("lists every tool with a JSON schema", async () => {
    const { result } = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" })).json();
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of result.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.run).toBeUndefined();
    }
  });
  it("answers errors the JSON-RPC way", async () => {
    expect((await handle({ jsonrpc: "2.0", id: 4, method: "nope" }))?.error).toMatchObject({ code: -32601 });
    expect((await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }))?.error).toMatchObject({ code: -32602 });
    const bad = await POST(new Request("https://x/api/mcp", { method: "POST", body: "{not json" }));
    expect(bad.status).toBe(400);
    expect(GET().status).toBe(405);
  });
  it("reports bad tool input as a tool error, not a crash", async () => {
    const r = await handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "prepare_launch", arguments: { name: "Atlas", ticker: "AT LAS" } } });
    expect(r?.result).toMatchObject({ isError: true });
  });
});

describe("prepare tools", () => {
  it("builds a launch link the launch form reads back", async () => {
    const r = await handle({
      jsonrpc: "2.0", id: 7, method: "tools/call",
      params: { name: "prepare_launch", arguments: { name: "Atlas & Co", ticker: "$atlas", description: "Trades momentum", x: "@atlas", initial_buy_eth: "0.01", creator_fee_pct: 2 } },
    });
    const link = (r?.result as { structuredContent: { link: string } }).structuredContent.link;
    expect(link.startsWith("https://www.trykips.app/#/agent?")).toBe(true);
    expect(launchPrefill(hashParams(link.slice(link.indexOf("#"))))).toEqual({
      name: "Atlas & Co", symbol: "ATLAS", about: "Trades momentum", twitter: "https://x.com/atlas", buy: "0.01", tax: "2",
    });
  });
  it("writes trade commands the Terminal understands", () => {
    const T = "0xd1F91331F3c9CE8b4C4E265392c27Afb90a7f82C";
    expect(parseTrade(`swap 0.01 eth to ${T}`)).toMatchObject({ kind: "buy", eth: "0.01" });
    expect(parseTrade(`sell 50% ${T}`)).toMatchObject({ kind: "sell", amount: { kind: "pct", pct: 50 } });
    expect(parseTrade(`sell all ${T}`)).toMatchObject({ kind: "sell", amount: { kind: "all" } });
    expect(parseTrade(`sell 1000000 ${T}`)).toMatchObject({ kind: "sell", amount: { kind: "tokens", amount: "1000000" } });
    const link = appLink("terminal", { cmd: `sell 50% ${T}` });
    expect(hashParams(link.slice(link.indexOf("#"))).get("cmd")).toBe(`sell 50% ${T}`);
  });
  it("reads X handles like the site does", () => {
    expect(parseHandle("https://x.com/jack?s=1")).toBe("jack");
    expect(parseHandle("@Robinhood_App")).toBe("Robinhood_App");
    expect(parseHandle("not valid!")).toBeNull();
  });
});

describe("curve math mirror", () => {
  const r = { quoteReserve: 1_800_000_000_000_000_000n, tokenReserve: 760_000_000n * 10n ** 18n };
  const sellable = 500_000_000n * 10n ** 18n;
  it("quotes buys exactly like the app", () => {
    for (const [eth, snipe] of [[10n ** 16n, 0n], [10n ** 17n, 300n], [5n * 10n ** 18n, 0n], [123n, 0n]] as const) {
      let app: unknown, mcp: unknown;
      try { app = quoteBuy(r, sellable, eth, 100n, 199n, snipe); } catch { app = "error"; }
      try { mcp = mcpBuy(r, sellable, eth, 100n, 199n, snipe); } catch { mcp = "error"; }
      if (app === "error") expect(mcp).toBe("error");
      else expect(mcp).toMatchObject({
        tokensOut: (app as { tokensOut: bigint }).tokensOut,
        spent: (app as { spent: bigint }).spent,
        refund: (app as { refund: bigint }).refund,
      });
    }
  });
  it("quotes sells exactly like the app", () => {
    for (const t of [10n ** 24n, 10n ** 20n]) {
      expect(mcpSell(r, t, 100n, 199n).quoteOut).toBe(quoteSell(r, t, 100n, 199n).quoteOut);
    }
  });
});
