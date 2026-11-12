import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { ArrowUp, Sparkle } from "../components/Icons";
import { Label } from "../components/Ui";
import { validateLaunchForm } from "../lib/kips/agent";
import { parseIntent } from "../lib/kips/intent";
import { STEPS, answerStep, initialBuyWei, taxBps, toLaunchForm, type Answers } from "../lib/kips/wizard";
import { errMsg, fmt, pct, shortAddr } from "../lib/format";
import { useChainStats } from "../lib/chainStats";
import { readLaunchEnv, type LaunchEnv } from "../lib/pons/read";
import { prepareLaunch, waitForLaunch, type PreparedLaunch } from "../lib/pons/write";
import { useWallet } from "../lib/wallet";

const SLIPPAGE_BPS = 500n;
/** Needed before a launch can be simulated. */
const REQUIRED: (keyof Answers)[] = ["name", "symbol"];
/** Asked for in this order; after the required ones, each can be skipped. */
const ASK: (keyof Answers)[] = ["name", "symbol", "about", "category"];

type Who = "kips" | "you";
type Tone = "plain" | "ok" | "err" | "dim";
interface Msg {
  who: Who;
  text: string;
  tone?: Tone;
  href?: string;
}
type Phase = "collect" | "simulated" | "busy" | "done";

// Each example is a complete agent on its own, so one click gives a launchable blueprint.
const EXAMPLES = [
  "name: Atlas ticker: ATLAS category: trading about: Finds momentum on Robinhood Chain and trades it.",
  "agent Scout ticker SCOUT category research about Watches new launches and posts alerts",
  "name: Echo ticker: ECHO category: social about: Turns your posts into replies. x: @echo",
  "fee: 2 buy: 0.01",
];

