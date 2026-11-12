import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, getAddress, numberToHex, type Address, type WalletClient } from "viem";
import { RPC_URL, robinhoodChain } from "./pons/chain";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

const provider = (): Eip1193 | undefined => (window as unknown as { ethereum?: Eip1193 }).ethereum;

interface WalletState {
  account: Address | null;
  hasProvider: boolean;
  connect(): Promise<void>;
  /** Returns a client on Robinhood Chain, prompting a network switch if needed. */
  getClient(): Promise<WalletClient>;
}

const Ctx = createContext<WalletState | null>(null);

async function ensureChain(p: Eip1193) {
  const chainId = numberToHex(robinhoodChain.id);
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    // 4902: the wallet does not know this chain yet.
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: robinhoodChain.name,
          nativeCurrency: robinhoodChain.nativeCurrency,
          rpcUrls: [RPC_URL],
        },
      ],
    });
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address | null>(null);
  const p = provider();

  useEffect(() => {
    if (!p) return;
    const onAccounts = (accounts: string[]) => setAccount(accounts[0] ? getAddress(accounts[0]) : null);
    // Restore a previously authorised session without prompting.
    p.request({ method: "eth_accounts" }).then((a) => onAccounts(a as string[]), () => {});
    p.on?.("accountsChanged", onAccounts as never);
    return () => p.removeListener?.("accountsChanged", onAccounts as never);
  }, [p]);

  const connect = useCallback(async () => {
    if (!p) throw new Error("No wallet found. Install a browser wallet to continue.");
    const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(accounts[0] ? getAddress(accounts[0]) : null);
    await ensureChain(p);
  }, [p]);

  const getClient = useCallback(async () => {
    if (!p || !account) throw new Error("Connect a wallet first.");
    await ensureChain(p);
    return createWalletClient({ account, chain: robinhoodChain, transport: custom(p) });
  }, [p, account]);

  const value = useMemo(() => ({ account, hasProvider: !!p, connect, getClient }), [account, p, connect, getClient]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}
