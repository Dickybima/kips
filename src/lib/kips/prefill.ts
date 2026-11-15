// Filled-in links, e.g. from the KIPS MCP server or a shared link:
//   #/agent?name=Atlas&ticker=ATLAS&about=...   the launch form
//   #/terminal?cmd=swap 0.01 eth to kips        a Terminal order, typed in
//   #/tokenize?u=jack                            an X profile, looked up
// Nothing runs on its own: every launch and trade still waits for the person.
import type { Answers } from "./wizard";

/** The query part of the current #/ route. */
export function hashParams(hash = typeof location === "undefined" ? "" : location.hash): URLSearchParams {
  const at = hash.indexOf("?");
  return new URLSearchParams(at === -1 ? "" : hash.slice(at + 1));
}

const LAUNCH_FIELDS: Record<string, keyof Answers> = {
  name: "name",
  ticker: "symbol",
  symbol: "symbol",
  about: "about",
  description: "about",
  category: "category",
  logo: "logo",
  x: "twitter",
  twitter: "twitter",
  website: "website",
  telegram: "telegram",
  endpoint: "endpoint",
  buy: "buy",
  fee: "tax",
};

/** Launch-form answers carried in a link; the form still validates each one. */
export function launchPrefill(params: URLSearchParams): Partial<Answers> {
  const out: Partial<Answers> = {};
  for (const [key, field] of Object.entries(LAUNCH_FIELDS)) {
    const v = params.get(key)?.trim();
    if (v && out[field] === undefined) out[field] = v.slice(0, 2048);
  }
  return out;
}
