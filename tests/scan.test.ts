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
