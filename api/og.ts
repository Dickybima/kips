// Vercel Function: the share card for a token, as a 1200x630 PNG.
// GET /api/og?token=0x...
// Everything on the card is read from Robinhood Chain when the card is made.
// This file is self-contained: a Vercel Function cannot import other files
// from the app at runtime.
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { createPublicClient, http, isAddress, parseAbi, type Address } from "viem";

declare const process: { env: Record<string, string | undefined> };

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const OFFICIAL = "0xd1f91331f3c9ce8b4c4e265392c27afb90a7f82c";
const SITE = (process.env.VITE_SITE_URL || "https://www.trykips.app").replace(/\/$/, "");
const WAD = 10n ** 18n;
const INITIAL_SUPPLY = 1_000_000_000n * WAD;
const DEAD: Address[] = ["0x000000000000000000000000000000000000dEaD", "0x0000000000000000000000000000000000000000"];
const KIPS_TAG = "[kips:1]";

const client = createPublicClient({ transport: http(RPC, { batch: true, retryCount: 2 }) });

const factoryAbi = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);
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
]);

export interface CardData {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  about: string;
  badge: string;
  /** Market cap in wei of ETH; null when the price is unknown. */
  marketCap: bigint | null;
  raised: bigint;
  threshold: bigint;
  graduated: boolean;
  burned: bigint;
  creatorTaxBps: number;
}

/** The human description and the KIPS category, from the on-chain description. */
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

export async function readCard(token: Address): Promise<CardData | null> {
  const t = { address: token, abi: tokenAbi } as const;
  const launched = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] });
  if (!launched.exists) return null;
  const c = { address: launched.curve, abi: curveAbi } as const;
  const [name, symbol, info, supply, reserves, raised, ...dead] = await Promise.all([
    client.readContract({ ...t, functionName: "name" }),
    client.readContract({ ...t, functionName: "symbol" }),
    client.readContract({ ...t, functionName: "getTokenInfo" }),
    client.readContract({ ...t, functionName: "totalSupply" }),
    client.readContract({ ...c, functionName: "getReserves" }).catch(() => null),
    client.readContract({ ...c, functionName: "realQuoteReserve" }).catch(() => 0n),
    ...DEAD.map((a) => client.readContract({ ...t, functionName: "balanceOf", args: [a] }).catch(() => 0n)),
  ]);
  const [, logo, description] = info;
  const { about, category } = splitDescription(description);
  const price = reserves && reserves[1] > 0n ? (reserves[0] * WAD) / reserves[1] : null;
  const burned = dead.reduce((s, b) => s + b, supply < INITIAL_SUPPLY ? INITIAL_SUPPLY - supply : 0n);
  const official = token.toLowerCase() === OFFICIAL;
  return {
    token,
    name,
    symbol,
    logo,
    about,
    badge: official ? "OFFICIAL" : category === "profile" ? "X PROFILE" : category ? category.toUpperCase() : "TOKEN",
    marketCap: price !== null ? (price * supply) / WAD : null,
    raised,
    threshold: launched.graduationThreshold,
    graduated: launched.phase !== 0,
    burned,
    creatorTaxBps: launched.creatorTaxBps,
  };
}

/** 0.48219 ETH -> "0.4822", 1234.5 -> "1,234.5"; large token counts -> "17.03M". */
export function short(value: bigint, digits = 4): string {
  const n = Number(value) / 1e18;
  if (n >= 1e6) return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n < 0.0001) return "0";
  return n.toPrecision(digits).replace(/0+$/, "").replace(/\.$/, "");
}

