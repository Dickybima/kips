import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake chain: one launch every `gap` blocks between the deployment block and the head.
const DEPLOY = 57_412_596n;
const HEAD = DEPLOY + 1_000_000n;
let gap = 1000n;
let calls: [bigint, bigint][] = [];

vi.mock("../src/lib/pons/chain", async (orig) => {
  const real = await orig<typeof import("../src/lib/pons/chain")>();
  return {
    ...real,
    publicClient: {
      getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([fromBlock, toBlock]);
        const logs = [];
        const first = ((fromBlock - DEPLOY + gap - 1n) / gap) * gap + DEPLOY;
        for (let b = first; b <= toBlock; b += gap) {
          const id = b.toString(16).padStart(40, "0");
          // two launches share each block, to exercise block-boundary cuts
          for (const k of ["a", "b"]) {
            logs.push({ blockNumber: b, args: { token: `0x${k}${id.slice(1)}`, curve: `0x${id}`, deployer: `0x${id}` } });
          }
        }
        return logs;
      },
    },
  };
});

const { scanLaunches } = await import("../src/lib/pons/read");

describe("scanLaunches", () => {
  beforeEach(() => {
    calls = [];
    gap = 1000n;
  });

  it("returns about `want` launches, newest first, cut at a block boundary", async () => {
    const { logs, next } = await scanLaunches(HEAD, { want: 5 });
    expect(logs.length).toBe(6); // 5 requested, the 5th's block-mate is kept
    expect(logs[0].blockNumber).toBeGreaterThanOrEqual(logs.at(-1)!.blockNumber);
    expect(next).toBe(logs.at(-1)!.blockNumber - 1n);
  });

  it("pages without skipping or repeating launches", async () => {
    const seen = new Set<string>();
    let cursor: bigint | null = HEAD;
    let pages = 0;
    while (cursor !== null && pages < 200) {
      const { logs, next }: { logs: { token: string }[]; next: bigint | null } = await scanLaunches(cursor, { want: 24 });
      for (const l of logs) {
        expect(seen.has(l.token)).toBe(false);
        seen.add(l.token);
      }
      cursor = next;
      pages++;
    }
    expect(cursor).toBeNull();
    expect(seen.size).toBe(Number((HEAD - DEPLOY) / gap + 1n) * 2);
  });

  it("widens the window when launches are sparse", async () => {
    gap = 300_000n;
    const { logs } = await scanLaunches(HEAD, { want: 24 });
    expect(logs.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});

const { scanAgents } = await import("../src/lib/pons/read");

describe("scanAgents", () => {
  beforeEach(() => {
    calls = [];
    gap = 1000n;
  });

  // Every launch whose address starts with 0xa is a KIPS agent; 0xb tokens are plain launches.
  const readMeta = async (token: `0x${string}`) => ({
    token,
    name: token,
    symbol: "T",
    logo: "",
    about: "",
    profile: token.startsWith("0xa") ? { category: "other" as const, skills: [], endpoint: "" } : null,
    socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
  });

  it("keeps only tokens with a KIPS profile", async () => {
    const { agents } = await scanAgents(HEAD, { want: 5, floor: DEPLOY, readMeta });
    expect(agents.length).toBeGreaterThanOrEqual(5);
    expect(agents.every((a) => a.meta.token.startsWith("0xa"))).toBe(true);
  });

  it("never looks below the KIPS start block", async () => {
    const floor = HEAD - 50_000n;
    const { agents, next } = await scanAgents(HEAD, { want: 1000, floor, readMeta });
    expect(next).toBeNull();
    expect(agents.length).toBe(Number((HEAD - floor) / gap) + 1);
    expect(calls.every(([from]) => from >= floor)).toBe(true);
  });

  it("stops after checking maxLaunches when agents are rare", async () => {
    const none = async (token: `0x${string}`) => ({ ...(await readMeta(token)), profile: null });
    const { agents, next, checked } = await scanAgents(HEAD, { want: 5, floor: DEPLOY, readMeta: none, maxLaunches: 100 });
    expect(agents).toHaveLength(0);
    expect(checked).toBeGreaterThanOrEqual(100);
    expect(checked).toBeLessThan(200);
    expect(next).not.toBeNull();
  });
});

describe("hidden tokens", () => {
  it("are left out of the agent scan", async () => {
    const { isHidden } = await import("../src/lib/kips/hidden");
    expect(isHidden("0x88b8824c22776f8fcef5993cdec13693a0cbf34a")).toBe(true);
    expect(isHidden("0x0000000000000000000000000000000000000001")).toBe(false);
  });
});
