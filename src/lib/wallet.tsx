import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, getAddress, numberToHex, type Address, type WalletClient } from "viem";
import { errMsg, shortAddr } from "./format";
import { RPC_URL, robinhoodChain } from "./pons/chain";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

export interface WalletOption {
  id: string;
  name: string;
  /** Icon supplied by the wallet itself; only image data URIs are kept. */
  icon: string | null;
  provider: Eip1193;
}

interface WalletState {
  account: Address | null;
  /** Name of the connected wallet, when one is connected. */
  walletName: string | null;
  /** Wallets detected in this browser. */
  wallets: WalletOption[];
  /** Opens the wallet picker. */
  connect(): Promise<void>;
  connectWith(id: string): Promise<void>;
  disconnect(): void;
  /** Returns a client on Robinhood Chain, prompting a network switch if needed. */
  getClient(): Promise<WalletClient>;
}

const Ctx = createContext<WalletState | null>(null);
const REMEMBER_KEY = "kips.wallet";

const INSTALL = [
  ["MetaMask", "https://metamask.io/download/"],
  ["Rabby", "https://rabby.io/"],
  ["Coinbase Wallet", "https://www.coinbase.com/wallet/downloads"],
] as const;

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(REMEMBER_KEY, id);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Storage can be unavailable (private mode); reconnecting is only a convenience.
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

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

interface Announce {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider?: Eip1193;
}

/** Discovers installed wallets through EIP-6963, falling back to window.ethereum. */
function useWalletOptions(): WalletOption[] {
  const [found, setFound] = useState<WalletOption[]>([]);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as CustomEvent<Announce>).detail ?? {};
      const id = info?.rdns || info?.uuid;
      if (!id || !provider || typeof info?.name !== "string") return;
      const icon = typeof info.icon === "string" && info.icon.startsWith("data:image/") ? info.icon : null;
      const name = info.name.slice(0, 40);
      setFound((prev) => (prev.some((w) => w.id === id) ? prev : [...prev, { id, name, icon, provider }]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  return useMemo(() => {
    if (found.length > 0) return found;
    const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    return legacy ? [{ id: "injected", name: "Browser wallet", icon: null, provider: legacy }] : [];
  }, [found]);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useWalletOptions();
  const [active, setActive] = useState<WalletOption | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const triedRestore = useRef(false);

  // Restore the wallet used last time, without prompting.
  useEffect(() => {
    if (active || triedRestore.current) return;
    const last = wallets.find((w) => w.id === remembered());
    if (!last) return;
    triedRestore.current = true;
    last.provider.request({ method: "eth_accounts" }).then(
      (a) => {
        const first = (a as string[])[0];
        if (!first) return;
        setActive(last);
        setAccount(getAddress(first));
      },
      () => {},
    );
  }, [wallets, active]);

  useEffect(() => {
    const p = active?.provider;
    if (!p) return;
    const onAccounts = (accounts: string[]) => {
      if (accounts[0]) return setAccount(getAddress(accounts[0]));
      // The wallet revoked access from its own UI.
      setAccount(null);
      setActive(null);
      remember(null);
    };
    p.on?.("accountsChanged", onAccounts as never);
    return () => p.removeListener?.("accountsChanged", onAccounts as never);
  }, [active]);

  const connectWith = useCallback(
    async (id: string) => {
      const wallet = wallets.find((w) => w.id === id);
      if (!wallet) throw new Error("That wallet is not available in this browser.");
      const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("The wallet returned no account.");
      setActive(wallet);
      setAccount(getAddress(accounts[0]));
      remember(wallet.id);
      // Staying connected matters more than the network switch; any
      // transaction asks for the switch again through getClient.
      await ensureChain(wallet.provider).catch(() => {});
    },
    [wallets],
  );

  const disconnect = useCallback(() => {
    // Best effort: not every wallet supports revoking, so the app also forgets it locally.
    active?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
    setAccount(null);
    setActive(null);
    remember(null);
  }, [active]);

  const connect = useCallback(async () => {
    setError("");
    setCopied(false);
    setOpen(true);
  }, []);

  const getClient = useCallback(async () => {
    if (!active || !account) throw new Error("Connect a wallet first.");
    await ensureChain(active.provider);
    return createWalletClient({ account, chain: robinhoodChain, transport: custom(active.provider) });
  }, [active, account]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function pick(id: string) {
    setError("");
    setPending(id);
    try {
      await connectWith(id);
      setOpen(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(null);
    }
  }

  const value = useMemo(
    () => ({ account, walletName: active?.name ?? null, wallets, connect, connectWith, disconnect, getClient }),
    [account, active, wallets, connect, connectWith, disconnect, getClient],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Wallet" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 className="grow">{account ? "Wallet" : "Connect a wallet"}</h2>
              <button className="link" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            {account && (
              <div className="note">
                <div className="muted">Connected with {active?.name}</div>
                <code>{account}</code>
                <div className="row modal-actions">
                  <button
                    className="btn"
                    onClick={() => navigator.clipboard?.writeText(account).then(() => setCopied(true), () => {})}
                  >
                    {copied ? "Copied" : "Copy address"}
                  </button>
                  <button className="btn" onClick={disconnect}>
                    Disconnect
                  </button>
                </div>
              </div>
            )}

            {wallets.length > 0 ? (
              <>
                {account && <h3>Switch wallet</h3>}
                <ul className="wallets">
                  {wallets.map((w) => (
                    <li key={w.id}>
                      <button onClick={() => void pick(w.id)} disabled={pending !== null}>
                        {w.icon ? <img src={w.icon} alt="" /> : <span className="wallet-ph">{w.name.slice(0, 1)}</span>}
                        <span className="grow">{w.name}</span>
                        <span className="muted">
                          {pending === w.id ? "Check your wallet…" : active?.id === w.id && account ? shortAddr(account) : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="muted">No wallet was found in this browser. Install one, then reload this page:</p>
                <ul className="wallets">
                  {INSTALL.map(([name, url]) => (
                    <li key={name}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <span className="wallet-ph">{name.slice(0, 1)}</span>
                        <span className="grow">{name}</span>
                        <span className="muted">Install ↗</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error && <p className="note bad">{error}</p>}
            <p className="muted small">KIPS runs on Robinhood Chain. Your wallet will ask to switch network.</p>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
}