/** Cuts text to a number of characters on a word boundary. */
export function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).trimEnd()}…`;
}

// ---- assets ----

let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all(
    ([["Regular", 400], ["Bold", 700]] as const).map(async ([file, weight]) => {
      const res = await fetch(`${SITE}/fonts/JetBrainsMono-${file}.ttf`);
      if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
      return { name: "JetBrains Mono", data: await res.arrayBuffer(), weight, style: "normal" as const };
    }),
  ).catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"];

/** Public IPFS gateways, raced: a single gateway is often too slow for a card. */
const IPFS_GATEWAYS = ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/", "https://w3s.link/ipfs/", "https://gateway.pinata.cloud/ipfs/"];

/** Every URL the logo can be fetched from: one for http(s), one per gateway for ipfs://. */
export function logoSources(raw: string): string[] {
  const url = raw.trim();
  if (url.startsWith("ipfs://")) {
    const path = url.slice(7).replace(/^ipfs\//, "");
    return path ? IPFS_GATEWAYS.map((g) => g + path) : [];
  }
  const gateway = url.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/i);
  if (gateway) return [...new Set([url, ...IPFS_GATEWAYS.map((g) => g + gateway[1])])];
  return /^https?:\/\//i.test(url) ? [url] : [];
}

async function fetchImage(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // Some gateways answer with a generic type; sharp checks the bytes anyway.
  if (!res.ok || !(IMAGE_TYPES.includes(type) || type === "application/octet-stream")) throw new Error(`logo ${res.status} ${type}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 2_000_000) throw new Error("logo too large");
  return bytes;
}

/** The logo as a PNG data URL, or null when it cannot be fetched or read. */
async function logoData(raw: string): Promise<string | null> {
  const sources = logoSources(raw);
  if (sources.length === 0) return null;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 7000);
  try {
    const bytes = await Promise.any(sources.map((u) => fetchImage(u, stop.signal)));
    stop.abort(); // the first answer wins; drop the slower gateways
    // The rasteriser cannot read WebP (the format KIPS uploads use), so every
    // logo is turned into a small PNG first.
    const png = await sharp(bytes, { animated: false, limitInputPixels: 25_000_000 })
      .resize(336, 336, { fit: "cover" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- the card ----

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string | null | false)[]): Node => ({
  type,
  // The image renderer lays out flexbox only, so every box is a flex box.
  props: { style: { display: "flex", ...style }, children: children.filter((c) => c !== null && c !== false) },
});

const C = { bg: "#070809", panel: "#0d0f11", line: "#1f2327", fg: "#e9ecef", muted: "#7d858c", green: "#00c805", fire: "#ff8a2a" };

const MARK =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#070809"/><g fill="none" stroke="#00c805" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 7H7v18h3M22 7h3v18h-3"/><circle cx="16" cy="13" r="3"/><path d="M16 16v4M12.5 23h7"/></g></svg>',
  );

function stat(label: string, value: string, color = C.fg): Node {
  return h(
    "div",
    { display: "flex", flexDirection: "column", gap: 8, padding: "18px 24px", flex: 1, borderLeft: `1px solid ${C.line}` },
    h("div", { fontSize: 18, color: C.muted, letterSpacing: 2 }, label.toUpperCase()),
    h("div", { fontSize: 32, fontWeight: 700, color }, value),
  );
}

