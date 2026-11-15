// Vercel Function: the KIPS MCP server, at https://www.trykips.app/api/mcp
//
// Model Context Protocol over Streamable HTTP, stateless: every POST carries
// one JSON-RPC message (or a batch) and gets a JSON answer. AI clients
// (Claude, Cursor, ...) use it to read KIPS tokens from Robinhood Chain, quote
// trades, rank X profiles and prepare launches and trades.
//
// The server never holds keys and never sends a transaction. "prepare_*"
// tools return a KIPS link with everything filled in; the person opens it,
// reviews it and signs in their own wallet.
//
// Self-contained: a Vercel Function cannot import the app's files at runtime,
// so the chain reads and the curve math are mirrored here (tests check the
// math against src/lib/pons/quote.ts).
import { createPublicClient, formatEther, http, isAddress, parseAbi, parseAbiItem, parseEther, type Address } from "viem";

declare const process: { env: Record<string, string | undefined> };

export const SERVER = { name: "kips", title: "KIPS", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SITE = (process.env.VITE_SITE_URL || "https://www.trykips.app").replace(/\/$/, "");
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const OFFICIAL: Address = "0xd1F91331F3c9CE8b4C4E265392c27Afb90a7f82C";
const HIDDEN = new Set(["0x88b8824c22776f8fcef5993cdec13693a0cbf34a"]);
const KIPS_START_BLOCK = 112_000_000n;
const KIPS_TAG = "[kips:1]";
const WAD = 10n ** 18n;
const BPS = 10_000n;
const INITIAL_SUPPLY = 1_000_000_000n * WAD;
const DEAD: Address[] = ["0x000000000000000000000000000000000000dEaD", "0x0000000000000000000000000000000000000000"];
const DEFAULT_SLIPPAGE_BPS = 500n;

const client = createPublicClient({
  batch: { multicall: { batchSize: 4096, wait: 10 } },
  chain: {
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  },
  transport: http(RPC, { batch: { batchSize: 10 }, retryCount: 3 }),
});

const factoryAbi = parseAbi([
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);
const launchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
const tokenAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);
const curveAbi = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function readyToGraduate() view returns (bool)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Curve math (mirror of src/lib/pons/quote.ts)

export class ToolError extends Error {}

const bps = (amount: bigint, rate: bigint) => (amount * rate) / BPS;
const mulDivCeil = (a: bigint, b: bigint, d: bigint) => (a * b + d - 1n) / d;

function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn < 0n || reserveIn <= 0n || reserveOut <= 0n) throw new ToolError("The curve has no reserves.");
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}
function amountIn(out: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (out <= 0n || reserveIn <= 0n || out >= reserveOut) throw new ToolError("Output exceeds the curve's reserve.");
  return (out * reserveIn) / (reserveOut - out) + 1n;
}

export interface Reserves {
  quoteReserve: bigint;
  tokenReserve: bigint;
}

export function quoteBuy(r: Reserves, sellable: bigint, quoteIn: bigint, feeBps: bigint, taxBps: bigint, rawSnipeBps = 0n) {
  if (quoteIn <= 0n) throw new ToolError("The amount must be above zero.");
  if (r.quoteReserve <= 0n || r.tokenReserve <= 0n) throw new ToolError("The curve has no reserves.");
  if (sellable <= 0n || sellable >= r.tokenReserve) throw new ToolError("The curve is closed.");
  let snipeBps = rawSnipeBps;
  if (snipeBps > 0n) {
    const maxSnipe = BPS - feeBps - taxBps - 100n;
    if (snipeBps > maxSnipe) snipeBps = maxSnipe < 0n ? 0n : maxSnipe;
  }
  let spent = quoteIn;
  const net = spent - bps(spent, feeBps) - bps(spent, taxBps) - bps(spent, snipeBps);
  if (net <= 0n) throw new ToolError("Fees consume the whole amount.");
  let tokensOut = amountOut(net, r.quoteReserve, r.tokenReserve);
  if (tokensOut === 0n) throw new ToolError("The amount is too small.");
  if (tokensOut > sellable) {
    tokensOut = sellable;
    const grossed = mulDivCeil(amountIn(sellable, r.quoteReserve, r.tokenReserve), BPS, BPS - (feeBps + taxBps + snipeBps));
    spent = grossed < quoteIn ? grossed : quoteIn;
  }
  return { tokensOut, spent, refund: quoteIn - spent, fee: bps(spent, feeBps), tax: bps(spent, taxBps), snipeTax: bps(spent, snipeBps) };
}

