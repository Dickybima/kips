import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { CATEGORIES, validateLaunchForm, type Category, type LaunchForm } from "../lib/kips/agent";
import { errMsg, fmt, parseAmount, pct, shortAddr } from "../lib/format";
import { explorerLink } from "../lib/pons/chain";
import { readLaunchEnv, type LaunchEnv } from "../lib/pons/read";
import { prepareLaunch, waitForLaunch, type PreparedLaunch } from "../lib/pons/write";
import { useWallet } from "../lib/wallet";

const SLIPPAGE_BPS = 500n;

type Stage =
  | { s: "form" }
  | { s: "simulating" }
  | { s: "review"; prepared: PreparedLaunch }
  | { s: "sending" }
  | { s: "confirming"; hash: string }
  | { s: "done"; token: Address };

export function Launch() {
  const { account, connect, getClient } = useWallet();
  const [env, setEnv] = useState<LaunchEnv | null>(null);
  const [envError, setEnvError] = useState("");
  const [stage, setStage] = useState<Stage>({ s: "form" });
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [logo, setLogo] = useState("");
  const [about, setAbout] = useState("");
  const [category, setCategory] = useState<Category>("assistant");
  const [skills, setSkills] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [agentWallet, setAgentWallet] = useState("");
  const [taxPct, setTaxPct] = useState("1");
  const [buyback, setBuyback] = useState(false);
  const [configId, setConfigId] = useState<bigint | null>(null);
  const [initialBuy, setInitialBuy] = useState("");

  useEffect(() => {
    let live = true;
    setEnvError("");
    readLaunchEnv(account).then(
      (e) => {
        if (!live) return;
        setEnv(e);
        setConfigId((cur) => cur ?? e.configs[0]?.id ?? null);
      },
      (e) => live && setEnvError(errMsg(e)),
    );
    return () => {
      live = false;
    };
  }, [account]);

  const form: LaunchForm = useMemo(
    () => ({
      name,
      symbol,
      logo,
      about,
      profile: { category, skills: skills.split(","), endpoint },
      socials: { twitter, telegram, discord: "", website },
    }),
    [name, symbol, logo, about, category, skills, endpoint, twitter, telegram, website],
  );

  const feeRecipient = agentWallet.trim() || account || "";
  const taxBps = Math.round(Number(taxPct) * 100);
  const buyWei = initialBuy.trim() ? parseAmount(initialBuy) : 0n;
  const config = env?.configs.find((c) => c.id === configId) ?? null;

  const problems = useMemo(() => {
    const p = validateLaunchForm(form);
    if (agentWallet.trim() && !isAddress(agentWallet.trim())) p.push("Agent wallet is not a valid address.");
    if (!Number.isFinite(taxBps) || taxBps < 0) p.push("Creator fee must be zero or more.");
    else if (env && BigInt(taxBps) > env.maxCreatorTaxBps) p.push(`Creator fee is capped at ${pct(env.maxCreatorTaxBps)}.`);
    if (buyWei === null) p.push("Initial buy is not a valid ETH amount.");
    return p;
  }, [form, agentWallet, taxBps, env, buyWei]);

  const blocked = !env
    ? null
    : !env.launchEnabled
      ? "Pons v2 launches are currently paused by the protocol."
      : !env.nativeApproved
        ? "Pons v2 is not accepting ETH-paired launches right now."
        : env.configs.length === 0
          ? "Pons v2 has no open launch configuration."
          : account && env.canLaunch === false
            ? "Pons v2 is not open to this wallet yet: launches are limited to allowlisted launchers."
            : null;

  const busy = stage.s !== "form" && stage.s !== "review";
  const canSimulate = !!account && !!env && !blocked && !!config && problems.length === 0 && !busy;

  async function simulate() {
    if (!account || !env || !config || buyWei === null) return;
    setError("");
    setStage({ s: "simulating" });
    try {
      const prepared = await prepareLaunch({
        form,
        account,
        creatorFeeRecipient: feeRecipient as Address,
        creatorTaxBps: taxBps,
        buybackEnabled: buyback,
        launchConfigId: config.id,
        launchFee: env.launchFee,
        initialBuy: buyWei,
        slippageBps: SLIPPAGE_BPS,
      });
      setStage({ s: "review", prepared });
    } catch (e) {
      setError(`Simulation failed, nothing was sent: ${errMsg(e)}`);
      setStage({ s: "form" });
    }
  }

  async function send(prepared: PreparedLaunch) {
    setError("");
    setStage({ s: "sending" });
    try {
      const hash = await prepared.send(await getClient());
      setStage({ s: "confirming", hash });
      setStage({ s: "done", token: await waitForLaunch(hash) });
    } catch (e) {
      setError(errMsg(e));
      setStage({ s: "form" });
    }
  }

  if (stage.s === "done") {
    return (
      <section className="panel narrow">
        <h2>{name.trim()} is live</h2>
        <p>
          ${symbol.trim()} launched on Pons v2 at <code>{stage.token}</code>.
        </p>
        <a className="btn primary" href={`#/agent/${stage.token}`}>
          Open agent page
        </a>
      </section>
    );
  }

  const locked = stage.s !== "form";

  return (
    <div className="two">
      <section className="panel">
        <h2>Launch an agent</h2>
        <fieldset disabled={locked}>
          <h3>Identity</h3>
          <div className="pair">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Atlas" />
            </Field>
            <Field label="Ticker">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ATLAS" />
            </Field>
          </div>
          <Field label="Logo URL" hint="https:// or ipfs://">
            <input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" />
          </Field>
          <Field label="What does this agent do?">
            <textarea rows={4} value={about} onChange={(e) => setAbout(e.target.value)} />
          </Field>

          <h3>Agent profile</h3>
          <div className="pair">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Skills" hint="comma separated, up to 8">
              <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="swaps, alerts" />
            </Field>
          </div>
          <Field label="Agent endpoint" hint="optional — API, MCP or A2A URL">
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://agent.example/mcp" />
          </Field>
          <Field label="Agent wallet" hint="receives the creator fees; defaults to your wallet">
            <input value={agentWallet} onChange={(e) => setAgentWallet(e.target.value)} placeholder={account ?? "0x…"} />
          </Field>

          <h3>Links</h3>
          <div className="pair">
            <Field label="X / Twitter">
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} />
            </Field>
            <Field label="Telegram">
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} />
            </Field>
          </div>
          <Field label="Website">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} />
          </Field>

          <h3>Token terms</h3>
          <div className="pair">
            <Field label="Creator fee %" hint={env ? `max ${pct(env.maxCreatorTaxBps)}, taken on every trade` : ""}>
              <input inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
            </Field>
            <Field label="Initial buy (ETH)" hint="optional, bought in the launch transaction">
              <input inputMode="decimal" value={initialBuy} onChange={(e) => setInitialBuy(e.target.value)} placeholder="0" />
            </Field>
          </div>
          {env && env.configs.length > 1 && (
            <Field label="Launch configuration">
              <select value={String(configId)} onChange={(e) => setConfigId(BigInt(e.target.value))}>
                {env.configs.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    #{String(c.id)} — graduates at {fmt(c.graduationThreshold)} ETH
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="check">
            <input type="checkbox" checked={buyback} onChange={(e) => setBuyback(e.target.checked)} />
            Enable Pons buyback (part of trading fees buys back and locks the token)
          </label>
        </fieldset>
      </section>

      <aside className="panel">
        <h3>Summary</h3>
        {envError && <p className="note bad">Could not read Pons v2: {envError}</p>}
        {!env && !envError && <p className="muted">Reading Pons v2…</p>}
        {env && (
          <dl>
            <dt>Launch fee</dt>
            <dd>{fmt(env.launchFee)} ETH</dd>
            {config && (
              <>
                <dt>Supply</dt>
                <dd>{fmt(config.supply)}</dd>
                <dt>Curve fee</dt>
                <dd>{pct(config.curveFeeBps)}</dd>
                <dt>Graduates at</dt>
                <dd>{fmt(config.graduationThreshold)} ETH</dd>
              </>
            )}
            <dt>Creator fee to</dt>
            <dd>{feeRecipient && isAddress(feeRecipient) ? shortAddr(feeRecipient) : "—"}</dd>
          </dl>
        )}
        {blocked && <p className="note bad">{blocked}</p>}
        {problems.length > 0 && (name || symbol) && (
          <ul className="note bad">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {error && <p className="note bad">{error}</p>}

        {!account ? (
          <button className="btn primary full" onClick={() => connect().catch((e) => setError(errMsg(e)))}>
            Connect wallet
          </button>
        ) : stage.s === "review" ? (
          <>
            <div className="note">
              <strong>Simulation passed.</strong>
              <dl>
                <dt>Token address</dt>
                <dd>{shortAddr(stage.prepared.token)}</dd>
                <dt>You send</dt>
                <dd>{fmt(stage.prepared.value)} ETH</dd>
                {stage.prepared.tokensOut > 0n && (
                  <>
                    <dt>You receive about</dt>
                    <dd>
                      {fmt(stage.prepared.tokensOut)} {symbol.trim()}
                    </dd>
                  </>
                )}
              </dl>
            </div>
            <button className="btn primary full" onClick={() => void send(stage.prepared)}>
              Launch
            </button>
            <button className="btn full" onClick={() => setStage({ s: "form" })}>
              Edit
            </button>
          </>
        ) : (
          <button className="btn primary full" disabled={!canSimulate} onClick={() => void simulate()}>
            {stage.s === "simulating"
              ? "Simulating…"
              : stage.s === "sending"
                ? "Confirm in wallet…"
                : stage.s === "confirming"
                  ? "Waiting for confirmation…"
                  : "Review launch"}
          </button>
        )}
        {stage.s === "confirming" && <TxLink hash={stage.hash} />}
      </aside>
    </div>
  );
}

function TxLink({ hash }: { hash: string }) {
  const url = explorerLink("tx", hash);
  return (
    <p className="muted small">
      Transaction{" "}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {shortAddr(hash)}
        </a>
      ) : (
        <code>{shortAddr(hash)}</code>
      )}
    </p>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}
