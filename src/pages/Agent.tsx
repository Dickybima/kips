import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { ArrowUp, ImageIcon, Sparkle } from "../components/Icons";
import { LogoError, prepareLogo, uploadLogo } from "../lib/kips/image";
import { Label } from "../components/Ui";
import { validateLaunchForm } from "../lib/kips/agent";
import { parseIntent, parseQuick } from "../lib/kips/intent";
import { STEPS, answerStep, initialBuyWei, taxBps, toLaunchForm, type Answers } from "../lib/kips/wizard";
import { errMsg, fmt, shortAddr } from "../lib/format";
import { useChainStats } from "../lib/chainStats";
import { readLaunchEnv, type LaunchEnv } from "../lib/pons/read";
import { prepareLaunch, waitForLaunch, type PreparedLaunch } from "../lib/pons/write";
import { useWallet } from "../lib/wallet";

const SLIPPAGE_BPS = 500n;
/** Needed before a launch. */
const REQUIRED: (keyof Answers)[] = ["name", "symbol"];
/** Asked for in this order; after the required ones, each can be skipped. */
const ASK: (keyof Answers)[] = ["name", "symbol", "about", "logo"];

type Who = "kips" | "you";
type Tone = "plain" | "ok" | "err" | "dim";
interface Msg {
  who: Who;
  text: string;
  tone?: Tone;
  href?: string;
  /** An image shown in the bubble, e.g. the logo the user just picked. */
  image?: string;
}
type Phase = "collect" | "busy" | "done";

// One click fills a whole agent.
const EXAMPLES = [
  "Atlas $ATLAS Finds momentum on Robinhood Chain and trades it",
  "Scout $SCOUT Watches new launches and posts alerts",
  "Echo $ECHO Turns your posts into replies",
];

const QUESTIONS: Partial<Record<keyof Answers, string>> = {
  name: "What's your agent called?",
  symbol: "Nice. What ticker should it trade under? (e.g. ATLAS)",
  about: "What does it do? One line is enough, or type skip.",
  logo: "Add a logo: press the image button, or drop or paste an image here. Type skip to launch without one.",
};

const LABELS: Partial<Record<keyof Answers, string>> = {
  name: "name",
  symbol: "ticker",
  about: "description",
  category: "category",
  skills: "skills",
  endpoint: "endpoint",
  logo: "logo",
  website: "website",
  twitter: "x",
  telegram: "telegram",
  wallet: "fee wallet",
  tax: "creator fee",
  buyback: "buyback",
  buy: "initial buy",
};
/** Extra fields people can still set by typing key: value; shown on the card once set. */
const EXTRAS: (keyof Answers)[] = ["twitter", "website", "telegram", "buy", "tax", "wallet", "category", "endpoint"];

function blockedReason(env: LaunchEnv, hasAccount: boolean): string | null {
  if (!env.launchEnabled) return "Launches are currently paused by the protocol.";
  if (env.configs.length === 0) return "The protocol has no open launch configuration.";
  if (hasAccount && env.canLaunch === false) return "Launching is not open to this wallet yet.";
  return null;
}

const missingRequired = (a: Partial<Answers>) => REQUIRED.filter((k) => !a[k]);
/** The next question still worth asking: required fields, then optional ones not yet answered or skipped. */
const nextToAsk = (a: Partial<Answers>) => ASK.find((k) => (REQUIRED.includes(k) ? !a[k] : a[k] === undefined));

/** Optional answers fall back to the wizard defaults at launch time. */
function withDefaults(a: Partial<Answers>): Answers {
  const out = {} as Answers;
  for (const s of STEPS) out[s.key] = a[s.key] ?? s.fallback ?? "";
  return out;
}