const LABELS: Record<keyof Answers, string> = {
  name: "name",
  symbol: "ticker",
  about: "about",
  category: "category",
  skills: "skills",
  endpoint: "endpoint",
  logo: "logo",
  website: "website",
  twitter: "x",
  telegram: "telegram",
  wallet: "fee_wallet",
  tax: "creator_fee_pct",
  buyback: "buyback",
  buy: "initial_buy_eth",
};

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
  const [prepared, setPrepared] = useState<PreparedLaunch | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [env, setEnv] = useState<LaunchEnv | null>(null);
  const pending = useRef<keyof Answers | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const greeted = useRef(false);

  const say = useCallback((who: Who, text: string, tone: Tone = "plain", href?: string) => {
    setMsgs((m) => [...m, { who, text, tone, href }]);
  }, []);

  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    // Plain text before anything else is read as the agent's name.
    pending.current = "name";
    say("kips", "Hi, I'm KIPS. Tell me about the agent you want to launch on Robinhood Chain: its name, ticker, what it does and a category. Use any of the formats on the left, or just start with a name.");
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
      const step = STEPS.find((s) => s.key === next)!;
      pending.current = step.key;
      const canLaunch = missingRequired(a).length === 0;
      return say("kips", canLaunch ? `${step.ask(ctx())}\n(You can also type launch now.)` : step.ask(ctx()));
    }
    pending.current = null;
    if (wasReady) {
      const set = changed.filter((k) => a[k] !== undefined);
      if (set.length === 0) return;
      return say("kips", `Updated ${set.map((k) => `${LABELS[k]} → ${a[k] || "(none)"}`).join(", ")}. Type launch when you're ready.`, "ok");
    }
    say(
      "kips",
      "The blueprint is ready. Optional: endpoint, logo, website, x, telegram, fee_wallet, fee, buyback, buy (e.g. fee: 2). Type launch when you're ready.",
      "ok",
    );
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

  async function simulate() {
    const e = env;
    if (!account) return say("kips", "Connect a wallet first: type connect, or use the button at the top.", "err");
    if (!e) return say("kips", "Still reading Robinhood Chain. Try again in a moment.", "err");
    const reason = blockedReason(e, true);
    if (reason) return say("kips", reason, "err");
    const miss = missingRequired(answersRef.current);
    if (miss.length) return say("kips", `I still need: ${miss.map((k) => LABELS[k]).join(", ")}.`, "err");
    const a = withDefaults(answersRef.current);
    const form = toLaunchForm(a);
    const problems = validateLaunchForm(form);
    if (problems.length) return problems.forEach((p) => say("kips", p, "err"));

    setPhase("busy");
    say("kips", "Simulating the launch on Robinhood Chain…", "dim");
    try {
      const p = await prepareLaunch({
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
      setPrepared(p);
      setPhase("simulated");
      const lines = [
        "Simulation passed.",
        `token     ${p.token}`,
        `you send  ${fmt(p.value)} ETH (launch fee ${fmt(e.launchFee)} ETH included)`,
        ...(p.tokensOut > 0n ? [`you get   about ${fmt(p.tokensOut)} ${a.symbol}`] : []),
        `curve     ${pct(e.configs[0].curveFeeBps)} fee · graduates at ${fmt(e.configs[0].graduationThreshold)} ETH`,
        "",
        "Type confirm to sign and launch, or cancel.",
      ];
      say("kips", lines.join("\n"), "ok");
    } catch (err) {
      setPhase("collect");
      say("kips", `Simulation failed, nothing was sent: ${errMsg(err)}`, "err");
    }
  }

  async function send() {
    if (!prepared) return;
    setPhase("busy");
    say("kips", "Confirm the transaction in your wallet…", "dim");
    try {
      const hash = await prepared.send(await getClient());
      say("kips", `Sent ${shortAddr(hash)}. Waiting for Robinhood Chain to confirm…`, "dim");
      const token = await waitForLaunch(hash);
      setPhase("done");
      say("kips", `${answersRef.current.name} is live at ${token}`, "ok");
      say("kips", "Open the agent page →", "plain", `#/agent/${token}`);
      say("kips", "Type restart to launch another agent.", "dim");
    } catch (err) {
      setPrepared(null);
      setPhase("collect");
      say("kips", `${errMsg(err)}\nNothing was launched. Type launch to try again.`, "err");
    }
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
          "launch      simulate the launch",
          "confirm     sign a simulated launch",
          "cancel      drop a simulated launch",
          "skip        skip an optional question",
          "connect     choose a wallet (connect 2 picks the second)",
          "disconnect  disconnect the wallet",
          "restart     start over",
          "Anything else is read as agent details, e.g. ticker: ATLAS.",
        ].join("\n"),
        "dim",
      );
    }
    if (cmd === "restart") {
      setAnswers({});
      answersRef.current = {};
      setPrepared(null);
      setPhase("collect");
      pending.current = "name";
      return say("kips", "Fresh start. What's the agent called?");
    }
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
    if (phase === "done") return say("kips", "This agent is launched. Type restart to launch another.", "dim");
    if (phase === "simulated") {
      if (cmd === "confirm") return send();
      if (cmd === "cancel") {
        setPrepared(null);
        setPhase("collect");
        return say("kips", "Cancelled. Nothing was sent.", "dim");
      }
    }
    if (cmd === "launch") return simulate();
    if (cmd === "cancel") return say("kips", "There is nothing to cancel.", "dim");

    // Any edit invalidates a simulated launch.
    if (prepared) {
      setPrepared(null);
      setPhase("collect");
    }

    if (cmd === "skip") {
      const k = pending.current;
      const step = k ? STEPS.find((s) => s.key === k) : null;
      if (!step || step.fallback === undefined) return say("kips", "This one is required.", "err");
      return nextQuestion(applyFields({ [step.key]: "" }));
    }

    const fields = parseIntent(text);
    const wasReady = nextToAsk(answersRef.current) === undefined;
    if (Object.keys(fields).length > 0) {
      return nextQuestion(applyFields(fields), wasReady, Object.keys(fields) as (keyof Answers)[]);
    }
    if (pending.current) {
      const step = STEPS.find((s) => s.key === pending.current)!;
      const res = answerStep(step, text, ctx());
      if (!res.ok) return say("kips", res.error, "err");
      return nextQuestion(applyFields({ [step.key]: text }));
    }
    say("kips", "I didn't find any agent details in that. Try ticker: ATLAS, or type help.", "dim");
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

  const shown = withDefaults(answers);
  const ready = missingRequired(answers).length === 0;

  return (
    <div className="lab">
      <aside className="lab-side">
        <Label n="03">The lab</Label>
        <h1>Talk to KIPS.</h1>
        <p className="muted">
          Share a name, ticker, what the agent does and a category. KIPS asks for anything missing, simulates the
          launch on Robinhood Chain, and only sends it when you type confirm.
        </p>
        <p className="lab-h">// format</p>
        <pre className="lab-box">
          <span className="muted">name:</span> Atlas{"\n"}
          <span className="muted">ticker:</span> ATLAS{"\n"}
          <span className="muted">about:</span> Trades for you{"\n"}
          <span className="muted">category:</span> trading
        </pre>
        <p className="lab-h">// try one</p>
        <div className="lab-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="lab-box lab-ex" onClick={() => submit(ex)} disabled={busy}>
              <span className="accent">›</span> {ex}
            </button>
          ))}
        </div>
        <p className="muted small">
          Commands: <b>launch</b>, <b>confirm</b>, <b>cancel</b>, <b>skip</b>, <b>help</b>. Launching sends a real
          transaction on Robinhood Chain: you pay the launch fee and gas shown in your wallet.
        </p>
      </aside>

      <section className="lab-chat">
        <div className="lab-log" ref={log} aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.who} ${m.tone ?? "plain"}`}>
              {m.who === "kips" && <span className="bubble-who">kips</span>}
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
            disabled={busy}
            aria-label="Message KIPS"
            autoFocus
          />
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
            <span>blueprint.json</span>
          </div>
          {Object.keys(answers).length === 0 ? (
            <p className="bp-empty muted">Your agent's blueprint will take shape here.</p>
          ) : (
            <pre className="bp-json">
              {"{\n"}
              {STEPS.map((s, i) => {
                const set = answers[s.key] !== undefined;
                const v = shown[s.key];
                const need = REQUIRED.includes(s.key) && !set;
                return (
                  <span key={s.key} className={need ? "bp-need" : set ? "" : "muted"}>
                    {"  "}"{LABELS[s.key]}": {need ? "…" : JSON.stringify(s.key === "wallet" && !v ? account ?? "your wallet" : v)}
                    {i < STEPS.length - 1 ? "," : ""}
                    {"\n"}
                  </span>
                );
              })}
              {"}"}
            </pre>
          )}
          <div className="bp-foot">
            {phase === "simulated" ? (
              <button className="btn btn-solid full" onClick={() => submit("confirm")} disabled={busy}>
                Confirm launch
              </button>
            ) : (
              <button className="btn btn-ghost full" onClick={() => submit("launch")} disabled={busy || !ready || phase !== "collect"}>
                {ready ? "Simulate launch" : `Needs ${missingRequired(answers).map((k) => LABELS[k]).join(", ")}`}
              </button>
            )}
            {env && <p className="muted small">Launch fee {fmt(env.launchFee)} ETH + gas</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
