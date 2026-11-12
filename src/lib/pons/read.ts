import type { Address } from "viem";
import { curveAbi, factoryAbi, tokenAbi } from "./abi";
import { FACTORY_DEPLOY_BLOCK, NATIVE_QUOTE, PONS, publicClient } from "./chain";
import { decodeDescription, type AgentProfile } from "../kips/agent";

const factory = { address: PONS.factory, abi: factoryAbi } as const;

export interface LaunchConfig {
  id: bigint;
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
}

export interface LaunchEnv {
  launchEnabled: boolean;
  /** Whether this wallet may launch right now (Pons can gate launches by allowlist). */
  canLaunch: boolean | null;
  nativeApproved: boolean;
  launchFee: bigint;
  maxCreatorTaxBps: bigint;
  configs: LaunchConfig[];
}

export async function readLaunchEnv(account: Address | null): Promise<LaunchEnv> {
  const [launchEnabled, launchFee, maxCreatorTaxBps, count, nativeApproved, canLaunch] = await Promise.all([
    publicClient.readContract({ ...factory, functionName: "launchEnabled" }),
    publicClient.readContract({ ...factory, functionName: "launchFee" }),
    publicClient.readContract({ ...factory, functionName: "maxCreatorTaxBps" }),
    publicClient.readContract({ ...factory, functionName: "launchConfigCount" }),
    publicClient.readContract({ ...factory, functionName: "approvedPairTokens", args: [NATIVE_QUOTE] }),
    account ? publicClient.readContract({ ...factory, functionName: "canLaunch", args: [account] }) : null,
  ]);
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const raw = await Promise.all(
    ids.map((id) => publicClient.readContract({ ...factory, functionName: "getLaunchConfig", args: [id] })),
  );
  const configs = raw
    .map((c, i) => ({ id: ids[i], ...c }))
    .filter((c) => c.enabled)
    .map(({ id, supply, curveFeeBps, phantomQuote, graduationThreshold }) => ({
      id,
      supply,
      curveFeeBps,
      phantomQuote,
      graduationThreshold,
    }));
  return { launchEnabled, canLaunch, nativeApproved, launchFee, maxCreatorTaxBps, configs };
}

export interface TokenMeta {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  about: string;
  profile: AgentProfile | null;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
}

export async function readTokenMeta(token: Address): Promise<TokenMeta> {
  const t = { address: token, abi: tokenAbi } as const;
  const [name, symbol, info] = await Promise.all([
    publicClient.readContract({ ...t, functionName: "name" }),
    publicClient.readContract({ ...t, functionName: "symbol" }),
    publicClient.readContract({ ...t, functionName: "getTokenInfo" }),
  ]);
  const [, logo, description, socials] = info;
  return { token, name, symbol, logo, ...decodeDescription(description), socials };
}

export interface CurveState {
  quoteReserve: bigint;
  tokenReserve: bigint;
  realQuoteReserve: bigint;
  sellable: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeTaxBps: bigint;
  graduated: boolean;
  readyToGraduate: boolean;
}

/** Placeholder recipient for snipe-tax reads when no wallet is connected. */
const NO_WALLET: Address = "0x000000000000000000000000000000000000dEaD";

export async function readCurveState(curve: Address, account: Address | null): Promise<CurveState> {
  const c = { address: curve, abi: curveAbi } as const;
  const [reserves, realQuoteReserve, sellable, feeBps, creatorTaxBps, snipeTaxBps, graduated, readyToGraduate] =
    await Promise.all([
      publicClient.readContract({ ...c, functionName: "getReserves" }),
      publicClient.readContract({ ...c, functionName: "realQuoteReserve" }),
      publicClient.readContract({ ...c, functionName: "sellableTokens" }),
      publicClient.readContract({ ...c, functionName: "feeBps" }),
      publicClient.readContract({ ...c, functionName: "creatorTaxBps" }),
      publicClient.readContract({ ...c, functionName: "currentSnipeTaxBps", args: [account ?? NO_WALLET] }),
      publicClient.readContract({ ...c, functionName: "graduated" }),
      publicClient.readContract({ ...c, functionName: "readyToGraduate" }),
    ]);
  return {
    quoteReserve: reserves[0],
    tokenReserve: reserves[1],
    realQuoteReserve,
    sellable,
    feeBps,
    creatorTaxBps,
    snipeTaxBps,
    graduated,
    readyToGraduate,
  };
}