export function Agent() {
  const { account, walletName, wallets, connect, connectWith, disconnect, getClient } = useWallet();
  const { env: sharedEnv } = useChainStats();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const [phase, setPhase] = useState<Phase>("collect");
  const [launched, setLaunched] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [env, setEnv] = useState<LaunchEnv | null>(null);
  const pending = useRef<keyof Answers | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const greeted = useRef(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const say = useCallback((who: Who, text: string, tone: Tone = "plain", href?: string, image?: string) => {
    setMsgs((m) => [...m, { who, text, tone, href, image }]);
  }, []);

  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    pending.current = "name";
    say("kips", "Hi, I'm KIPS. Let's launch your agent's token. What's your agent called?\nOr say it all at once: Atlas $ATLAS Trades momentum for you");
  }, [say]);

  // Per-wallet launch permissions; the shared copy covers the wallet-less case.
  useEffect(() => {
    if (!account) return setEnv(sharedEnv);
    let live = true;
    readLaunchEnv(account).then((e) => live && setEnv(e), () => live && setEnv(sharedEnv));
    return () => {
      live = false;
    };
  }, [account, sharedEnv]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const ctx = () => ({ maxTaxBps: env?.maxCreatorTaxBps ?? null });

  function nextQuestion(a: Partial<Answers>, wasReady = false, changed: (keyof Answers)[] = []) {
    const next = nextToAsk(a);
    if (next) {
      pending.current = next;
      return say("kips", QUESTIONS[next] ?? STEPS.find((s) => s.key === next)!.ask(ctx()));
    }
    pending.current = null;
    if (wasReady) {
      const set = changed.filter((k) => a[k] !== undefined);
      if (set.length === 0) return;
      return say("kips", `Updated ${set.map((k) => `${LABELS[k]} → ${a[k] || "(none)"}`).join(", ")}.`, "ok");
    }
    say("kips", `${a.name} ($${a.symbol}) is ready. Press Launch token, or type launch.`, "ok");
  }

  function applyFields(fields: Partial<Answers>): Partial<Answers> {
    const next = { ...answersRef.current };
    const errors: string[] = [];
    for (const [k, raw] of Object.entries(fields) as [keyof Answers, string][]) {
      const step = STEPS.find((s) => s.key === k)!;
      const res = answerStep(step, raw, ctx());
      if (res.ok) next[k] = res.value;
      else errors.push(`${LABELS[k]}: ${res.error}`);
    }
    errors.forEach((e) => say("kips", e, "err"));
    setAnswers(next);
    answersRef.current = next;
    return next;
  }

  /** Simulates the launch, then sends it straight to the wallet for signing. */
  async function launch() {
    const e = env;
    if (!account) {
      say("kips", "Connect a wallet first, then press Launch token again.", "err");
      return void connect().catch(() => undefined);
    }
    if (!e) return say("kips", "Still reading Robinhood Chain. Try again in a moment.", "err");
    const reason = blockedReason(e, true);
    if (reason) return say("kips", reason, "err");
    const miss = missingRequired(answersRef.current);
    if (miss.length) return say("kips", `I still need the ${miss.map((k) => LABELS[k]).join(" and ")}.`, "err");
    const a = withDefaults(answersRef.current);
    const form = toLaunchForm(a);
    const problems = validateLaunchForm(form);
    if (problems.length) return problems.forEach((p) => say("kips", p, "err"));

    setPhase("busy");
    say("kips", "Checking the launch on Robinhood Chain…", "dim");
    let p: PreparedLaunch;
    try {
      p = await prepareLaunch({
        form,
        account,
        creatorFeeRecipient: (a.wallet || account) as Address,
        creatorTaxBps: taxBps(a),
        buybackEnabled: a.buyback === "yes",
        launchConfigId: e.configs[0].id,
        launchFee: e.launchFee,
        initialBuy: initialBuyWei(a),
        slippageBps: SLIPPAGE_BPS,
      });
    } catch (err) {
      setPhase("collect");
      return say("kips", `This launch would fail, so nothing was sent: ${errMsg(err)}`, "err");
    }
    const got = p.tokensOut > 0n ? ` and get about ${fmt(p.tokensOut)} ${a.symbol}` : "";
    say("kips", `Looks good. Approve in your wallet: you pay ${fmt(p.value)} ETH${got}, plus gas.`, "dim");
    try {
      const hash = await p.send(await getClient());
      say("kips", `Sent ${shortAddr(hash)}. Waiting for Robinhood Chain to confirm…`, "dim");
      const token = await waitForLaunch(hash);
      setLaunched(token);
      setPhase("done");
      say("kips", `${a.name} is live! $${a.symbol} · ${token}`, "ok");
      say("kips", "Open the agent page →", "plain", `#/agent/${token}`);
      say("kips", "Type new to launch another agent.", "dim");
    } catch (err) {
      setPhase("collect");
      say("kips", `${errMsg(err)}\nNothing was launched. Press Launch token to try again.`, "err");
    }
  }

  function restart() {
    setAnswers({});
    answersRef.current = {};
    setLaunched(null);
    setPhase("collect");
    pending.current = "name";
    say("kips", "Fresh start. What's your agent called?");
  }

  async function handle(raw: string) {
    const text = raw.trim();
    if (!text) return;
    say("you", text);
    const cmd = text.toLowerCase();

    if (cmd === "help") {
      return say(
        "kips",
        [
          "Type Name $TICKER description, or answer the questions one by one.",
          "launch      launch the token",
          "skip        skip an optional question",
          "new         start over",
          "connect     choose a wallet · disconnect",
          "Extras, any time: x: @handle  website: site.xyz  buy: 0.01  fee: 2",
        ].join("\n"),
        "dim",
      );
    }
    if (cmd === "restart" || cmd === "new" || cmd === "reset") return restart();
    if (cmd === "connect" || cmd.startsWith("connect ")) {
      const arg = cmd.slice(7).trim();
      if (!arg && account) return say("kips", `Connected as ${shortAddr(account)} with ${walletName}.`, "dim");
      if (wallets.length === 0) return say("kips", "No wallet found in this browser. Install one and reload.", "err");
      const choice = arg ? wallets[Number(arg) - 1] : wallets.length === 1 ? wallets[0] : null;
      if (!choice) {
        if (!arg) return void connect();
        return say("kips", `Pick 1 to ${wallets.length}: ${wallets.map((w, i) => `${i + 1} ${w.name}`).join(", ")}.`, "err");
      }
      try {
        await connectWith(choice.id);
        return say("kips", `Connected with ${choice.name}.`, "ok");
      } catch (e) {
        return say("kips", errMsg(e), "err");
      }
    }
    if (cmd === "disconnect") {
      if (!account) return say("kips", "No wallet is connected.", "dim");
      disconnect();
      return say("kips", "Wallet disconnected.", "dim");
    }
    if (phase === "done") return say("kips", "This agent is launched. Type new to launch another.", "dim");
    if (cmd === "launch" || cmd === "confirm" || cmd === "go") return launch();

    if (cmd === "skip" || cmd === "no") {
      const k = pending.current;
      const step = k ? STEPS.find((s) => s.key === k) : null;
      if (!step || step.fallback === undefined) return say("kips", "This one is needed to launch.", "err");
      return nextQuestion(applyFields({ [step.key]: "" }));
    }

    const wasReady = nextToAsk(answersRef.current) === undefined;
    const fields = parseIntent(text);
    if (Object.keys(fields).length > 0) {
      return nextQuestion(applyFields(fields), wasReady, Object.keys(fields) as (keyof Answers)[]);
    }
    // "Atlas $ATLAS does things" fills name, ticker and description at once.
    const quick = pending.current === "name" || pending.current === "symbol" ? parseQuick(text) : {};
    if (Object.keys(quick).length > 0) return nextQuestion(applyFields(quick));
    if (pending.current) {
      const step = STEPS.find((s) => s.key === pending.current)!;
      const res = answerStep(step, text, ctx());
      if (!res.ok) return say("kips", res.error, "err");
      return nextQuestion(applyFields({ [step.key]: text }));
    }
    say("kips", "Press Launch token when you're ready, or type help.", "dim");
  }

  /** Crops, uploads and sets a logo picked from disk, dropped or pasted. */
  async function addLogo(file: File) {
    if (busy || uploading || phase === "busy" || phase === "done") return;
    let prepared;
    try {
      prepared = await prepareLogo(file);
    } catch (e) {
      return say("kips", e instanceof LogoError ? e.message : errMsg(e), "err");
    }
    say("you", file.name || "logo", "plain", undefined, prepared.preview);
    setUploading(true);
    say("kips", "Uploading the logo…", "dim");
    try {
      const url = await uploadLogo(prepared.blob);
      const wasReady = nextToAsk(answersRef.current) === undefined;
      const next = applyFields({ logo: url });
      if (next.logo !== url) return;
      say("kips", "Logo set.", "ok");
      if (!wasReady) nextQuestion(next);
    } catch (e) {
      say("kips", e instanceof LogoError ? e.message : errMsg(e), "err");
    } finally {
      setUploading(false);
    }
  }

  function pickFrom(files: FileList | null | undefined) {
    const file = files && Array.from(files).find((f) => f.type.startsWith("image/"));
    if (file) void addLogo(file);
  }

  function submit(text = input) {
    if (busy || !text.trim()) return;
    setInput("");
    setBusy(true);
    handle(text)
      .catch((e) => say("kips", errMsg(e), "err"))
      .finally(() => {
        setBusy(false);
        field.current?.focus();
      });
  }

  const ready = missingRequired(answers).length === 0;
  const extras = EXTRAS.filter((k) => answers[k]);
  const steps = [
    { label: "Name & ticker", done: ready },
    { label: "Description & logo", done: ready && answers.about !== undefined && answers.logo !== undefined, optional: true },
    { label: "Launch", done: phase === "done" },
  ];

  return (
    <div className="lab">
      <aside className="lab-side">
        <Label n="03">Launch</Label>
        <h1>Launch in one message.</h1>
        <p className="muted">
          Type your agent's name and ticker. KIPS checks the launch on Robinhood Chain and you approve it in your
          wallet.
        </p>
        <ol className="lab-steps">
          {steps.map((st, i) => (
            <li key={st.label} className={st.done ? "done" : ""}>
              <span className="lab-step-n">{st.done ? "✓" : i + 1}</span>
              {st.label}
              {st.optional && <span className="muted small"> · optional</span>}
            </li>
          ))}
        </ol>
        <p className="lab-h">// try one</p>
        <div className="lab-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="lab-box lab-ex" onClick={() => submit(ex)} disabled={busy || phase !== "collect"}>
              <span className="accent">›</span> {ex}
            </button>
          ))}
        </div>
        <p className="muted small">
          Launching sends a real transaction: you pay the launch fee and gas. Extras like <b>x: @handle</b> or{" "}
          <b>buy: 0.01</b> can be typed any time; type <b>help</b> for more.
        </p>
      </aside>

      <section
        className={dragging ? "lab-chat dragging" : "lab-chat"}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.items).some((i) => i.type.startsWith("image/"))) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFrom(e.dataTransfer.files);
        }}
      >
        {dragging && <div className="drop-hint">Drop to use as the agent's logo</div>}
        <div className="lab-log" ref={log} aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.who} ${m.tone ?? "plain"}`}>
              {m.who === "kips" && <span className="bubble-who">kips</span>}
              {m.image && <img className="bubble-img" src={m.image} alt="" />}
              {m.href ? <a href={m.href}>{m.text}</a> : <span className="bubble-text">{m.text}</span>}
            </div>
          ))}
          {phase === "busy" && <div className="bubble kips dim thinking">Thinking</div>}
        </div>
        <form
          className="lab-input"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Sparkle className="accent" />
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              pickFrom(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={field}
            rows={1}
            value={input}
            placeholder="Describe your agent…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit((e.target as HTMLTextAreaElement).value);
              }
            }}
            onPaste={(e) => {
              const files = e.clipboardData.files;
              if (files.length && Array.from(files).some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                pickFrom(files);
              }
            }}
            disabled={busy}
            aria-label="Message KIPS"
            autoFocus
          />
          <button
            type="button"
            className="attach"
            onClick={() => fileInput.current?.click()}
            disabled={busy || uploading || phase === "busy" || phase === "done"}
            aria-label="Upload a logo"
            title="Upload a logo"
          >
            {uploading ? <span className="spin" /> : <ImageIcon />}
          </button>
          <button className="send" disabled={busy || !input.trim()} aria-label="Send">
            <ArrowUp />
          </button>
        </form>
      </section>

      <aside className="lab-blueprint">
        <div className="bp">
          <div className="bp-bar">
            <i />
            <i />
            <i className={ready ? "on" : ""} />
            <span>preview</span>
          </div>
          <div className="bp-logo">
            <button
              type="button"
              className="bp-logo-pick"
              onClick={() => fileInput.current?.click()}
              disabled={busy || uploading || phase !== "collect"}
              aria-label={answers.logo ? "Change logo" : "Upload logo"}
              title={answers.logo ? "Change logo" : "Upload logo"}
            >
              {uploading ? (
                <span className="bp-logo-ph">
                  <span className="spin" />
                </span>
              ) : answers.logo ? (
                <img src={answers.logo} alt="Agent logo" />
              ) : (
                <span className="bp-logo-ph">
                  <ImageIcon />
                </span>
              )}
            </button>
            <div className="grow">
              <strong className="ellipsis">{answers.name || "Your agent"}</strong>
              <span className="muted small">{answers.symbol ? `$${answers.symbol}` : "$TICKER"}</span>
            </div>
          </div>
          <p className={answers.about ? "bp-about" : "bp-about muted"}>{answers.about || "No description yet."}</p>
          {extras.length > 0 && (
            <dl className="bp-extra">
              {extras.map((k) => (
                <div key={k}>
                  <dt className="muted">{LABELS[k]}</dt>
                  <dd className="ellipsis">{k === "tax" ? `${answers[k]}%` : k === "buy" ? `${answers[k]} ETH` : answers[k]}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="bp-foot">
            {phase === "done" && launched ? (
              <>
                <a className="btn btn-solid full" href={`#/agent/${launched}`}>
                  View your token
                </a>
                <button className="btn btn-ghost full" onClick={() => submit("new")} disabled={busy}>
                  Launch another
                </button>
              </>
            ) : (
              <button
                className="btn btn-solid full"
                onClick={() => submit("launch")}
                disabled={busy || phase !== "collect" || (!!account && !ready)}
              >
                {phase === "busy" ? "Launching…" : !account ? "Connect wallet" : ready ? "Launch token" : "Add a name and ticker"}
              </button>
            )}
            {env && <p className="muted small">Launch fee {fmt(env.launchFee)} ETH + gas</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
