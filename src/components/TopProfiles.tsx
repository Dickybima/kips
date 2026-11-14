import { useEffect, useState } from "react";
import { publicClient } from "../lib/pons/chain";
import { scanAgents } from "../lib/pons/read";
import { compactCount, fetchXProfile, xUrl } from "../lib/kips/xprofile";
import { eachLimited, groupByHandle, rankByFollowers, type ProfileToken, type RankedProfile } from "../lib/kips/topProfiles";
import { errMsg } from "../lib/format";
import { Logo } from "../pages/Explore";

const SHOW = 25;

/** Tokenized X profiles, ranked by followers on X. `refresh` reloads the list. */
export function TopProfiles({ refresh = 0 }: { refresh?: number }) {
  const [rows, setRows] = useState<RankedProfile[] | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    setError("");
    (async () => {
      const head = await publicClient.getBlockNumber();
      const { agents } = await scanAgents(head);
      const tokens: ProfileToken[] = agents
        .filter((a) => a.meta.profile?.category === "profile")
        .map((a) => ({
          token: a.meta.token,
          name: a.meta.name,
          symbol: a.meta.symbol,
          logo: a.meta.logo,
          twitter: a.meta.socials.twitter,
          block: a.block,
        }));
      const grouped = groupByHandle(tokens);
      if (!live) return;
      setRows(rankByFollowers(grouped));
      // Follower counts come from X one profile at a time; the list re-sorts as they arrive.
      await eachLimited(grouped, 4, async (row) => {
        try {
          const profile = await fetchXProfile(row.handle);
          if (!live) return;
          setRows((prev) =>
            prev ? rankByFollowers(prev.map((r) => (r.handle === row.handle ? { ...r, profile } : r))) : prev,
          );
        } catch {
          // shown without a follower count
        }
      });
    })().catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [refresh]);

  const shown = rows ? (all ? rows : rows.slice(0, SHOW)) : [];

  return (
    <div className="top-profiles">
      <div className="tp-head">
        <h3>
          <span className="accent">●</span> Top profiles
        </h3>
        <span className="muted small">Tokenized X profiles, ranked by followers</span>
      </div>
      {error ? (
        <p className="note bad">{error}</p>
      ) : rows === null ? (
        <p className="muted small tp-empty">Reading tokenized profiles from Robinhood Chain…</p>
      ) : rows.length === 0 ? (
        <p className="muted small tp-empty">No profiles tokenized yet. Be the first: type a username above.</p>
      ) : (
        <ProfileRows rows={shown} />
      )}
      {rows && rows.length > SHOW && (
        <button className="btn btn-ghost full" onClick={() => setAll(!all)}>
          {all ? "Show top 25" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** The ranked rows, kept separate from loading so they can be rendered on their own. */
export function ProfileRows({ rows }: { rows: RankedProfile[] }) {
  return (
    <ol className="tp-list">
      {rows.map((r, i) => (
        <li key={r.handle.toLowerCase()} className={i < 3 ? `tp-row tp-top${i + 1}` : "tp-row"}>
          <span className="tp-rank">{i + 1}</span>
          <Logo url={r.profile?.avatar || r.token.logo} symbol={r.token.symbol} />
          <div className="tp-who">
            <strong className="ellipsis">
              {r.profile?.name ?? r.token.name}
              {r.profile?.verified && (
                <span className="tx-check" title="Verified on X">
                  ✓
                </span>
              )}
            </strong>
            <a className="muted small ellipsis" href={xUrl(r.handle)} target="_blank" rel="noopener noreferrer">
              @{r.handle}
            </a>
          </div>
          <div className="tp-followers">
            <strong>{r.profile ? compactCount(r.profile.followers) : "…"}</strong>
            <span className="muted small">followers</span>
          </div>
          <a className="chip chip-accent tp-trade" href={`#/agent/${r.token.token}`}>
            ${r.token.symbol}
            {r.others > 0 && <span className="muted"> +{r.others}</span>}
          </a>
        </li>
      ))}
    </ol>
  );
}
