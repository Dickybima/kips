import { useEffect, useState } from "react";
import type { Address } from "viem";
import { fmt, pct, shortAddr } from "../lib/format";
import { explorerLink } from "../lib/pons/chain";
import { readBurnHistory, readBurned, type BurnStats, type BurnTx } from "../lib/pons/read";

const REFRESH_MS = 60_000;

/** Burned total for `token`, re-read every minute. Null until the first read. */
export function useBurned(token: Address): BurnStats | null {
  const [stats, setStats] = useState<BurnStats | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => readBurned(token).then((s) => live && setStats(s), () => undefined);
    void tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [token]);
  return stats;
}

/** One-line burn summary for a token card. */
export function BurnLine({ token, symbol }: { token: Address; symbol: string }) {
  const stats = useBurned(token);
  return (
    <div className="burn-line">
      <span className="burn-flame" aria-hidden>
        🔥
      </span>
      <span className="muted">burned</span>
      <strong>{stats ? `${fmt(stats.burned)} ${symbol}` : "…"}</strong>
      {stats && <span className="burn-pct">{pct(stats.bps)} of supply</span>}
    </div>
  );
}

const date = (t: number | null) =>
  t === null ? "" : new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Burn total, share of supply and every burn transaction, for a token page. */
export function BurnPanel({ token, symbol }: { token: Address; symbol: string }) {
  const stats = useBurned(token);
  const [history, setHistory] = useState<BurnTx[] | null>(null);
  useEffect(() => {
    let live = true;
    readBurnHistory(token).then((h) => live && setHistory(h), () => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [token]);

  const share = stats ? Math.min(Number(stats.bps) / 100, 100) : 0;
  return (
    <div className="burn">
      <div className="burn-head">
        <h3>
          <span aria-hidden>🔥</span> burn
        </h3>
        <span className="muted small">Bought supply is burned for good.</span>
      </div>
      <div className="burn-total">
        <strong>{stats ? fmt(stats.burned) : "…"}</strong>
        <span>{symbol} burned</span>
      </div>
      <div className="meter burn-meter" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${Math.max(share, stats && stats.burned > 0n ? 0.6 : 0)}%` }} />
      </div>
      <p className="muted small">{stats ? `${pct(stats.bps)} of the 1B supply` : "Reading Robinhood Chain…"}</p>
      <ul className="burn-list">
        {history === null ? (
          <li className="muted small">Loading burns…</li>
        ) : history.length === 0 ? (
          <li className="muted small">No burn transactions yet.</li>
        ) : (
          history.map((b) => {
            const link = explorerLink("tx", b.hash);
            return (
              <li key={b.hash}>
                <span>
                  🔥 {fmt(b.amount)} {symbol}
                </span>
                <span className="muted small">{date(b.timestamp)}</span>
                {link ? (
                  <a className="small" href={link} target="_blank" rel="noopener noreferrer">
                    {shortAddr(b.hash)} ↗
                  </a>
                ) : (
                  <code className="small" title={b.hash}>
                    {shortAddr(b.hash)}
                  </code>
                )}
              </li>
            );
          })
        )}
      </ul>
      <p className="muted small">Sent to 0x…dEaD, where no one holds the key.</p>
    </div>
  );
}
