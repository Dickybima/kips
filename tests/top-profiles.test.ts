import { describe, expect, it } from "vitest";
import { eachLimited, groupByHandle, mergeTop, rankByFollowers, type ProfileToken } from "../src/lib/kips/topProfiles";
import type { XProfile } from "../src/lib/kips/xprofile";

const tok = (n: number, twitter: string): ProfileToken => ({
  token: `0x${String(n).padStart(40, "0")}`,
  name: `T${n}`,
  symbol: `T${n}`,
  logo: "",
  twitter,
  block: BigInt(n),
});
const prof = (handle: string, followers: number): XProfile => ({
  handle, name: handle, bio: "", avatar: "", banner: "", followers, verified: false,
});

describe("top profiles", () => {
  it("keeps one row per handle, the earliest launch, and counts the rest", () => {
    const rows = groupByHandle([tok(5, "https://x.com/Jack"), tok(2, "https://x.com/jack"), tok(3, "https://x.com/other"), tok(4, "not a link")]);
    expect(rows.map((r) => [r.handle.toLowerCase(), r.token?.block, r.others])).toEqual([
      ["jack", 2n, 1],
      ["other", 3n, 0],
    ]);
  });
  it("ranks by followers, unknown counts last", () => {
    const rows = groupByHandle([tok(1, "x.com/a"), tok(2, "x.com/b"), tok(3, "x.com/c")]);
    rows[0].profile = prof("a", 10);
    rows[2].profile = prof("c", 5_000);
    expect(rankByFollowers(rows).map((r) => r.handle)).toEqual(["c", "a", "b"]);
  });
  it("merges the top accounts with KIPS tokens, one row per handle", () => {
    const tokenized = groupByHandle([tok(7, "https://x.com/Elonmusk"), tok(8, "https://x.com/smallacct")]);
    tokenized[1].profile = prof("smallacct", 900);
    const rows = mergeTop([prof("elonmusk", 240_000_000), prof("NASA", 92_000_000)], tokenized);
    expect(rows.map((r) => [r.handle, r.token?.block ?? null])).toEqual([
      ["elonmusk", 7n],
      ["NASA", null],
      ["smallacct", 8n],
    ]);
  });
  it("never runs more than the limit at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBe(3);
  });
});
