// Turns a free-form chat message into launch fields, for example
//   "name: Atlas ticker: ATLAS x: @atlas website: atlas.xyz"
//   "agent Atlas ticker ATLAS category trading"
// Values are returned raw (after light normalisation); the wizard's step
// parsers still validate each one.
import type { Answers } from "./wizard";

const ALIASES: Record<string, keyof Answers> = {
  name: "name",
  agent: "name",
  token: "name",
  ticker: "symbol",
  symbol: "symbol",
  about: "about",
  description: "about",
  desc: "about",
  bio: "about",
  does: "about",
  category: "category",
  cat: "category",
  skills: "skills",
  skill: "skills",
  endpoint: "endpoint",
  api: "endpoint",
  mcp: "endpoint",
  logo: "logo",
  image: "logo",
  website: "website",
  web: "website",
  site: "website",
  x: "twitter",
  twitter: "twitter",
  telegram: "telegram",
  tg: "telegram",
  wallet: "wallet",
  payout: "wallet",
  fee: "tax",
  tax: "tax",
  buyback: "buyback",
  buy: "buy",
};

const KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length).join("|");
// "key:" anywhere; or, in loose mode, a bare key at a word boundary.
const STRICT = new RegExp(`(?:^|[\\s,;])(${KEYS})\\s*[:=]\\s*`, "gi");
const LOOSE = new RegExp(`(?:^|[\\s,;])(${KEYS})\\s+(?=\\S)`, "gi");

function normalise(key: keyof Answers, raw: string): string {
  const v = raw.trim().replace(/[,;]+$/, "").trim();
  if (!v) return v;
  const bare = (s: string) => s.replace(/^@/, "").replace(/^https?:\/\//i, "");
  switch (key) {
    case "twitter":
      if (/^https?:\/\//i.test(v)) return v;
      if (/^(x|twitter)\.com\//i.test(v)) return `https://${v}`;
      return `https://x.com/${bare(v)}`;
    case "telegram":
      if (/^https?:\/\//i.test(v)) return v;
      if (/^t\.me\//i.test(v)) return `https://${v}`;
      return `https://t.me/${bare(v)}`;
    case "website":
    case "endpoint":
    case "logo":
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || v.startsWith("ipfs://") ? v : `https://${v}`;
    case "symbol":
      return v.replace(/^\$/, "");
    default:
      return v;
  }
}

/** Fields found in the message; empty when it contains no recognised keys. */
export function parseIntent(text: string): Partial<Answers> {
  const msg = text.replace(/\r/g, "").trim();
  // A colon anywhere means the user is writing key: value pairs, so bare words
  // like "x" or "web" inside a description are left alone.
  const re = new RegExp((/(^|[\s,;])[a-z]+\s*[:=]/i.test(msg) ? STRICT : LOOSE).source, "gi");
  const hits: { key: keyof Answers; start: number; end: number }[] = [];
  for (let m = re.exec(msg); m; m = re.exec(msg)) {
    hits.push({ key: ALIASES[m[1].toLowerCase()], start: m.index, end: m.index + m[0].length });
  }
  const out: Partial<Answers> = {};
  hits.forEach((h, i) => {
    const raw = msg.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : undefined);
    const value = normalise(h.key, raw);
    if (value && out[h.key] === undefined) out[h.key] = value;
  });
  return out;
}