export function quoteSell(r: Reserves, tokensIn: bigint, feeBps: bigint, taxBps: bigint) {
  if (tokensIn <= 0n) throw new ToolError("The amount must be above zero.");
  const gross = amountOut(tokensIn, r.tokenReserve, r.quoteReserve);
  if (gross === 0n) throw new ToolError("The amount is too small.");
  const fee = bps(gross, feeBps);
  const tax = bps(gross, taxBps);
  const quoteOut = gross - fee - tax;
  if (quoteOut <= 0n) throw new ToolError("Fees consume the whole output.");
  return { quoteOut, grossQuoteOut: gross, fee, tax };
}

// ---------------------------------------------------------------------------
// Chain reads

interface Meta {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  about: string;
  category: string | null;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
  block: bigint;
}

export function splitDescription(description: string): { about: string; category: string | null } {
  const at = description.lastIndexOf(KIPS_TAG);
  if (at === -1) return { about: description.trim(), category: null };
  try {
    const o = JSON.parse(description.slice(at + KIPS_TAG.length)) as { c?: unknown };
    return { about: description.slice(0, at).trim(), category: typeof o.c === "string" ? o.c : "other" };
  } catch {
    return { about: description.trim(), category: null };
  }
}

async function readMeta(token: Address, block = 0n): Promise<Meta> {
  const t = { address: token, abi: tokenAbi } as const;
  const [name, symbol, info] = await Promise.all([
    client.readContract({ ...t, functionName: "name" }),
    client.readContract({ ...t, functionName: "symbol" }),
    client.readContract({ ...t, functionName: "getTokenInfo" }),
  ]);
  const [, logo, description, socials] = info;
  return { token, name, symbol, logo, ...splitDescription(description), socials, block };
}

/**
 * Token metadata is fixed at launch, so it is kept for the life of the
 * instance: a Meta for KIPS tokens, null for tokens that are not KIPS tokens.
 * Reads that fail are not cached; they are retried on the next request.
 */
const metaCache = new Map<string, Meta | null>();
const retry = new Map<string, bigint>();
let registry: { at: number; head: bigint; agents: Meta[] } | null = null;
const CHUNK = 200;

/** Reads one batch of launches: the description first, name and ticker only for KIPS tokens. */
async function readBatch(batch: [Address, bigint][]): Promise<void> {
  const infos = await Promise.all(
    batch.map(([token]) => client.readContract({ address: token, abi: tokenAbi, functionName: "getTokenInfo" }).catch(() => null)),
  );
  const kips: [Address, bigint, (typeof infos)[number] & object][] = [];
  batch.forEach(([token, block], i) => {
    const info = infos[i];
    if (!info) return void retry.set(token.toLowerCase(), block);
    if (!info[2].includes(KIPS_TAG) && token.toLowerCase() !== OFFICIAL.toLowerCase()) {
      metaCache.set(token.toLowerCase(), null);
      return void retry.delete(token.toLowerCase());
    }
    kips.push([token, block, info]);
  });
  await Promise.all(
    kips.map(async ([token, block, info]) => {
      try {
        const t = { address: token, abi: tokenAbi } as const;
        const [name, symbol] = await Promise.all([
          client.readContract({ ...t, functionName: "name" }),
          client.readContract({ ...t, functionName: "symbol" }),
        ]);
        const [, logo, description, socials] = info;
        metaCache.set(token.toLowerCase(), { token, name, symbol, logo, ...splitDescription(description), socials, block });
        retry.delete(token.toLowerCase());
      } catch {
        retry.set(token.toLowerCase(), block);
      }
    }),
  );
}

