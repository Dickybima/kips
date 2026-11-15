// Vercel Function: the share link for a token, served at /t/<address>.
// Link previews (X, Telegram, Discord) read the meta tags, which point at
// the generated card from /api/og; people are sent straight to the token
// page. The app uses #/ routes, which never reach a server, so a shared
// #/agent/... link cannot have its own preview: this page is that preview.
// Self-contained: a Vercel Function cannot import other app files at runtime.
import { createPublicClient, http, isAddress, parseAbi, type Address } from "viem";

declare const process: { env: Record<string, string | undefined> };

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const SITE = (process.env.VITE_SITE_URL || "https://www.trykips.app").replace(/\/$/, "");
const KIPS_TAG = "[kips:1]";
const client = createPublicClient({ transport: http(RPC, { batch: true, retryCount: 2 }) });
const tokenAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

/** Escapes text for HTML text and double-quoted attributes. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export function sharePage(token: Address, name: string, symbol: string, about: string): string {
  const page = `${SITE}/#/agent/${token}`;
  const image = `${SITE}/api/og?token=${token}`;
  const title = `${oneLine(name, 60)} ($${oneLine(symbol, 16)}) on KIPS`;
  const description = oneLine(about, 200) || `Trade $${oneLine(symbol, 16)} on Robinhood Chain with KIPS.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="KIPS">
<meta property="og:url" content="${esc(`${SITE}/t/${token}`)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@trykips">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(page)}">
<link rel="canonical" href="${esc(page)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070809;color:#e9ecef;font:16px ui-monospace,monospace}a{color:#00c805}</style>
</head>
<body>
<p>Opening <a href="${esc(page)}">${esc(title)}</a>…</p>
<script>location.replace(${JSON.stringify(page).replace(/</g, "\\u003c")})</script>
</body>
</html>`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("token") ?? url.pathname.split("/").pop() ?? "";
  if (!isAddress(raw)) return Response.redirect(`${SITE}/#/explore`, 302);
  let name = "", symbol = "", about = "";
  try {
    const t = { address: raw, abi: tokenAbi } as const;
    const [n, s, info] = await Promise.all([
      client.readContract({ ...t, functionName: "name" }),
      client.readContract({ ...t, functionName: "symbol" }),
      client.readContract({ ...t, functionName: "getTokenInfo" }),
    ]);
    const description = info[2];
    const at = description.lastIndexOf(KIPS_TAG);
    [name, symbol, about] = [n, s, at === -1 ? description : description.slice(0, at)];
  } catch {
    // Not a token (or the chain is unreachable): still send people to the page.
    return Response.redirect(`${SITE}/#/agent/${raw}`, 302);
  }
  return new Response(sharePage(raw, name, symbol, about), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=600" },
  });
}
