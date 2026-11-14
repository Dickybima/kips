import { useEffect, useState } from "react";
import { publicClient } from "../lib/pons/chain";
import { scanAgents } from "../lib/pons/read";
import { compactCount, fetchXProfile, xUrl, type XProfile } from "../lib/kips/xprofile";
import { eachLimited, groupByHandle, mergeTop, type ProfileToken, type RankedProfile } from "../lib/kips/topProfiles";
import { errMsg } from "../lib/format";
import { Logo } from "../pages/Explore";

const SHOW = 20;

async function fetchTop(): Promise<XProfile[]> {
  const res = await fetch("/api/x-profile?top=1");
  const data = (await res.json().catch(() => ({}))) as { profiles?: XProfile[]; error?: string };
  if (!res.ok || !data.profiles) throw new Error(data.error ?? `Top profiles could not be loaded (${res.status}).`);
  return data.profiles;
}

/** KIPS tokens launched from X profiles, one entry per handle. */
async function tokenizedProfiles(): Promise<RankedProfile[]> {
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
  return groupByHandle(tokens);
}

/**
 * The most-followed X accounts, ranked live by followers, each one a click
 * away from being tokenized. Profiles already tokenized on KIPS link to their
 * token. `refresh` reloads the list; `onPick` starts tokenizing a handle.
 */
export function TopProfiles({ refresh = 0, onPick }: { refresh?: number; onPick?: (handle: string) => void }) {
  const [rows, setRows] = useState<RankedProfile[] | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    setError("");
    let top: XProfile[] = [];
    let tokenized: RankedProfile[] = [];
    const show = () => live && setRows(mergeTop(top, tokenized));
    const topDone = fetchTop().then(
      (t) => {
        top = t;
        show();
      },
      (e) => live && setError(errMsg(e)),
    );
    // Tokenized profiles outside the top list still get a row with their follower count.
    const chainDone = tokenizedProfiles().then(async (t) => {
      tokenized = t;
      await topDone;
      show();
      const known = new Set(top.map((p) => p.handle.toLowerCase()));
      await eachLimited(
        t.filter((r) => !known.has(r.handle.toLowerCase())),
        4,
        async (row) => {
          const profile = await fetchXProfile(row.handle).catch(() => null);
          if (!profile) return;
          tokenized = tokenized.map((r) => (r.handle === row.handle ? { ...r, profile } : r));
          show();
        },
      );
    }, () => undefined);
    void Promise.allSettled([topDone, chainDone]);
    return () => {
      live = false;
    };
  }, [refresh]);

  const shown = rows ? (all ? rows : rows.slice(0, SHOW)) : [];

  return (
    <div className="top-profiles">
      <div className="tp-head">
        <h3>
          <span className="accent">●</span> Top X profiles
        </h3>
        <span className="muted small">Most-followed accounts, ranked live. Tokenize one in a click.</span>
      </div>
      {rows === null ? (
        error ? (
          <p className="note bad">{error}</p>
        ) : (
          <p className="muted small tp-empty">Ranking the biggest accounts on X…</p>
        )
      ) : rows.length === 0 ? (
        <p className="muted small tp-empty">Top profiles are not available right now. Type a username above.</p>
      ) : (
        <ProfileRows rows={shown} onPick={onPick} />
      )}
      {rows && rows.length > SHOW && (
        <button className="btn btn-ghost full" onClick={() => setAll(!all)}>
          {all ? `Show top ${SHOW}` : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** The ranked rows, kept separate from loading so they can be rendered on their own. */
export function ProfileRows({ rows, onPick }: { rows: RankedProfile[]; onPick?: (handle: string) => void }) {
  return (
    <ol className="tp-list">
      {rows.map((r, i) => (
        <li key={r.handle.toLowerCase()} className={i < 3 ? `tp-row tp-top${i + 1}` : "tp-row"}>
          <span className="tp-rank">{i + 1}</span>
          <Logo url={r.profile?.avatar || r.token?.logo || ""} symbol={r.token?.symbol ?? r.handle} />
          <div className="tp-who">
            <strong className="ellipsis">
              {r.profile?.name ?? r.token?.name ?? r.handle}
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
          {r.token ? (
            <a className="chip chip-accent tp-trade" href={`#/agent/${r.token.token}`} title="Tokenized on KIPS">
              ${r.token.symbol}
              {r.others > 0 && <span className="muted"> +{r.others}</span>}
            </a>
          ) : (
            <button type="button" className="chip tp-trade" onClick={() => onPick?.(r.handle)}>
              Tokenize
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