/** Every token launched through KIPS (it carries a KIPS profile), newest first, plus the official token. */
async function kipsTokens(): Promise<Meta[]> {
  if (registry && Date.now() - registry.at < 60_000) return registry.agents;
  const head = await client.getBlockNumber();
  const from = registry ? registry.head + 1n : KIPS_START_BLOCK;
  const logs = from > head ? [] : await client.getLogs({ address: FACTORY, event: launchedEvent, fromBlock: from, toBlock: head });
  const todo = new Map<string, [Address, bigint]>();
  for (const [key, block] of retry) todo.set(key, [key as Address, block]);
  for (const l of logs) {
    const token = l.args.token!;
    if (!metaCache.has(token.toLowerCase())) todo.set(token.toLowerCase(), [token, l.blockNumber ?? 0n]);
  }
  if (!metaCache.get(OFFICIAL.toLowerCase())) todo.set(OFFICIAL.toLowerCase(), [OFFICIAL, metaCache.get(OFFICIAL.toLowerCase())?.block ?? 0n]);
  const list = [...todo.values()];
  for (let i = 0; i < list.length; i += CHUNK) await readBatch(list.slice(i, i + CHUNK));
  const agents = [...metaCache.values()]
    .filter((m): m is Meta => m !== null && !HIDDEN.has(m.token.toLowerCase()))
    .sort((a, b) => (isOfficial(a.token) ? -1 : isOfficial(b.token) ? 1 : a.block > b.block ? -1 : a.block < b.block ? 1 : 0));
  registry = { at: Date.now(), head, agents };
  return agents;
}

/** A 0x address, or a ticker of a KIPS token ("$KIPS", "kips"). The official token wins its ticker. */
async function resolveToken(input: string): Promise<Address> {
  const s = String(input ?? "").trim();
  if (isAddress(s)) return s;
  const ticker = s.replace(/^\$/, "").toUpperCase();
  if (!ticker) throw new ToolError("Give a token: a 0x contract address or a ticker such as KIPS.");
  const list = await kipsTokens();
  const hit = list.find((m) => m.symbol.toUpperCase() === ticker);
  if (!hit) throw new ToolError(`No KIPS token with the ticker $${ticker}. Use list_agents to see them, or pass the 0x contract address.`);
  return hit.token;
}

async function readTokenState(token: Address) {
  const launched = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] });
  if (!launched.exists) throw new ToolError(`${token} is not a token launched on Pons v2 (Robinhood Chain).`);
  const c = { address: launched.curve, abi: curveAbi } as const;
  const t = { address: token, abi: tokenAbi } as const;
  const [meta, supply, reserves, raised, sellable, feeBps, taxBps, graduated, readyToGraduate, snipeBps, ...dead] = await Promise.all([
    metaCache.get(token.toLowerCase()) ?? readMeta(token),
    client.readContract({ ...t, functionName: "totalSupply" }),
    client.readContract({ ...c, functionName: "getReserves" }),
    client.readContract({ ...c, functionName: "realQuoteReserve" }),
    client.readContract({ ...c, functionName: "sellableTokens" }),
    client.readContract({ ...c, functionName: "feeBps" }),
    client.readContract({ ...c, functionName: "creatorTaxBps" }),
    client.readContract({ ...c, functionName: "graduated" }),
    client.readContract({ ...c, functionName: "readyToGraduate" }),
    client.readContract({ ...c, functionName: "currentSnipeTaxBps", args: [DEAD[0]] }).catch(() => 0n),
    ...DEAD.map((a) => client.readContract({ ...t, functionName: "balanceOf", args: [a] }).catch(() => 0n)),
  ]);
  const burned = dead.reduce((s, b) => s + b, supply < INITIAL_SUPPLY ? INITIAL_SUPPLY - supply : 0n);
  const r = { quoteReserve: reserves[0], tokenReserve: reserves[1] };
  return { launched, meta, supply, reserves: r, raised, sellable, feeBps, taxBps, graduated: graduated || launched.phase !== 0, readyToGraduate, snipeBps, burned };
}

// ---------------------------------------------------------------------------
// Formatting

/** ETH or token amount as a plain decimal string with at most `dp` decimals. */
export function amount(wei: bigint, dp = 6): string {
  const s = formatEther(wei);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, dp).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
}
const pct = (b: bigint | number) => `${(Number(b) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const pageUrl = (token: string) => `${SITE}/#/agent/${token}`;
const shareUrl = (token: string) => `${SITE}/t/${token}`;

function parseEth(raw: unknown, label: string): bigint {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(s)) throw new ToolError(`${label} must be a positive number, for example 0.01.`);
  const v = parseEther(s as `${number}`);
  if (v <= 0n) throw new ToolError(`${label} must be above zero.`);
  return v;
}

const isOfficial = (t: string) => t.toLowerCase() === OFFICIAL.toLowerCase();