export interface Launched {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  /** 0 = on the bonding curve; anything else means graduation has started. */
  phase: number;
}

/** Returns null when the address is not a Pons v2 launch. */
export async function readLaunched(token: Address): Promise<Launched | null> {
  const l = await publicClient.readContract({ ...factory, functionName: "getLaunchedToken", args: [token] });
  if (!l.exists) return null;
  return l;
}

export async function readBalances(token: Address, account: Address) {
  const [eth, tokens, supply] = await Promise.all([
    publicClient.getBalance({ address: account }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" }),
  ]);
  return { eth, tokens, supply };
}

export interface LaunchLog {
  token: Address;
  curve: Address;
  deployer: Address;
  blockNumber: bigint;
}

const MIN_CHUNK = 5_000n;

/**
 * Walks TokenLaunched logs backwards from `toBlock`, newest first. RPC nodes
 * cap log ranges differently, so the window halves on failure. Returns the
 * next cursor, or null once the factory's deployment block has been reached.
 */
export async function scanLaunches(
  toBlock: bigint,
  opts: { want?: number; maxRequests?: number; chunk?: bigint } = {},
): Promise<{ logs: LaunchLog[]; next: bigint | null }> {
  const want = opts.want ?? 24;
  // Robinhood Chain blocks are fast and launches are frequent; the window
  // adapts to how dense the launches turn out to be.
  let chunk = opts.chunk ?? 200_000n;
  let requests = opts.maxRequests ?? 10;
  let to = toBlock;
  const out: LaunchLog[] = [];

  while (to >= FACTORY_DEPLOY_BLOCK && out.length < want && requests > 0) {
    const from = to - chunk + 1n > FACTORY_DEPLOY_BLOCK ? to - chunk + 1n : FACTORY_DEPLOY_BLOCK;
    let logs;
    try {
      logs = await publicClient.getContractEvents({
        ...factory,
        eventName: "TokenLaunched",
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
    } catch (e) {
      if (chunk <= MIN_CHUNK) throw e;
      chunk = chunk / 2n > MIN_CHUNK ? chunk / 2n : MIN_CHUNK;
      continue;
    }
    requests--;
    for (const l of logs.reverse()) {
      out.push({ token: l.args.token, curve: l.args.curve, deployer: l.args.deployer, blockNumber: l.blockNumber });
    }
    to = from - 1n;
    if (logs.length > want * 2) chunk = chunk / 4n > MIN_CHUNK ? chunk / 4n : MIN_CHUNK;
    else if (logs.length < want / 4) chunk = chunk * 4n < 8_000_000n ? chunk * 4n : 8_000_000n;
  }

  if (out.length > want) {
    // Cut at a block boundary so no launch is skipped: everything in the
    // last kept block stays, and the next page resumes just below it.
    const edge = out[want - 1].blockNumber;
    const kept = out.filter((l) => l.blockNumber >= edge);
    return { logs: kept, next: edge - 1n >= FACTORY_DEPLOY_BLOCK ? edge - 1n : null };
  }
  return { logs: out, next: to >= FACTORY_DEPLOY_BLOCK ? to : null };
}

export interface CardStats {
  creatorTaxBps: number;
  graduationThreshold: bigint;
  raised: bigint;
  graduated: boolean;
  creatorFeeRecipient: Address;
}

/** Light read for explore cards: progress toward graduation and the creator fee. */
export async function readCardStats(token: Address, curve: Address): Promise<CardStats> {
  const [l, raised] = await Promise.all([
    publicClient.readContract({ ...factory, functionName: "getLaunchedToken", args: [token] }),
    publicClient.readContract({ address: curve, abi: curveAbi, functionName: "realQuoteReserve" }).catch(() => 0n),
  ]);
  return {
    creatorTaxBps: l.creatorTaxBps,
    graduationThreshold: l.graduationThreshold,
    raised,
    graduated: l.phase !== 0,
    creatorFeeRecipient: l.creatorFeeRecipient,
  };
}
