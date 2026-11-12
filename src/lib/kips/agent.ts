// kips stores an agent's profile inside the Pons token's on-chain description
// as a one-line trailer, so an agent is fully described by its Pons v2 token
// and needs no extra contract or backend:
//
//   <human readable description>
//
//   [kips:1]{"c":"trading","s":["swaps","alerts"],"e":"https://agent.example/mcp"}

export const KIPS_TAG = "[kips:1]";

/** Pons v2 on-chain metadata limits, in UTF-8 bytes. */
export const LIMITS = { name: 64, symbol: 16, logo: 512, description: 2048, social: 256 } as const;

export const CATEGORIES = ["assistant", "trading", "research", "social", "gaming", "infra", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface AgentProfile {
  category: Category;
  skills: string[];
  /** Where the agent can be reached (API, MCP or A2A endpoint). Optional. */
  endpoint: string;
}

export const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Only http(s) URLs are ever rendered as links or image sources. */
export function safeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${s.slice(7).replace(/^ipfs\//, "")}`;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeSkills(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(",");
  const seen = new Set<string>();
  for (const p of parts) {
    const s = p.trim().toLowerCase().slice(0, 32);
    if (s) seen.add(s);
  }
  return [...seen].slice(0, 8);
}

export function encodeDescription(about: string, profile: AgentProfile): string {
  const payload = JSON.stringify({
    c: profile.category,
    s: normalizeSkills(profile.skills),
    ...(profile.endpoint.trim() ? { e: profile.endpoint.trim() } : {}),
  });
  const body = about.trim();
  return `${body}${body ? "\n\n" : ""}${KIPS_TAG}${payload}`;
}

export interface DecodedDescription {
  about: string;
  /** null when the token was not launched as a kips agent. */
  profile: AgentProfile | null;
}

export function decodeDescription(description: string): DecodedDescription {
  const at = description.lastIndexOf(KIPS_TAG);
  if (at === -1) return { about: description.trim(), profile: null };
  try {
    const raw: unknown = JSON.parse(description.slice(at + KIPS_TAG.length));
    if (typeof raw !== "object" || raw === null) throw new Error("not an object");
    const o = raw as Record<string, unknown>;
    const category = CATEGORIES.includes(o.c as Category) ? (o.c as Category) : "other";
    const skills = Array.isArray(o.s) ? normalizeSkills(o.s.filter((x): x is string => typeof x === "string")) : [];
    const endpoint = typeof o.e === "string" ? o.e : "";
    return { about: description.slice(0, at).trim(), profile: { category, skills, endpoint } };
  } catch {
    return { about: description.trim(), profile: null };
  }
}

export interface LaunchForm {
  name: string;
  symbol: string;
  logo: string;
  about: string;
  profile: AgentProfile;
  socials: { twitter: string; telegram: string; discord: string; website: string };
}

/** Returns a list of human-readable problems; empty means the form is valid. */
export function validateLaunchForm(f: LaunchForm): string[] {
  const errs: string[] = [];
  const name = f.name.trim();
  const symbol = f.symbol.trim();
  if (!name) errs.push("Name is required.");
  else if (byteLength(name) > LIMITS.name) errs.push(`Name is over ${LIMITS.name} bytes.`);
  if (!symbol) errs.push("Ticker is required.");
  else if (byteLength(symbol) > LIMITS.symbol) errs.push(`Ticker is over ${LIMITS.symbol} bytes.`);
  if (f.logo.trim()) {
    if (!safeUrl(f.logo)) errs.push("Logo must be an http(s) or ipfs:// URL.");
    if (byteLength(f.logo.trim()) > LIMITS.logo) errs.push(`Logo URL is over ${LIMITS.logo} bytes.`);
  }
  if (f.profile.endpoint.trim() && !safeUrl(f.profile.endpoint)) errs.push("Agent endpoint must be an http(s) URL.");
  const descBytes = byteLength(encodeDescription(f.about, f.profile));
  if (descBytes > LIMITS.description) {
    errs.push(`Description plus agent profile is ${descBytes} bytes; the limit is ${LIMITS.description}.`);
  }
  for (const [k, v] of Object.entries(f.socials)) {
    if (byteLength(v.trim()) > LIMITS.social) errs.push(`${k} is over ${LIMITS.social} bytes.`);
  }
  return errs;
}
