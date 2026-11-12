import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe, Search, XLogo } from "../components/Icons";
import { Corners, CopyButton, Leader, PageHead } from "../components/Ui";
import { safeUrl } from "../lib/kips/agent";
import { errMsg, fmt, pct, shortAddr } from "../lib/format";
import { publicClient } from "../lib/pons/chain";
import { graduationProgressBps } from "../lib/pons/quote";
import { readCardStats, scanAgents, type CardStats, type TokenMeta } from "../lib/pons/read";

interface Item {
  meta: TokenMeta;
  curve: `0x${string}`;
  block: bigint;
  stats: CardStats | null;
}

type Sort = "newest" | "oldest" | "name";

export function Explore() {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<bigint | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const started = useRef(false);
  const checkedBefore = useRef(0);

  // Only tokens launched through KIPS are listed: launches since KIPS went live
  // whose on-chain description carries a KIPS agent profile.
  const load = useCallback(async (from: bigint | undefined) => {
    setLoading(true);
    setError("");
    try {
      const to = from ?? (await publicClient.getBlockNumber());
      const base = checkedBefore.current;
      const { agents, next, checked: n } = await scanAgents(to, { onProgress: (c) => setChecked(base + c) });
      checkedBefore.current = base + n;
      const fresh: Item[] = agents.map((a) => ({ ...a, stats: null }));
      setItems((prev) => [...prev, ...fresh]);
      setCursor(next);
      // Progress and fees fill in after the cards are on screen.
      for (const it of fresh) {
        readCardStats(it.meta.token, it.curve).then(
          (stats) => setItems((prev) => prev.map((p) => (p.meta.token === it.meta.token ? { ...p, stats } : p))),
          () => {},
        );
      }
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;
    if (q) {
      list = list.filter(
        (i) =>
          i.meta.name.toLowerCase().includes(q) ||
          i.meta.symbol.toLowerCase().includes(q) ||
          i.meta.token.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sort === "oldest") sorted.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
    else if (sort === "name") sorted.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
    else sorted.sort((a, b) => (a.block > b.block ? -1 : a.block < b.block ? 1 : 0));
    return sorted;
  }, [items, query, sort]);

  const q = query.trim();

  return (
    <section className="wrap section">
      <PageHead n="04" label="Explore" title="Every agent launched with KIPS.">
        Only tokens created through KIPS appear here, straight from Robinhood Chain, the moment they go live.
      </PageHead>

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          const hit = items.find((i) => i.meta.token.toLowerCase() === q.toLowerCase());
          if (hit) location.hash = `#/agent/${hit.meta.token}`;
        }}
      >
        <label className="grep">
          <Search />
          <input placeholder="grep name, ticker, or contract…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="newest">--sort newest</option>
          <option value="oldest">--sort oldest</option>
          <option value="name">--sort name</option>
        </select>
      </form>

      <div className="seg-row">
        <span className="dot-label">
          <span className="accent">●</span> KIPS agents{items.length > 0 ? ` · ${items.length}` : ""}
        </span>
      </div>

      {error && <p className="note bad">Could not read launches from Robinhood Chain: {error}</p>}

      {shown.length > 0 && (
        <div className="card-grid">
          {shown.map((i) => (
            <TokenCard key={i.meta.token} item={i} />
          ))}
        </div>
      )}

      {!loading && !error && shown.length === 0 && (
        <div className="empty">
          <pre aria-hidden="true">{`   .-------.
  /  ? ? ?  \\
 |  [_____]  |
  \\_________/`}</pre>
          <p className="muted">
            {q
              ? "No KIPS agent matches that search."
              : cursor === null
                ? "No agents have been launched through KIPS yet. The first one will appear here."
                : "No KIPS agents in the launches checked so far."}
          </p>
          {!q && (
            <a className="btn btn-solid" href="#/agent">
              Launch the first one <ArrowRight />
            </a>
          )}
        </div>
      )}

      <div className="center">
        {loading ? (
          <span className="muted">checking launches for KIPS agents… {checked > 0 ? `(${checked})` : ""}</span>
        ) : cursor === null ? (
          <span className="muted">// every KIPS agent is listed</span>
        ) : cursor !== undefined ? (
          <button className="btn btn-ghost" onClick={() => void load(cursor)}>
            {error ? "Retry" : "Load older agents"}
          </button>
        ) : null}
      </div>
      <p className="center muted small">// every token launched through KIPS on Robinhood Chain</p>
    </section>
  );
}

export function Logo({ url, symbol }: { url: string; symbol: string }) {
  const [broken, setBroken] = useState(false);
  const src = safeUrl(url);
  if (!src || broken) return <div className="logo ph">{symbol.slice(0, 2).toUpperCase()}</div>;
  return <img className="logo" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function TokenCard({ item }: { item: Item }) {
  const { meta, stats } = item;
  const progress = stats ? graduationProgressBps(stats.raised, stats.graduationThreshold) : null;
  const x = safeUrl(meta.socials.twitter);
  const web = safeUrl(meta.socials.website);
  return (
    <Corners className="token-card" accent={!!meta.profile}>
      <div className="row">
        <Logo url={meta.logo} symbol={meta.symbol} />
        <div className="grow">
          <strong className="ellipsis">{meta.name}</strong>
          <div className="muted small">${meta.symbol}</div>
        </div>
        {meta.profile ? <span className="badge">{meta.profile.category}</span> : <span className="badge badge-dim">token</span>}
      </div>
      {meta.about && <p className="muted small clamp">{meta.about}</p>}
      <div className="leaders">
        <Leader k="contract">{shortAddr(meta.token)}</Leader>
        <Leader k="raised">{stats ? `${fmt(stats.raised)} / ${fmt(stats.graduationThreshold)} ETH` : "…"}</Leader>
        <Leader k="progress">{stats ? (stats.graduated ? "graduated" : pct(progress ?? 0)) : "…"}</Leader>
        <Leader k="creator fee">{stats ? pct(stats.creatorTaxBps) : "…"}</Leader>
        <Leader k="network">Robinhood Chain</Leader>
      </div>
      <div className="meter thin">
        <div style={{ width: `${(progress ?? 0) / 100}%` }} />
      </div>
      <div className="chip-row">
        {x && (
          <a className="chip" href={x} target="_blank" rel="noopener noreferrer">
            <XLogo width={13} height={13} /> X
          </a>
        )}
        {web && (
          <a className="chip" href={web} target="_blank" rel="noopener noreferrer">
            <Globe width={14} height={14} /> Website
          </a>
        )}
        <a className="chip chip-accent" href={`#/agent/${meta.token}`}>
          Trade <ArrowRight width={14} height={14} />
        </a>
        <CopyButton value={meta.token} label="Copy contract" />
      </div>
    </Corners>
  );
}
