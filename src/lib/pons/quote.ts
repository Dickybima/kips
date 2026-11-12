// Local mirror of the Pons v2 bonding-curve math (constant product over
// virtual reserves, fees taken from the quote side). The curve contract exposes
// no quote view, so the UI prices trades from on-chain state with these.

export const BPS = 10_000n;
const ONE_PCT_BPS = 100n;

export interface CurveReserves {
  quoteReserve: bigint;
  tokenReserve: bigint;
}

export interface BuyQuote {
  tokensOut: bigint;
  /** Quote actually consumed; less than quoteIn when the buy empties the curve. */
  spent: bigint;
  refund: bigint;
  fee: bigint;
  tax: bigint;
  snipeTax: bigint;
  snipeTaxBps: bigint;
}

export interface SellQuote {
  quoteOut: bigint;
  grossQuoteOut: bigint;
  fee: bigint;
  tax: bigint;
}

export class QuoteError extends Error {}

export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn < 0n || reserveIn <= 0n || reserveOut <= 0n) throw new QuoteError("invalid reserves");
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}

export function amountIn(out: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (out <= 0n || reserveIn <= 0n || out >= reserveOut) throw new QuoteError("output exceeds reserve");
  return (out * reserveIn) / (reserveOut - out) + 1n;
}

const bps = (amount: bigint, rate: bigint) => (amount * rate) / BPS;
const mulDivCeil = (a: bigint, b: bigint, d: bigint) => (a * b + d - 1n) / d;

function checkState(r: CurveReserves, amount: bigint, feeBps: bigint, creatorTaxBps: bigint) {
  if (amount <= 0n) throw new QuoteError("amount must be positive");
  if (r.quoteReserve <= 0n || r.tokenReserve <= 0n) throw new QuoteError("curve has no reserves");
  if (feeBps < 0n || creatorTaxBps < 0n || feeBps + creatorTaxBps >= BPS) throw new QuoteError("invalid fee bps");
}

export function quoteBuy(
  reserves: CurveReserves,
  sellable: bigint,
  quoteIn: bigint,
  feeBps: bigint,
  creatorTaxBps: bigint,
  rawSnipeBps: bigint = 0n,
): BuyQuote {
  checkState(reserves, quoteIn, feeBps, creatorTaxBps);
  if (sellable <= 0n || sellable >= reserves.tokenReserve) throw new QuoteError("curve is closed");

  let snipeBps = rawSnipeBps;
  if (snipeBps > 0n) {
    // The curve always leaves at least 1% of the spend to buy tokens.
    const maxSnipe = BPS - feeBps - creatorTaxBps - ONE_PCT_BPS;
    if (maxSnipe < 0n) throw new QuoteError("fees leave nothing to trade");
    if (snipeBps > maxSnipe) snipeBps = maxSnipe;
  }

  let spent = quoteIn;
  let fee = bps(spent, feeBps);
  let tax = bps(spent, creatorTaxBps);
  let snipeTax = bps(spent, snipeBps);
  const net = spent - fee - tax - snipeTax;
  if (net <= 0n) throw new QuoteError("fees consume the input");

  let tokensOut = amountOut(net, reserves.quoteReserve, reserves.tokenReserve);
  if (tokensOut === 0n) throw new QuoteError("amount too small");

  if (tokensOut > sellable) {
    // Final buy: capped at the remaining sellable tokens, the rest is refunded.
    tokensOut = sellable;
    const netNeeded = amountIn(sellable, reserves.quoteReserve, reserves.tokenReserve);
    const grossed = mulDivCeil(netNeeded, BPS, BPS - (feeBps + creatorTaxBps + snipeBps));
    spent = grossed < quoteIn ? grossed : quoteIn;
    fee = bps(spent, feeBps);
    tax = bps(spent, creatorTaxBps);
    snipeTax = bps(spent, snipeBps);
  }

  return { tokensOut, spent, refund: quoteIn - spent, fee, tax, snipeTax, snipeTaxBps: snipeBps };
}

export function quoteSell(
  reserves: CurveReserves,
  tokensIn: bigint,
  feeBps: bigint,
  creatorTaxBps: bigint,
): SellQuote {
  checkState(reserves, tokensIn, feeBps, creatorTaxBps);
  const gross = amountOut(tokensIn, reserves.tokenReserve, reserves.quoteReserve);
  if (gross === 0n) throw new QuoteError("amount too small");
  const fee = bps(gross, feeBps);
  const tax = bps(gross, creatorTaxBps);
  const quoteOut = gross - fee - tax;
  if (quoteOut <= 0n) throw new QuoteError("fees consume the output");
  return { quoteOut, grossQuoteOut: gross, fee, tax };
}

export function minWithSlippage(expected: bigint, slippageBps: bigint): bigint {
  if (slippageBps < 0n || slippageBps > BPS) throw new QuoteError("invalid slippage");
  return (expected * (BPS - slippageBps)) / BPS;
}

/**
 * minTokensOut for curve.buy. The curve checks slippage as a fill *rate*
 * against the full quoteIn, so a partially-filled buy needs the minimum scaled
 * up by quoteIn / spent rather than a plain haircut on tokensOut.
 */
export function minTokensOutForBuy(quoteIn: bigint, quote: BuyQuote, slippageBps: bigint): bigint {
  if (quoteIn <= 0n || quote.spent <= 0n || quote.spent > quoteIn) throw new QuoteError("invalid quote");
  if (slippageBps < 0n || slippageBps > BPS) throw new QuoteError("invalid slippage");
  return (quoteIn * quote.tokensOut * (BPS - slippageBps)) / (quote.spent * BPS);
}

/** Tokens held back from the curve to seed the Uniswap v4 pool at graduation. */
export function reservedTokensForPool(supply: bigint, phantomQuote: bigint, graduationThreshold: bigint): bigint {
  return (supply * phantomQuote) / (phantomQuote + graduationThreshold);
}

/** Graduation progress in basis points, clamped to [0, 10000]. */
export function graduationProgressBps(raised: bigint, threshold: bigint): number {
  if (threshold <= 0n || raised <= 0n) return 0;
  const p = (raised * BPS) / threshold;
  return Number(p > BPS ? BPS : p);
}
