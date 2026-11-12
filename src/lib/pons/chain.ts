import { createPublicClient, defineChain, http, zeroAddress, type Address } from "viem";

const env = import.meta.env ?? {};

export const RPC_URL: string = env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER_URL: string = (env.VITE_EXPLORER_URL || "").replace(/\/$/, "");

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  // Deployed at the canonical address on Robinhood Chain; lets many reads share one call.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  ...(EXPLORER_URL
    ? { blockExplorers: { default: { name: "Explorer", url: EXPLORER_URL } } }
    : {}),
});

/** Pons v2 deployment on Robinhood Chain mainnet (verified by simulation against the live chain). */
export const PONS = {
  factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  launchAndBuyRouter: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948",
  memeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
  feeEscrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
  buybackVault: "0x42df2a798f82289E177311362e8f5ccC45c1219c",
  launchLocker: "0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952",
} as const satisfies Record<string, Address>;

/** First block with factory code; log scans never go below this. */
export const FACTORY_DEPLOY_BLOCK = 57_412_596n;

/**
 * KIPS went live after this block, so no KIPS agent can be older. Explore only
 * scans launches from here on instead of the protocol's whole history.
 */
export const KIPS_START_BLOCK = 112_000_000n;

/** Pons uses the zero address as the pair token for native ETH curves. */
export const NATIVE_QUOTE: Address = zeroAddress;

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  // Contract reads made together are folded into Multicall3 calls, and the
  // remaining requests go out in small JSON-RPC batches (the public RPC
  // rejects very large ones).
  batch: { multicall: { batchSize: 8_192, wait: 16 } },
  transport: http(RPC_URL, { batch: { batchSize: 40, wait: 16 }, retryCount: 2 }),
});

export function explorerLink(kind: "tx" | "address", value: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/${kind}/${value}` : null;
}