function summary(m: Meta) {
  return {
    address: m.token,
    name: m.name,
    symbol: m.symbol,
    category: isOfficial(m.token) ? "official" : m.category,
    description: m.about,
    logo: m.logo || null,
    x: m.socials.twitter || null,
    website: m.socials.website || null,
    page: pageUrl(m.token),
  };
}

// ---------------------------------------------------------------------------
// X profiles (served by this site's /api/x-profile)

interface XProfile {
  handle: string;
  name: string;
  bio: string;
  avatar: string;
  banner: string;
  followers: number;
  verified: boolean;
}

export function parseHandle(input: unknown): string | null {
  let s = String(input ?? "").trim();
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#\s]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

async function siteJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(50_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ToolError(body.error ?? `KIPS answered ${res.status}.`);
  return body;
}

// ---------------------------------------------------------------------------
// Links for the prepare_* tools

/** A hash-route link with query parameters, e.g. https://www.trykips.app/#/agent?name=Atlas */
export function appLink(page: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
  const qs = q.toString();
  return `${SITE}/#/${page}${qs ? `?${qs}` : ""}`;
}

const LIMITS = { name: 64, symbol: 16, logo: 512, description: 1500, social: 256 };
const bytes = (s: string) => new TextEncoder().encode(s).length;

function checkText(value: unknown, label: string, max: number, required = false): string | undefined {
  const s = String(value ?? "").trim();
  if (!s) {
    if (required) throw new ToolError(`${label} is required.`);
    return undefined;
  }
  if (bytes(s) > max) throw new ToolError(`${label} is too long (max ${max} bytes).`);
  return s;
}

function checkUrl(value: unknown, label: string): string | undefined {
  const s = checkText(value, label, LIMITS.social);
  if (!s) return undefined;
  if (!/^(https?:\/\/|ipfs:\/\/)/i.test(s)) throw new ToolError(`${label} must be an https:// or ipfs:// URL.`);
  return s;
}

// ---------------------------------------------------------------------------
// Tools

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
  run: (args: Json) => Promise<Json>;
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const tokenArg = { type: "string", description: "A 0x contract address, or the ticker of a KIPS token such as KIPS or $KIPS." };

export const TOOLS: Tool[] = [
  {
    name: "get_launch_info",
    title: "Launch info",
    description: "How launching a token on KIPS works right now: launch fee, supply, curve fee, graduation threshold and the maximum creator fee, read from Robinhood Chain.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
    run: async () => {
      const f = { address: FACTORY, abi: factoryAbi } as const;
      const [enabled, fee, maxTax, count] = await Promise.all([
        client.readContract({ ...f, functionName: "launchEnabled" }),
        client.readContract({ ...f, functionName: "launchFee" }),
        client.readContract({ ...f, functionName: "maxCreatorTaxBps" }),
        client.readContract({ ...f, functionName: "launchConfigCount" }),
      ]);
      const configs = await Promise.all(
        Array.from({ length: Number(count) }, (_, i) => client.readContract({ ...f, functionName: "getLaunchConfig", args: [BigInt(i)] })),
      );
      const c = configs.find((x) => x.enabled);
      return {
        network: "Robinhood Chain (chain id 4663)",
        launches_enabled: enabled,
        launch_fee_eth: amount(fee),
        max_creator_fee: pct(maxTax),
        ...(c && {
          supply: amount(c.supply, 0),
          curve_fee: pct(c.curveFeeBps),
          graduation_threshold_eth: amount(c.graduationThreshold),
          graduates_to: "Uniswap v4",
        }),
        how: "Use prepare_launch to get a filled-in KIPS link; the user signs the launch in their own wallet.",
      };
    },
  },
  {
    name: "list_agents",
    title: "List KIPS tokens",
    description: "Tokens launched through KIPS on Robinhood Chain, newest first, with the official $KIPS token on top. Filter by category or search by name or ticker.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Only this category: assistant, trading, research, social, gaming, infra, other, profile (tokenized X profiles) or official." },
        search: { type: "string", description: "Text to match against the name or ticker." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
    annotations: READ,
    run: async (a) => {
      const all = await kipsTokens();
      const cat = String(a.category ?? "").trim().toLowerCase();
      const q = String(a.search ?? "").trim().toLowerCase().replace(/^\$/, "");
      const limit = Math.min(Math.max(Number(a.limit) || 25, 1), 100);
      const hits = all
        .map(summary)
        .filter((t) => !cat || t.category === cat)
        .filter((t) => !q || t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q));
      return { total: hits.length, tokens: hits.slice(0, limit) };
    },
  },
  {
    name: "get_token",
    title: "Token details",
    description: "Live details of a token on Robinhood Chain: price, market cap, bonding-curve progress, creator fee, burned supply and links.",
    inputSchema: { type: "object", properties: { token: tokenArg }, required: ["token"], additionalProperties: false },
    annotations: READ,
    run: async (a) => {
      const token = await resolveToken(String(a.token));
      const s = await readTokenState(token);
      const price = s.reserves.tokenReserve > 0n ? (s.reserves.quoteReserve * WAD) / s.reserves.tokenReserve : 0n;
      const progress = s.launched.graduationThreshold > 0n ? (s.raised * BPS) / s.launched.graduationThreshold : 0n;
      return {
        ...summary(s.meta),
        price_eth: amount(price, 12),
        market_cap_eth: amount((price * s.supply) / WAD, 4),
        bonding_curve: s.graduated
          ? "graduated to Uniswap v4"
          : { raised_eth: amount(s.raised, 4), graduation_eth: amount(s.launched.graduationThreshold, 4), progress: pct(progress > BPS ? BPS : progress) },
        creator_fee: pct(s.taxBps),
        creator_fee_recipient: s.launched.creatorFeeRecipient,
        deployer: s.launched.deployer,
        buyback: s.launched.buybackEnabled,
        burned: amount(s.burned, 0),
        burned_share: pct((s.burned * BPS) / INITIAL_SUPPLY),
        share_link: shareUrl(token),
      };
    },
  },
  {
    name: "quote_buy",
    title: "Quote a buy",
    description: "How many tokens an ETH amount buys right now on the token's bonding curve, after fees, and the minimum at 5% slippage. Read-only; use prepare_trade to get a link the user can sign.",
    inputSchema: {
      type: "object",
      properties: { token: tokenArg, eth: { type: "string", description: "ETH to spend, for example \"0.01\"." } },
      required: ["token", "eth"],
      additionalProperties: false,
    },
    annotations: READ,
    run: async (a) => {
      const token = await resolveToken(String(a.token));
      const eth = parseEth(a.eth, "eth");
      const s = await readTokenState(token);
      if (s.graduated || s.readyToGraduate) throw new ToolError("This token has left its bonding curve; it trades on Uniswap v4.");
      const q = quoteBuy(s.reserves, s.sellable, eth, s.feeBps, s.taxBps, s.snipeBps);
      const min = (eth * q.tokensOut * (BPS - DEFAULT_SLIPPAGE_BPS)) / (q.spent * BPS);
      return {
        token: summary(s.meta),
        eth_in: amount(eth),
        tokens_out: amount(q.tokensOut, 4),
        min_tokens_out_at_5pct_slippage: amount(min, 4),
        fees_eth: { curve: amount(q.fee), creator: amount(q.tax), snipe: amount(q.snipeTax) },
        ...(q.refund > 0n && { refund_eth: amount(q.refund), note: "This buy empties the curve; the rest is refunded." }),
      };
    },
  },
  {
    name: "quote_sell",
    title: "Quote a sell",
    description: "How much ETH selling an amount of a token returns right now on its bonding curve, after fees. Read-only.",
    inputSchema: {
      type: "object",
      properties: { token: tokenArg, amount: { type: "string", description: "Tokens to sell, for example \"1000000\"." } },
      required: ["token", "amount"],
      additionalProperties: false,
    },
    annotations: READ,
    run: async (a) => {
      const token = await resolveToken(String(a.token));
      const tokens = parseEth(a.amount, "amount");
      const s = await readTokenState(token);
      if (s.graduated || s.readyToGraduate) throw new ToolError("This token has left its bonding curve; it trades on Uniswap v4.");
      const q = quoteSell(s.reserves, tokens, s.feeBps, s.taxBps);
      return {
        token: summary(s.meta),
        tokens_in: amount(tokens, 4),
        eth_out: amount(q.quoteOut),
        min_eth_out_at_5pct_slippage: amount((q.quoteOut * (BPS - DEFAULT_SLIPPAGE_BPS)) / BPS),
        fees_eth: { curve: amount(q.fee), creator: amount(q.tax) },
      };
    },
  },
  {
    name: "top_x_profiles",
    title: "Top X profiles",
    description: "The most-followed accounts on X, ranked by live follower counts, each with a link to tokenize it on KIPS.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } }, additionalProperties: false },
    annotations: READ,
    run: async (a) => {
      const limit = Math.min(Math.max(Number(a.limit) || 10, 1), 50);
      const { profiles } = await siteJson<{ profiles: XProfile[] }>("/api/x-profile?top=1");
      return {
        profiles: profiles.slice(0, limit).map((p, i) => ({
          rank: i + 1,
          handle: p.handle,
          name: p.name,
          followers: p.followers,
          verified: p.verified,
          tokenize_link: appLink("tokenize", { u: p.handle }),
        })),
      };
    },
  },
  {
    name: "get_x_profile",
    title: "X profile",
    description: "A public X profile: name, bio, picture and follower count.",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string", description: "An X username (jack, @jack) or profile link." } },
      required: ["username"],
      additionalProperties: false,
    },
    annotations: READ,
    run: async (a) => {
      const handle = parseHandle(a.username);
      if (!handle) throw new ToolError("That is not a valid X username.");
      const p = await siteJson<XProfile>(`/api/x-profile?u=${encodeURIComponent(handle)}`);
      return { ...p, x: `https://x.com/${p.handle}` };
    },
  },
  {
    name: "tokenize_x_profile",
    title: "Tokenize an X profile",
    description: "Reads an X profile and returns a KIPS link that opens Tokenize X with it loaded: the token takes the profile's name, picture and bio. The user reviews it and signs the launch in their wallet. Anyone can tokenize a public profile; the token is not endorsed by the account unless it launches it.",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string", description: "An X username (jack, @jack) or profile link." } },
      required: ["username"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a) => {
      const handle = parseHandle(a.username);
      if (!handle) throw new ToolError("That is not a valid X username.");
      const p = await siteJson<XProfile>(`/api/x-profile?u=${encodeURIComponent(handle)}`);
      return {
        profile: { handle: p.handle, name: p.name, followers: p.followers, verified: p.verified },
        suggested_ticker: p.handle.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16),
        link: appLink("tokenize", { u: p.handle }),
        next: "Open the link, check the name and ticker, then press Launch and approve in the wallet.",
      };
    },
  },
  {
    name: "prepare_launch",
    title: "Prepare a launch",
    description: "Prepares a KIPS agent-token launch on Robinhood Chain and returns a link with every field filled in. Nothing is sent: the user opens the link, reviews it and signs the launch in their own wallet (launch fee plus gas; see get_launch_info).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Token name, e.g. Atlas." },
        ticker: { type: "string", description: "Ticker without $, e.g. ATLAS. No spaces." },
        description: { type: "string", description: "What the agent does, one or two sentences." },
        category: { type: "string", enum: ["assistant", "trading", "research", "social", "gaming", "infra", "other"] },
        logo_url: { type: "string", description: "https:// or ipfs:// image URL. Optional; the user can also upload one on the page." },
        x: { type: "string", description: "X handle or link." },
        website: { type: "string" },
        telegram: { type: "string" },
        endpoint: { type: "string", description: "The agent's own API, MCP or A2A endpoint URL." },
        initial_buy_eth: { type: "string", description: "Optional ETH to buy in the launch transaction, e.g. \"0.01\"." },
        creator_fee_pct: { type: "number", minimum: 0, description: "Creator fee on every trade, in percent (default 1)." },
      },
      required: ["name", "ticker"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => {
      const name = checkText(a.name, "name", LIMITS.name, true)!;
      const ticker = checkText(String(a.ticker ?? "").replace(/^\$/, "").toUpperCase(), "ticker", LIMITS.symbol, true)!;
      if (/\s/.test(ticker)) throw new ToolError("A ticker cannot contain spaces.");
      const buy = a.initial_buy_eth !== undefined && String(a.initial_buy_eth).trim() !== "" ? amount(parseEth(a.initial_buy_eth, "initial_buy_eth")) : undefined;
      const fee = a.creator_fee_pct !== undefined ? Number(a.creator_fee_pct) : undefined;
      if (fee !== undefined && (!Number.isFinite(fee) || fee < 0 || fee > 10)) throw new ToolError("creator_fee_pct must be between 0 and 10.");
      const x = a.x ? parseHandle(a.x) ?? undefined : undefined;
      if (a.x && !x) throw new ToolError("x must be an X username or profile link.");
      const params = {
        name,
        ticker,
        about: checkText(a.description, "description", LIMITS.description),
        category: a.category ? String(a.category) : undefined,
        logo: checkUrl(a.logo_url, "logo_url"),
        x: x ? `https://x.com/${x}` : undefined,
        website: checkUrl(a.website, "website"),
        telegram: checkText(a.telegram, "telegram", LIMITS.social),
        endpoint: checkUrl(a.endpoint, "endpoint"),
        buy,
        fee: fee !== undefined ? String(fee) : undefined,
      };
      return {
        link: appLink("agent", params),
        prefilled: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)),
        next: "Open the link: KIPS shows the token preview. Press Launch token and approve in the wallet. Nothing is sent until then.",
      };
    },
  },
  {
    name: "prepare_trade",
    title: "Prepare a trade",
    description: "Prepares a buy or sell of a KIPS token and returns a Terminal link with the order typed in. The user reviews the quote, confirms and signs in their own wallet.",
    inputSchema: {
      type: "object",
      properties: {
        side: { type: "string", enum: ["buy", "sell"] },
        token: tokenArg,
        amount: { type: "string", description: "For buy: ETH to spend (\"0.01\"). For sell: tokens to sell (\"1000000\"), a percentage (\"50%\") or \"all\"." },
      },
      required: ["side", "token", "amount"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a) => {
      const side = String(a.side);
      if (side !== "buy" && side !== "sell") throw new ToolError("side must be buy or sell.");
      const token = await resolveToken(String(a.token));
      const meta = metaCache.get(token.toLowerCase()) ?? (await readMeta(token));
      const raw = String(a.amount ?? "").trim().toLowerCase();
      let cmd: string;
      if (side === "buy") {
        cmd = `swap ${amount(parseEth(raw, "amount"))} eth to ${token}`;
      } else if (raw === "all" || raw === "max") {
        cmd = `sell all ${token}`;
      } else if (/^\d+(\.\d+)?%$/.test(raw) && Number(raw.slice(0, -1)) > 0 && Number(raw.slice(0, -1)) <= 100) {
        cmd = `sell ${raw} ${token}`;
      } else {
        cmd = `sell ${amount(parseEth(raw, "amount"), 18)} ${token}`;
      }
      return {
        token: summary(meta),
        command: cmd,
        link: appLink("terminal", { cmd }),
        next: "Open the link and send the command: the Terminal quotes it, then type confirm and approve in the wallet.",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// JSON-RPC / MCP

type RpcId = string | number | null;
interface RpcRequest {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Json;
}

const INSTRUCTIONS =
  "KIPS launches AI-agent tokens on Robinhood Chain (chain id 4663), built on Pons v2 bonding curves. " +
  "Read tools need no wallet. prepare_launch, prepare_trade and tokenize_x_profile never send anything: " +
  "they return a trykips.app link the user opens and signs in their own wallet. Tokens can be named by " +
  "0x address or by ticker; the official $KIPS is 0xd1F91331F3c9CE8b4C4E265392c27Afb90a7f82C. " +
  "Agent tokens are high risk; do not present quotes as advice.";

const toJsonText = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

export async function handle(msg: RpcRequest): Promise<Json | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid JSON-RPC request.");
  // Notifications (no id) get no answer.
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ run: _run, ...t }) => t) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Json;
      try {
        const result = await tool.run(args);
        return ok({ content: [{ type: "text", text: toJsonText(result) }], structuredContent: JSON.parse(toJsonText(result)) });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : `Robinhood Chain could not be read right now (${e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "error"}). Try again.`;
        return ok({ content: [{ type: "text", text }], isError: true });
      }
    }
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
};

const reply = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, 400);
  }
  if (Array.isArray(body)) {
    if (body.length === 0) return reply({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Empty batch." } }, 400);
    const out = (await Promise.all(body.map((m) => handle(m as RpcRequest)))).filter((r) => r !== null);
    return out.length ? reply(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handle(body as RpcRequest);
  return out ? reply(out) : new Response(null, { status: 202, headers: CORS });
}

/** No server-to-client stream: this server only answers requests. */
export function GET(): Response {
  return new Response(
    JSON.stringify({ name: "KIPS MCP server", transport: "streamable-http", endpoint: `${SITE}/api/mcp`, docs: `${SITE}/#/mcp` }),
    { status: 405, headers: { ...CORS, allow: "POST, OPTIONS", "content-type": "application/json" } },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
