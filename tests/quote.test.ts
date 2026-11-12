import { describe, expect, it } from "vitest";
import {
  amountIn,
  amountOut,
  graduationProgressBps,
  minTokensOutForBuy,
  minWithSlippage,
  quoteBuy,
  quoteSell,
  reservedTokensForPool,
} from "../src/lib/pons/quote";

const E = 10n ** 18n;
// A fresh curve: 1bn supply against 1 ETH of phantom liquidity, graduating at 4 ETH raised.
const supply = 1_000_000_000n * E;
const phantom = 1n * E;
const threshold = 4n * E;
const reserves = { quoteReserve: phantom, tokenReserve: supply };
const sellable = supply - reservedTokensForPool(supply, phantom, threshold);

describe("constant product", () => {
  it("amountOut rounds down and amountIn rounds up", () => {
    expect(amountOut(100n, 1000n, 1000n)).toBe(90n);
    expect(amountIn(90n, 1000n, 1000n)).toBe(99n);
    expect(amountOut(amountIn(90n, 1000n, 1000n), 1000n, 1000n)).toBeGreaterThanOrEqual(89n);
  });
  it("reserves a fifth of supply for the pool in this configuration", () => {
    expect(sellable).toBe((supply * 4n) / 5n);
  });
});

describe("quoteBuy", () => {
  it("takes fee and creator tax from the spend before pricing", () => {
    const q = quoteBuy(reserves, sellable, E, 100n, 100n);
    expect(q.fee).toBe(E / 100n);
    expect(q.tax).toBe(E / 100n);
    expect(q.spent).toBe(E);
    expect(q.refund).toBe(0n);
    expect(q.tokensOut).toBe(amountOut((E * 98n) / 100n, phantom, supply));
  });

  it("applies the snipe tax and caps it so 1% still buys tokens", () => {
    const taxed = quoteBuy(reserves, sellable, E, 100n, 100n, 5000n);
    expect(taxed.snipeTax).toBe(E / 2n);
    expect(taxed.tokensOut).toBeLessThan(quoteBuy(reserves, sellable, E, 100n, 100n).tokensOut);
    const capped = quoteBuy(reserves, sellable, E, 100n, 100n, 10_000n);
    expect(capped.snipeTaxBps).toBe(9700n);
  });

  it("caps the final buy at sellable tokens and refunds the rest", () => {
    const q = quoteBuy(reserves, sellable, 100n * E, 100n, 0n);
    expect(q.tokensOut).toBe(sellable);
    expect(q.spent).toBeLessThan(100n * E);
    expect(q.refund).toBe(100n * E - q.spent);
    // Net of the 1% fee, the spend is what the curve needs to sell out: ~4 ETH.
    const net = q.spent - q.fee;
    expect(net).toBeGreaterThanOrEqual(amountIn(sellable, phantom, supply));
    expect(net - amountIn(sellable, phantom, supply)).toBeLessThan(E / 1_000_000n);
  });

  it("rejects closed curves and empty trades", () => {
    expect(() => quoteBuy(reserves, 0n, E, 100n, 0n)).toThrow();
    expect(() => quoteBuy(reserves, sellable, 0n, 100n, 0n)).toThrow();
    expect(() => quoteBuy(reserves, sellable, E, 9000n, 1000n)).toThrow();
  });
});

describe("quoteSell", () => {
  it("takes fees from the gross proceeds", () => {
    const tokens = 1_000_000n * E;
    const q = quoteSell(reserves, tokens, 100n, 50n);
    expect(q.grossQuoteOut).toBe(amountOut(tokens, supply, phantom));
    expect(q.quoteOut).toBe(q.grossQuoteOut - q.fee - q.tax);
  });
  it("a buy then sell of the same tokens never profits", () => {
    const b = quoteBuy(reserves, sellable, E, 100n, 100n);
    const after = {
      quoteReserve: reserves.quoteReserve + b.spent - b.fee - b.tax,
      tokenReserve: reserves.tokenReserve - b.tokensOut,
    };
    expect(quoteSell(after, b.tokensOut, 100n, 100n).quoteOut).toBeLessThan(E);
  });
});

describe("slippage", () => {
  it("haircuts the expected output", () => {
    expect(minWithSlippage(1000n, 300n)).toBe(970n);
    expect(() => minWithSlippage(1000n, 10_001n)).toThrow();
  });
  it("scales the buy minimum by quoteIn/spent on a partial fill", () => {
    const quoteIn = 100n * E;
    const q = quoteBuy(reserves, sellable, quoteIn, 100n, 0n);
    const min = minTokensOutForBuy(quoteIn, q, 0n);
    expect(min).toBe((quoteIn * q.tokensOut) / q.spent);
    expect(min).toBeGreaterThan(q.tokensOut);
    const full = quoteBuy(reserves, sellable, E, 100n, 0n);
    expect(minTokensOutForBuy(E, full, 300n)).toBe(minWithSlippage(full.tokensOut, 300n));
  });
});

describe("graduation progress", () => {
  it("is clamped to 0–100%", () => {
    expect(graduationProgressBps(0n, threshold)).toBe(0);
    expect(graduationProgressBps(E, threshold)).toBe(2500);
    expect(graduationProgressBps(9n * E, threshold)).toBe(10_000);
  });
});
