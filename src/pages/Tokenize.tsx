import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { ArrowRight, XLogo } from "../components/Icons";
import { Corners, PageHead } from "../components/Ui";
import { TopProfiles } from "../components/TopProfiles";
import { LIMITS, byteLength, validateLaunchForm } from "../lib/kips/agent";
import {
  XProfileError,
  avatarToLogo,
  compactCount,
  fetchXProfile,
  parseHandle,
  profileForm,
  tickerFromHandle,
  xUrl,
  type XProfile,
} from "../lib/kips/xprofile";
import { useChainStats } from "../lib/chainStats";
import { errMsg, fmt, parseAmount, shortAddr } from "../lib/format";
import { readLaunchEnv, type LaunchEnv } from "../lib/pons/read";
import { prepareLaunch, waitForLaunch } from "../lib/pons/write";
import { useWallet } from "../lib/wallet";

const SLIPPAGE_BPS = 500n;
/** Creator fee on every trade, paid to the launcher's wallet. */
const CREATOR_FEE_BPS = 100;

type Line = { text: string; tone: "dim" | "ok" | "err"; href?: string };

export function Tokenize() {
  const { account, connect, getClient } = useWallet();
  const { env: sharedEnv } = useChainStats();
  const [env, setEnv] = useState<LaunchEnv | null>(null);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<XProfile | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [buy, setBuy] = useState("");
  const [finding, setFinding] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState<Address | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [launches, setLaunches] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  const log = (text: string, tone: Line["tone"] = "dim", href?: string) => setLines((l) => [...l, { text, tone, href }]);

  useEffect(() => {
    if (!account) return setEnv(sharedEnv);
    let live = true;
    readLaunchEnv(account).then((e) => live && setEnv(e), () => live && setEnv(sharedEnv));
    return () => {
      live = false;
    };
  }, [account, sharedEnv]);

  async function find(raw = query) {
    const handle = parseHandle(raw);
    if (!handle) {
      setLines([{ text: "Type an X username, like @jack or x.com/jack.", tone: "err" }]);
      return;
    }
    setFinding(true);
    setProfile(null);
    setLaunched(null);
    setLines([{ text: `Looking up @${handle} on X…`, tone: "dim" }]);
    try {
      const p = await fetchXProfile(handle);
      setProfile(p);
      setName(p.name);
      setSymbol(tickerFromHandle(p.handle));
      setLines([{ text: `Found @${p.handle}. Check the name and ticker, then launch.`, tone: "ok" }]);
    } catch (e) {
      setLines([{ text: e instanceof XProfileError ? e.message : errMsg(e), tone: "err" }]);
    } finally {
      setFinding(false);
    }
  }

  async function launch() {
    if (!profile) return;
    if (!account) {
      log("Connect a wallet first, then press Launch token again.", "err");
      return void connect().catch(() => undefined);
    }
    const e = env;
    if (!e) return log("Still reading Robinhood Chain. Try again in a moment.", "err");
    if (!e.launchEnabled || e.configs.length === 0) return log("Launches are currently paused by the protocol.", "err");
    if (e.canLaunch === false) return log("Launching is not open to this wallet yet.", "err");
    const initialBuy = buy.trim() ? parseAmount(buy) : 0n;
    if (initialBuy === null) return log("Initial buy must be an ETH amount, for example 0.01.", "err");

    setLaunching(true);
    try {
      log("Saving the profile picture…");
      const logo = await avatarToLogo(profile.avatar);
      const form = profileForm(profile, { name, symbol, logo });
      const problems = validateLaunchForm(form);
      if (problems.length) {
        problems.forEach((p) => log(p, "err"));
        return;
      }
      log("Checking the launch on Robinhood Chain…");
      const p = await prepareLaunch({
        form,
        account,
        creatorFeeRecipient: account,
        creatorTaxBps: CREATOR_FEE_BPS,
        buybackEnabled: false,
        launchConfigId: e.configs[0].id,
        launchFee: e.launchFee,
        initialBuy,
        slippageBps: SLIPPAGE_BPS,
      });
      const got = p.tokensOut > 0n ? ` and get about ${fmt(p.tokensOut)} ${form.symbol}` : "";
      log(`Looks good. Approve in your wallet: you pay ${fmt(p.value)} ETH${got}, plus gas.`);
      const hash = await p.send(await getClient());
      log(`Sent ${shortAddr(hash)}. Waiting for Robinhood Chain to confirm…`);
      const token = await waitForLaunch(hash);
      setLaunched(token);
      setLaunches((n) => n + 1);
      log(`$${form.symbol} is live at ${token}`, "ok");
      log("Open the token page →", "ok", `#/agent/${token}`);
    } catch (err) {
      log(`${errMsg(err)}\nNothing was launched.`, "err");
    } finally {
      setLaunching(false);
    }
  }

  const symbolOk = symbol.trim() !== "" && !/\s/.test(symbol) && byteLength(symbol.trim()) <= LIMITS.symbol;
  const nameOk = name.trim() !== "" && byteLength(name.trim()) <= LIMITS.name;

  return (
    <section className="wrap section tokenize">
      <PageHead n="04" label="Tokenize X" title="Tokenize any X profile.">
        Type a username. KIPS reads the profile and turns it into a token on Robinhood Chain: the name, the picture
        and the bio, ready to trade.
      </PageHead>

      <form
        className="tx-search"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <span className="tx-at">@</span>
        <input
          ref={field}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="username or x.com link"
          aria-label="X username"
          autoComplete="off"
          spellCheck={false}
          disabled={finding || launching}
          autoFocus
        />
        <button className="btn btn-solid" disabled={finding || launching || !query.trim()}>
          {finding ? "Looking up…" : "Find profile"}
        </button>
      </form>

      {profile && (
        <Corners className="tx-card" accent>
          <div className="tx-banner" style={profile.banner ? { backgroundImage: `url(${profile.banner})` } : undefined} />
          <div className="tx-head">
            {profile.avatar ? (
              <img className="tx-avatar" src={profile.avatar} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="tx-avatar tx-avatar-ph">{profile.handle.slice(0, 2).toUpperCase()}</span>
            )}
            <div className="grow">
              <strong className="tx-name">
                {profile.name}
                {profile.verified && <span className="tx-check" title="Verified on X">✓</span>}
              </strong>
              <a className="muted small" href={xUrl(profile.handle)} target="_blank" rel="noopener noreferrer">
                @{profile.handle} ↗
              </a>
            </div>
            <span className="badge">x profile</span>
          </div>
          {profile.bio && <p className="tx-bio">{profile.bio}</p>}
          <p className="muted small">{compactCount(profile.followers)} followers on X</p>

          <div className="tx-fields">
            <label>
              <span className="muted small">Token name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={launching || !!launched} maxLength={64} />
            </label>
            <label>
              <span className="muted small">Ticker</span>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.replace(/^\$/, "").toUpperCase())}
                disabled={launching || !!launched}
                maxLength={16}
              />
            </label>
            <label>
              <span className="muted small">Initial buy (ETH, optional)</span>
              <input value={buy} onChange={(e) => setBuy(e.target.value)} placeholder="0" inputMode="decimal" disabled={launching || !!launched} />
            </label>
          </div>

          <p className="note small">
            Anyone can tokenize a public profile. This token is not created or endorsed by @{profile.handle} unless
            they launched it themselves. The 1% creator fee goes to the wallet that launches it.
          </p>

          {launched ? (
            <div className="chip-row">
              <a className="btn btn-solid" href={`#/agent/${launched}`}>
                View token <ArrowRight width={14} height={14} />
              </a>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setProfile(null);
                  setLaunched(null);
                  setLines([]);
                  setQuery("");
                  field.current?.focus();
                }}
              >
                Tokenize another
              </button>
            </div>
          ) : (
            <button className="btn btn-solid full" onClick={() => void launch()} disabled={launching || !symbolOk || !nameOk}>
              {launching ? "Launching…" : !account ? "Connect wallet" : `Launch $${symbol || "TICKER"}`}
            </button>
          )}
          {env && <p className="muted small tx-fee">Launch fee {fmt(env.launchFee)} ETH + gas</p>}
        </Corners>
      )}

      {lines.length > 0 && (
        <div className="tx-log" aria-live="polite">
          {lines.map((l, i) => (
            <div key={i} className={`tx-line ${l.tone}`}>
              <span className="accent">›</span> {l.href ? <a href={l.href}>{l.text}</a> : l.text}
            </div>
          ))}
        </div>
      )}

      {!profile && (
        <div className="tx-how">
          <div>
            <XLogo width={16} height={16} />
            <strong>1. Type a username</strong>
            <span className="muted small">Any public X account.</span>
          </div>
          <div>
            <strong>2. Check the token</strong>
            <span className="muted small">Name, ticker, picture and bio come from the profile.</span>
          </div>
          <div>
            <strong>3. Launch</strong>
            <span className="muted small">Approve in your wallet. It shows up on Explore.</span>
          </div>
        </div>
      )}

      <TopProfiles refresh={launches} />
    </section>
  );
}
