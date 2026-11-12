import { useState } from "react";
import { Corners, CopyButton, Leader, PageHead } from "../components/Ui";
import { useChainStats } from "../lib/chainStats";
import { errMsg, fmt, pct } from "../lib/format";
import { PONS, RPC_URL, explorerLink } from "../lib/pons/chain";
import { useWallet } from "../lib/wallet";

const CONTRACTS: [string, string][] = [
  ["Launch factory", PONS.factory],
  ["Launch + buy router", PONS.launchAndBuyRouter],
  ["Pool hook", PONS.memeHook],
  ["Fee escrow", PONS.feeEscrow],
  ["Buyback vault", PONS.buybackVault],
  ["Liquidity locker", PONS.launchLocker],
];

export function Network() {
  const { block, gasWei, env, online } = useChainStats();
  const { addNetwork } = useWallet();
  const [msg, setMsg] = useState("");
  const cfg = env?.configs[0];

  return (
    <section className="wrap section">
      <PageHead n="05" label="Network" title="Built on Robinhood Chain.">
        KIPS reads and writes Robinhood Chain directly from your browser. These numbers are live.
      </PageHead>

      <div className="net-grid">
        <Corners className="net-card">
          <h3>Chain</h3>
          <Leader k="status">
            <span className={online ? "accent" : "bad"}>{online ? "● online" : "● unreachable"}</span>
          </Leader>
          <Leader k="chain id">4663</Leader>
          <Leader k="block">{block !== null ? `#${block.toLocaleString("en-US")}` : "…"}</Leader>
          <Leader k="gas price">{gasWei !== null ? `${(Number(gasWei) / 1e9).toFixed(4)} gwei` : "…"}</Leader>
          <Leader k="currency">ETH</Leader>
          <Leader k="rpc">{RPC_URL.replace(/^https:\/\//, "")}</Leader>
          <div className="chip-row">
            <button
              className="chip chip-accent"
              onClick={() =>
                addNetwork().then(
                  () => setMsg("Robinhood Chain is set up in your wallet."),
                  (e) => setMsg(errMsg(e)),
                )
              }
            >
              Add to wallet
            </button>
            <CopyButton value={RPC_URL} label="Copy RPC" />
          </div>
          {msg && <p className="muted small">{msg}</p>}
        </Corners>

        <Corners className="net-card">
          <h3>Launch terms</h3>
          <Leader k="launches">{env ? (env.launchEnabled ? "open" : "paused") : "…"}</Leader>
          <Leader k="launch fee">{env ? `${fmt(env.launchFee)} ETH` : "…"}</Leader>
          <Leader k="supply">{cfg ? fmt(cfg.supply) : "…"}</Leader>
          <Leader k="curve fee">{cfg ? pct(cfg.curveFeeBps) : "…"}</Leader>
          <Leader k="graduates at">{cfg ? `${fmt(cfg.graduationThreshold)} ETH` : "…"}</Leader>
          <Leader k="max creator fee">{env ? pct(env.maxCreatorTaxBps) : "…"}</Leader>
          <Leader k="after graduation">Uniswap v4 pool</Leader>
        </Corners>
      </div>

      <h2 className="sub-h">Contracts</h2>
      <ol className="index">
        {CONTRACTS.map(([name, addr], i) => {
          const url = explorerLink("address", addr);
          return (
            <li key={addr}>
              <div className="index-row">
                <span className="muted">{String(i + 1).padStart(2, "0")}</span>
                <strong>{name}</strong>
                <code className="muted addr">{addr}</code>
                <span className="chip-row tight">
                  {url && (
                    <a className="chip" href={url} target="_blank" rel="noopener noreferrer">
                      View
                    </a>
                  )}
                  <CopyButton value={addr} />
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
