import { useEffect, useState } from "react";
import { publicClient } from "./pons/chain";
import { readLaunchEnv, type LaunchEnv } from "./pons/read";

export interface ChainStats {
  block: bigint | null;
  gasWei: bigint | null;
  env: LaunchEnv | null;
  online: boolean;
}

// One poller shared by every component that shows live chain data.
let state: ChainStats = { block: null, gasWei: null, env: null, online: true };
const subs = new Set<(s: ChainStats) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const BLOCK_MS = 4000;

function set(patch: Partial<ChainStats>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f(state));
}

async function poll() {
  try {
    const [block, gasWei] = await Promise.all([publicClient.getBlockNumber(), publicClient.getGasPrice()]);
    set({ block, gasWei, online: true });
  } catch {
    set({ online: false });
  }
}

async function loadEnv() {
  try {
    set({ env: await readLaunchEnv(null) });
  } catch {
    // Shown as "…" until the next mount retries.
  }
}

export function useChainStats(): ChainStats {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    if (!timer) {
      void poll();
      if (!state.env) void loadEnv();
      timer = setInterval(poll, BLOCK_MS);
    }
    return () => {
      subs.delete(setS);
      if (subs.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return s;
}
