import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe, Search, XLogo } from "../components/Icons";
import { Corners, CopyButton, Label, Leader, PageHead } from "../components/Ui";
import { BurnLine } from "../components/Burn";
import { safeUrl } from "../lib/kips/agent";
import { OFFICIAL_TOKEN, isOfficial } from "../lib/kips/official";
import { errMsg, fmt, pct, shortAddr } from "../lib/format";
import { publicClient } from "../lib/pons/chain";
import { graduationProgressBps } from "../lib/pons/quote";
import { readCardStats, readLaunched, readTokenMeta, scanAgents, type CardStats, type TokenMeta } from "../lib/pons/read";

interface Item {
  meta: TokenMeta;
  curve: `0x${string}`;
  block: bigint;
  stats: CardStats | null;
}

type Sort = "newest" | "oldest" | "name";

/** How many agents the Home preview shows before linking to the full page. */
const PREVIEW_COUNT = 6;
/** How often Explore checks the chain for newly launched agents. */
const LIVE_REFRESH_MS = 20_000;

/**
 * Lists KIPS agents. As a page it has search, sorting and paging; with
 * `preview` it is the Home section: the newest agents and a link to Explore.
 */
export function Explore({ preview = false }: { preview?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [official, setOfficial] = useState<Item | null>(null);
  const [cursor, setCursor] = useState<bigint | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const started = useRef(false);
  /** Highest block already scanned; new launches above it are picked up live. */
  const newestScanned = useRef<bigint | null>(null);
  const checkedBefore = useRef(0);

  // Only tokens launched through KIPS are listed: launches since KIPS went live
  // whose on-chain description carries a KIPS agent profile.
  // Each agent appears as soon as it is found; progress and fees fill in after.
  const addAgent = useCallback((a: { meta: TokenMeta; curve: `0x${string}`; block: bigint }) => {
    if (isOfficial(a.meta.token)) return; // shown in its own section
    setItems((prev) => (prev.some((p) => p.meta.token === a.meta.token) ? prev : [...prev, { ...a, stats: null }]));
    readCardStats(a.meta.token, a.curve).then(
      (stats) => setItems((prev) => prev.map((p) => (p.meta.token === a.meta.token ? { ...p, stats } : p))),
      () => {},
    );
  }, []);

  const load = useCallback(async (from: bigint | undefined) => {
    setLoading(true);
    setError("");
    try {
      const to = from ?? (await publicClient.getBlockNumber());
      if (from === undefined) newestScanned.current = to;
      const base = checkedBefore.current;
      const { next, checked: n } = await scanAgents(to, {
        onProgress: (c) => setChecked(base + c),
        onFound: addAgent,
      });
      checkedBefore.current = base + n;
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
    // The official token is read directly; it does not need the scan.
    (async () => {
      const [meta, launched] = await Promise.all([readTokenMeta(OFFICIAL_TOKEN), readLaunched(OFFICIAL_TOKEN)]);
      if (!launched) return;
      setOfficial({ meta, curve: launched.curve, block: 0n, stats: null });
      const stats = await readCardStats(OFFICIAL_TOKEN, launched.curve);
      setOfficial((o) => (o ? { ...o, stats } : o));
    })().catch(() => {});
  }, [load]);

  // Pick up agents launched while the page is open, without a reload.
  useEffect(() => {
    let running = false;
    const id = setInterval(async () => {
      const from = newestScanned.current;
      if (running || from === null) return;
      running = true;
      try {
        const head = await publicClient.getBlockNumber();
        if (head > from) {
          await scanAgents(head, { floor: from + 1n, onFound: addAgent });
          newestScanned.current = head;
        }
      } catch {
        // try again on the next tick
      } finally {
        running = false;
      }
    }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [addAgent]);

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
  const cards = preview ? shown.slice(0, PREVIEW_COUNT) : shown;

  return (
    <section className="wrap section">
      {preview ? (
        <div className="preview-head">
          <div>
            <Label n="00">Explore</Label>
            <h2>Latest agents on KIPS.</h2>
            <p className="prompt-line">
              <span className="accent">$</span> ls ~/kips/agents --sort newest
            </p>
          </div>
          <a className="btn btn-ghost" href="#/explore">
            Explore all agents <ArrowRight />
          </a>
        </div>
      ) : (
        <PageHead n="04" label="Explore" title="Every agent launched with KIPS.">
          Only tokens created through KIPS appear here, straight from Robinhood Chain, the moment they go live.
        </PageHead>
      )}

      {!preview && (
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
      )}

      {!preview && !official && (
        <div className="seg-row">
          <span className="dot-label">
            <span className="accent">●</span> KIPS agents{items.length > 0 ? ` · ${items.length}` : ""}
          </span>
        </div>
      )}

      {official && (
        <div className="official">
          <span className="dot-label">
            <span className="accent">●</span> Official token
          </span>
          <div className="card-grid">
            <TokenCard item={official} official />
          </div>
        </div>
      )}

      {!preview && official && (
        <div className="seg-row">
          <span className="dot-label">
            <span className="accent">●</span> Community agents{items.length > 0 ? ` · ${items.length}` : ""}
          </span>
        </div>
      )}

      {error && <p className="note bad">Could not read launches from Robinhood Chain: {error}</p>}

      {cards.length > 0 && (
        <div className="card-grid">
          {cards.map((i) => (
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

      {preview ? (
        <div className="center">
          {loading && <span className="muted">checking launches for KIPS agents…</span>}
          {!loading && shown.length > PREVIEW_COUNT && (
            <a className="btn btn-ghost" href="#/explore">
              See all {shown.length} agents <ArrowRight />
            </a>
          )}
        </div>
      ) : (
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
      )}
      {!preview && <p className="center muted small">// every token launched through KIPS on Robinhood Chain</p>}
    </section>
  );
}

export function Logo({ url, symbol }: { url: string; symbol: string }) {
  const [broken, setBroken] = useState(false);
  const src = safeUrl(url);
  if (!src || broken) return <div className="logo ph">{symbol.slice(0, 2).toUpperCase()}</div>;
  return <img className="logo" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function TokenCard({ item, official = false }: { item: Item; official?: boolean }) {
  const { meta, stats } = item;
  const progress = stats ? graduationProgressBps(stats.raised, stats.graduationThreshold) : null;
  const x = safeUrl(meta.socials.twitter);
  const web = safeUrl(meta.socials.website);
  return (
    <Corners className={official ? "token-card token-official" : "token-card"} accent={official || !!meta.profile}>
      <div className="row">
        <Logo url={meta.logo} symbol={meta.symbol} />
        <div className="grow">
          <strong className="ellipsis">{meta.name}</strong>
          <div className="muted small">${meta.symbol}</div>
        </div>
        {official ? (
          <span className="badge">official</span>
        ) : meta.profile ? (
          <span className="badge">{meta.profile.category === "profile" ? "x profile" : meta.profile.category}</span>
        ) : (
          <span className="badge badge-dim">token</span>
        )}
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
      {official && <BurnLine token={meta.token} symbol={meta.symbol} />}
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