export function card(d: CardData, logo: string | null): Node {
  const pct = d.threshold > 0n ? Math.min(100, Number((d.raised * 10_000n) / d.threshold) / 100) : 0;
  const initials = d.symbol.slice(0, 2).toUpperCase();
  return h(
    "div",
    {
      width: 1200,
      height: 630,
      background: `radial-gradient(ellipse 70% 80% at 85% 20%, #0b2a0d 0%, ${C.bg} 60%)`,
      color: C.fg,
      fontFamily: "JetBrains Mono",
    },
    h(
    "div",
    { flex: 1, flexDirection: "column", padding: "48px 60px 40px", minWidth: 0 },
    // header
    h(
      "div",
      { display: "flex", alignItems: "center", justifyContent: "space-between" },
      h(
        "div",
        { display: "flex", alignItems: "center", gap: 16 },
        { type: "img", props: { src: MARK, width: 52, height: 52, style: { borderRadius: 12, border: `1px solid ${C.line}` } } },
        h("div", { fontSize: 28, fontWeight: 700, letterSpacing: 8 }, "KIPS"),
      ),
      h(
        "div",
        { display: "flex", fontSize: 18, letterSpacing: 3, color: C.green, border: `1px solid ${C.green}`, padding: "8px 16px", borderRadius: 6 },
        d.badge,
      ),
    ),
    // identity
    h(
      "div",
      { display: "flex", alignItems: "center", gap: 36, marginTop: 44 },
      logo
        ? { type: "img", props: { src: logo, width: 168, height: 168, style: { borderRadius: 32, border: `2px solid ${C.line}`, objectFit: "cover" } } }
        : h(
            "div",
            { width: 168, height: 168, borderRadius: 32, border: `2px solid ${C.line}`, background: C.panel, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 700, color: C.muted },
            initials,
          ),
      h(
        "div",
        { display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0 },
        h("div", { fontSize: 64, fontWeight: 700, lineHeight: 1.05 }, clip(d.name, 22)),
        h("div", { fontSize: 36, color: C.green, fontWeight: 700 }, `$${clip(d.symbol, 16)}`),
        d.about ? h("div", { fontSize: 24, color: C.muted, lineHeight: 1.4, marginTop: 6 }, clip(d.about, 110)) : null,
      ),
    ),
    // stats
    h(
      "div",
      { display: "flex", marginTop: "auto", border: `1px solid ${C.line}`, background: "rgba(13,15,17,0.85)", borderRadius: 10 },
      h(
        "div",
        { display: "flex", flexDirection: "column", gap: 12, padding: "18px 24px", flex: 1.6 },
        h(
          "div",
          { display: "flex", justifyContent: "space-between", fontSize: 18, color: C.muted, letterSpacing: 2 },
          h("div", {}, d.graduated ? "GRADUATED" : "BONDING CURVE"),
          h("div", { color: C.fg }, d.graduated ? "Uniswap v4" : `${short(d.raised)} / ${short(d.threshold)} ETH`),
        ),
        h(
          "div",
          { display: "flex", height: 14, background: "#15181b", borderRadius: 7, overflow: "hidden" },
          h("div", { width: `${d.graduated ? 100 : Math.max(pct, 1.5)}%`, background: C.green, borderRadius: 7 }),
        ),
      ),
      stat("Market cap", d.marketCap !== null ? `${short(d.marketCap)} ETH` : "—"),
      d.burned > 0n ? stat("Burned", `${short(d.burned)}`, C.fire) : stat("Creator fee", `${d.creatorTaxBps / 100}%`),
    ),
    // footer
    h(
      "div",
      { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, fontSize: 22, color: C.muted },
      h("div", { display: "flex" }, "Live on Robinhood Chain"),
      h("div", { display: "flex", color: C.fg, fontWeight: 700 }, "trykips.app"),
    ),
    ),
  );
}

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("token") ?? "";
  if (!isAddress(raw)) return new Response("Unknown token.", { status: 404 });
  let data: CardData | null;
  try {
    data = await readCard(raw);
  } catch {
    return new Response("Robinhood Chain could not be read.", { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!data) return new Response("Unknown token.", { status: 404 });
  const [font, logo] = await Promise.all([loadFonts(), logoData(data.logo)]);
  const png = await render(card(data, logo), font).catch(async () => render(card(data, null), font));
  return new Response(new Blob([png as BlobPart], { type: "image/png" }), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=300, s-maxage=600, stale-while-revalidate=86400" },
  });
}

type Fonts = Awaited<ReturnType<typeof loadFonts>>;

/** Lays the card out as SVG with satori, then rasterises it to PNG with resvg. */
export async function render(node: Node, font: Fonts): Promise<Uint8Array> {
  const svg = await satori(node as never, { width: 1200, height: 630, fonts: font });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}
