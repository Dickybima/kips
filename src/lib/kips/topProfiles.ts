// Top profiles: tokenized X profiles ranked by their follower count on X.
import type { Address } from "viem";
import { parseHandle, type XProfile } from "./xprofile";

export interface ProfileToken {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  twitter: string;
  block: bigint;
}

export interface RankedProfile {
  handle: string;
  /** The first token launched for this profile through KIPS, if any. */
  token: ProfileToken | null;
  /** How many other tokens were launched for the same profile. */
  others: number;
  profile: XProfile | null;
}

/** One entry per X handle, keeping the earliest launch. Tokens without a valid X link are dropped. */
export function groupByHandle(tokens: ProfileToken[]): RankedProfile[] {
  const byHandle = new Map<string, RankedProfile>();
  for (const t of [...tokens].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0))) {
    const handle = parseHandle(t.twitter);
    if (!handle) continue;
    const key = handle.toLowerCase();
    const seen = byHandle.get(key);
    if (seen) seen.others += 1;
    else byHandle.set(key, { handle, token: t, others: 0, profile: null });
  }
  return [...byHandle.values()];
}

/** Most followers first; profiles that could not be read go last, newest launch first among equals. */
export function rankByFollowers(list: RankedProfile[]): RankedProfile[] {
  return [...list].sort((a, b) => {
    const fa = a.profile?.followers ?? -1;
    const fb = b.profile?.followers ?? -1;
    if (fa !== fb) return fb - fa;
    const ba = a.token?.block ?? -1n;
    const bb = b.token?.block ?? -1n;
    return ba > bb ? -1 : ba < bb ? 1 : 0;
  });
}

/**
 * The leaderboard: the most-followed accounts, with KIPS tokens attached where
 * a profile was tokenized, plus tokenized profiles outside the top list.
 */
export function mergeTop(top: XProfile[], tokenized: RankedProfile[]): RankedProfile[] {
  const byHandle = new Map<string, RankedProfile>();
  for (const p of top) byHandle.set(p.handle.toLowerCase(), { handle: p.handle, token: null, others: 0, profile: p });
  for (const t of tokenized) {
    const key = t.handle.toLowerCase();
    const seen = byHandle.get(key);
    byHandle.set(key, seen ? { ...seen, token: t.token, others: t.others } : t);
  }
  return rankByFollowers([...byHandle.values()]);
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
export async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
