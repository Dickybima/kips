import { useChainStats } from "../lib/chainStats";
import { fmt } from "../lib/format";

export function Ticker() {
  const { block, gasWei, env, online } = useChainStats();
  const items: [string, string][] = [
    ["Network", "Robinhood Chain"],
    ["Chain ID", "4663"],
    ["Block", block !== null ? `#${block.toLocaleString("en-US")}` : "…"],
    ["Gas", gasWei !== null ? `${(Number(gasWei) / 1e9).toFixed(3)} gwei` : "…"],
    ["Launch fee", env ? `${fmt(env.launchFee)} ETH` : "…"],
    ["Graduates at", env?.configs[0] ? `${fmt(env.configs[0].graduationThreshold)} ETH` : "…"],
  ];
  const row = (hidden: boolean) => (
    <div className="ticker-row" aria-hidden={hidden || undefined}>
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="ticker-k">{k}</span> <span className="ticker-v">{v}</span>
          <span className="ticker-sep">//</span>
        </span>
      ))}
      <span>
        <span className="ticker-v">Describe it. Ship it.</span>
        <span className="ticker-sep">//</span>
      </span>
    </div>
  );
  return (
    <div className="ticker">
      <span className={online ? "live" : "live off"}>{online ? "Live" : "Offline"}</span>
      <div className="ticker-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
