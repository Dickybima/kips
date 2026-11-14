import { describe, expect, it } from "vitest";
import { parseTrade } from "../src/lib/kips/trade-intent";

const CA = "0xd1F91331F3c9CE8b4C4E265392c27Afb90a7f82C";

describe("parseTrade", () => {
  it("reads buys in the common phrasings", () => {
    expect(parseTrade("swap 0.1 eth to kips")).toEqual({ kind: "buy", eth: "0.1", token: "KIPS" });
    expect(parseTrade("Buy 0.05 ETH of $KIPS")).toEqual({ kind: "buy", eth: "0.05", token: "KIPS" });
    expect(parseTrade("buy .5eth for kips")).toEqual({ kind: "buy", eth: ".5", token: "KIPS" });
    expect(parseTrade("swap 0.1 eth -> kips")).toEqual({ kind: "buy", eth: "0.1", token: "KIPS" });
    expect(parseTrade("buy kips 0.2 eth")).toEqual({ kind: "buy", eth: "0.2", token: "KIPS" });
    expect(parseTrade("buy kips with 0.2 eth")).toEqual({ kind: "buy", eth: "0.2", token: "KIPS" });
    expect(parseTrade(`swap 0.1 eth to ${CA}`)).toEqual({ kind: "buy", eth: "0.1", token: CA.toLowerCase() });
  });
  it("reads sells by amount, percentage or all", () => {
    expect(parseTrade("swap 1,000 kips to eth")).toEqual({ kind: "sell", amount: { kind: "tokens", amount: "1000" }, token: "KIPS" });
    expect(parseTrade("sell 50% kips")).toEqual({ kind: "sell", amount: { kind: "pct", pct: 50 }, token: "KIPS" });
    expect(parseTrade("sell all my $kips")).toEqual({ kind: "sell", amount: { kind: "all" }, token: "KIPS" });
    expect(parseTrade("sell kips 25%")).toEqual({ kind: "sell", amount: { kind: "pct", pct: 25 }, token: "KIPS" });
    expect(parseTrade("swap max kips for eth")).toEqual({ kind: "sell", amount: { kind: "all" }, token: "KIPS" });
  });
  it("reads price and balance", () => {
    expect(parseTrade("price kips")).toEqual({ kind: "price", token: "KIPS" });
    expect(parseTrade("balance")).toEqual({ kind: "balance", token: null });
    expect(parseTrade("balance $kips")).toEqual({ kind: "balance", token: "KIPS" });
  });
  it("rejects nonsense and eth-to-eth", () => {
    expect(parseTrade("swap 0.1 eth to eth")).toBeNull();
    expect(parseTrade("sell 150% kips")).toBeNull();
    expect(parseTrade("hello")).toBeNull();
    expect(parseTrade("buy kips")).toBeNull();
  });
});
