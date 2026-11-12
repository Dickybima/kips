import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress } from "viem";
import { safeUrl } from "../lib/kips/agent";
import { errMsg, shortAddr } from "../lib/format";
import { publicClient } from "../lib/pons/chain";
import { readTokenMeta, scanLaunches, type TokenMeta } from "../lib/pons/read";

export function Explore() {
  const [items, setItems] = useState<TokenMeta[]>([]);
  const [cursor, setCursor] = useState<bigint | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agentsOnly, setAgentsOnly] = useState(true);
  const [lookup, setLookup] = useState("");
  const started = useRef(false);

  const load = useCallback(async (from: bigint | undefined) => {
    setLoading(true);
    setError("");
    try {
      const to = from ?? (await publicClient.getBlockNumber());
      const { logs, next } = await scanLaunches(to);
      // A token whose metadata cannot be read is skipped rather than failing the page.
      const metas = await Promise.all(logs.map((l) => readTokenMeta(l.token).catch(() => null)));
      setItems((prev) => [...prev, ...metas.filter((m): m is TokenMeta => m !== null)]);
      setCursor(next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(undefined);
  }, [load]);

  const shown = agentsOnly ? items.filter((i) => i.profile) : items;
  const lookupOk = isAddress(lookup.trim());

  return (
    <>
      <section className="hero">
        <h1>Launch an AI agent with its own token.</h1>
        <p>
          Every kips agent is a Pons v2 token: a fixed supply sold on a bonding curve, graduating to a Uniswap v4 pool.
          The agent's wallet earns the creator fees.
        </p>
        <a className="btn primary" href="#/launch">
          Launch an agent
        </a>
      </section>

      <div className="bar">
        <div className="seg">
          <button className={agentsOnly ? "on" : ""} onClick={() => setAgentsOnly(true)}>
            kips agents
          </button>
          <button className={!agentsOnly ? "on" : ""} onClick={() => setAgentsOnly(false)}>
            All Pons v2 launches
          </button>
        </div>
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookupOk) location.hash = `#/agent/${lookup.trim()}`;
          }}
        >
          <input placeholder="Open by token address 0x…" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button className="btn" disabled={!lookupOk}>
            Open
          </button>
        </form>
      </div>

      {error && <p className="note bad">Could not read launches from the chain: {error}</p>}

      <div className="grid">
        {shown.map((m) => (
          <AgentCard key={m.token} meta={m} />
        ))}
      </div>

      {!loading && !error && shown.length === 0 && (
        <p className="note">
          {agentsOnly
            ? `No kips agents among the ${items.length} most recent Pons v2 launches scanned so far.`
            : "No launches found in the scanned range."}
        </p>
      )}

      <div className="center">
        {loading ? (
          <span className="muted">Scanning launches…</span>
        ) : cursor === null ? (
          <span className="muted">Scanned back to the Pons v2 deployment.</span>
        ) : (
          <button className="btn" onClick={() => void load(cursor)}>
            {error ? "Retry" : "Scan older launches"}
          </button>
        )}
      </div>
    </>
  );
}

export function Logo({ url, symbol }: { url: string; symbol: string }) {
  const [broken, setBroken] = useState(false);
  const src = safeUrl(url);
  if (!src || broken) return <div className="logo ph">{symbol.slice(0, 2).toUpperCase()}</div>;
  return <img className="logo" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function AgentCard({ meta }: { meta: TokenMeta }) {
  return (
    <a className="card" href={`#/agent/${meta.token}`}>
      <div className="row">
        <Logo url={meta.logo} symbol={meta.symbol} />
        <div className="grow">
          <strong>{meta.name}</strong>
          <div className="muted">
            ${meta.symbol} · {shortAddr(meta.token)}
          </div>
        </div>
        {meta.profile && <span className="tag accent">{meta.profile.category}</span>}
      </div>
      <p className="clamp">{meta.about || "No description."}</p>
      {meta.profile && meta.profile.skills.length > 0 && (
        <div className="tags">
          {meta.profile.skills.map((s) => (
            <span className="tag" key={s}>
              {s}
            </span>
          ))}
        </div>
      )}
    </a>
  );
}
