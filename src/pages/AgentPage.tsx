import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import { safeUrl } from "../lib/kips/agent";
import { errMsg, fmt, parseAmount, pct, shortAddr } from "../lib/format";
import { NATIVE_QUOTE, explorerLink } from "../lib/pons/chain";
import {
  graduationProgressBps,
  minTokensOutForBuy,
  minWithSlippage,
  quoteBuy,
  quoteSell,
} from "../lib/pons/quote";
import {
  readBalances,
  readCurveState,
  readLaunched,
  readTokenMeta,
  type CurveState,
  type Launched,
  type TokenMeta,
} from "../lib/pons/read";
import { buy, sell } from "../lib/pons/write";
import { useWallet } from "../lib/wallet";
import { Logo } from "./Explore";

const SLIPPAGE_BPS = 300n;
const REFRESH_MS = 8000;
const WAD = 10n ** 18n;

export function AgentPage({ token }: { token: Address }) {
  const { account } = useWallet();
  const [launched, setLaunched] = useState<Launched | null | undefined>(undefined);
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [curve, setCurve] = useState<CurveState | null>(null);
  const [balances, setBalances] = useState<{ eth: bigint; tokens: bigint; supply: bigint } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([readLaunched(token), readTokenMeta(token).catch(() => null)]).then(
      ([l, m]) => {
        if (!live) return;
        setLaunched(l);
        setMeta(m);
      },
      (e) => live && setError(errMsg(e)),
    );
    return () => {
      live = false;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    if (!launched) return;
    const [c, b] = await Promise.all([
      readCurveState(launched.curve, account),
      account ? readBalances(token, account) : null,
    ]);
    setCurve(c);
    setBalances(b);
  }, [launched, account, token]);

  useEffect(() => {
    if (!launched) return;
    let live = true;
    const tick = () => refresh().catch((e) => live && setError(errMsg(e)));
    void tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [launched, refresh]);

  if (error && launched === undefined) return <p className="note bad">Could not read this token: {error}</p>;
  if (launched === undefined) return <p className="muted">Loading agent…</p>;
  if (launched === null) {
    return (
      <p className="note bad">
        <code>{token}</code> is not a Pons v2 launch.
      </p>
    );
  }

  const onCurve = launched.phase === 0 && curve !== null && !curve.graduated;
  const priceWei = curve && curve.tokenReserve > 0n ? (curve.quoteReserve * WAD) / curve.tokenReserve : null;
  const progress = curve ? graduationProgressBps(curve.realQuoteReserve, launched.graduationThreshold) : 0;
  const tokenUrl = explorerLink("address", token);
  const endpoint = meta?.profile ? safeUrl(meta.profile.endpoint) : null;
  const links = meta
    ? ([
        ["Website", meta.socials.website],
        ["X", meta.socials.twitter],
        ["Telegram", meta.socials.telegram],
        ["Discord", meta.socials.discord],
      ] as const)
        .map(([label, raw]) => [label, safeUrl(raw)] as const)
        .filter((l): l is readonly [typeof l[0], string] => l[1] !== null)
    : [];

  return (
    <div className="two">
      <section className="panel">
        <div className="row">
          <Logo url={meta?.logo ?? ""} symbol={meta?.symbol ?? "?"} />
          <div className="grow">
            <h2>{meta?.name ?? shortAddr(token)}</h2>
            <div className="muted">
              ${meta?.symbol ?? "?"} ·{" "}
              {tokenUrl ? (
                <a href={tokenUrl} target="_blank" rel="noopener noreferrer">
                  {shortAddr(token)}
                </a>
              ) : (
                <code>{token}</code>
              )}
            </div>
          </div>
          {meta?.profile ? (
            <span className="tag accent">{meta.profile.category}</span>
          ) : (
            <span className="tag">Pons v2 token</span>
          )}
        </div>

        {!meta?.profile && (
          <p className="note">This token was launched on Pons v2 without a KIPS agent profile.</p>
        )}
        <p className="pre">{meta?.about || "No description."}</p>

        {meta?.profile && meta.profile.skills.length > 0 && (
          <div className="tags">
            {meta.profile.skills.map((s) => (
              <span className="tag" key={s}>
                {s}
              </span>
            ))}
          </div>
        )}

        <dl>
          {endpoint && (
            <>
              <dt>Agent endpoint</dt>
              <dd>
                <a href={endpoint} target="_blank" rel="noopener noreferrer">
                  {endpoint}
                </a>
              </dd>
            </>
          )}
          <dt>Agent wallet (fee recipient)</dt>
          <dd>{shortAddr(launched.creatorFeeRecipient)}</dd>
          <dt>Launched by</dt>
          <dd>{shortAddr(launched.deployer)}</dd>
          <dt>Creator fee</dt>
          <dd>{pct(launched.creatorTaxBps)}</dd>
          <dt>Buyback</dt>
          <dd>{launched.buybackEnabled ? "On" : "Off"}</dd>
        </dl>

        {links.length > 0 && (
          <div className="tags">
            {links.map(([label, url]) => (
              <a className="tag" key={label} href={url} target="_blank" rel="noopener noreferrer">
                {label} ↗
              </a>
            ))}
          </div>
        )}
      </section>

      <aside className="panel">
        <h3>Bonding curve</h3>
        <div className="meter" role="progressbar" aria-valuenow={progress / 100} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${progress / 100}%` }} />
        </div>
        <dl>
          <dt>Progress to graduation</dt>
          <dd>{pct(progress)}</dd>
          <dt>Raised</dt>
          <dd>
            {curve ? fmt(curve.realQuoteReserve) : "…"} / {fmt(launched.graduationThreshold)} ETH
          </dd>
          <dt>Price</dt>
          <dd>{priceWei !== null ? `${fmt(priceWei, 6)} ETH` : "…"}</dd>
          {priceWei !== null && balances && (
            <>
              <dt>Market cap</dt>
              <dd>{fmt((priceWei * balances.supply) / WAD)} ETH</dd>
            </>
          )}
        </dl>

        {launched.pairToken !== NATIVE_QUOTE ? (
          <p className="note">This curve is paired with a token other than ETH. KIPS only trades ETH pairs for now.</p>
        ) : !curve ? (
          <p className="muted">Reading curve…</p>
        ) : !onCurve ? (
          <p className="note">
            This token has graduated from its bonding curve. It now trades in its Uniswap v4 pool on Robinhood Chain.
          </p>
        ) : curve.readyToGraduate ? (
          <p className="note">The curve is sold out and waiting to graduate to Uniswap v4.</p>
        ) : (
          <Trade
            token={token}
            curveAddress={launched.curve}
            curve={curve}
            symbol={meta?.symbol ?? "tokens"}
            balances={balances}
            onDone={refresh}
          />
        )}
        {error && <p className="note bad">{error}</p>}
      </aside>
    </div>
  );
}

function Trade(props: {
  token: Address;
  curveAddress: Address;
  curve: CurveState;
  symbol: string;
  balances: { eth: bigint; tokens: bigint } | null;
  onDone: () => Promise<void>;
}) {
  const { token, curveAddress, curve, symbol, balances, onDone } = props;
  const { account, connect, getClient } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const amount = parseAmount(input);

  const quote = useMemo(() => {
    if (amount === null) return null;
    try {
      if (side === "buy") {
        const q = quoteBuy(curve, curve.sellable, amount, curve.feeBps, curve.creatorTaxBps, curve.snipeTaxBps);
        return { side, q, out: q.tokensOut, min: minTokensOutForBuy(amount, q, SLIPPAGE_BPS) } as const;
      }
      const q = quoteSell(curve, amount, curve.feeBps, curve.creatorTaxBps);
      return { side, q, out: q.quoteOut, min: minWithSlippage(q.quoteOut, SLIPPAGE_BPS) } as const;
    } catch (e) {
      return { error: errMsg(e) } as const;
    }
  }, [amount, side, curve]);

  const balance = balances ? (side === "buy" ? balances.eth : balances.tokens) : null;
  const overBalance = amount !== null && balance !== null && amount > balance;
  const ready = !!account && quote !== null && !("error" in quote) && !overBalance && !busy;

  async function submit() {
    if (!account || amount === null || !quote || "error" in quote) return;
    setBusy(true);
    setStatus(null);
    try {
      const wallet = await getClient();
      if (quote.side === "buy") await buy(wallet, account, curveAddress, amount, quote.min);
      else await sell(wallet, account, token, curveAddress, amount, quote.min);
      setInput("");
      setStatus({ ok: true, text: quote.side === "buy" ? "Buy confirmed." : "Sell confirmed." });
      await onDone();
    } catch (e) {
      setStatus({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  const inUnit = side === "buy" ? "ETH" : symbol;
  const outUnit = side === "buy" ? symbol : "ETH";

  return (
    <div className="trade">
      <div className="seg full">
        <button className={side === "buy" ? "on" : ""} onClick={() => (setSide("buy"), setInput(""))}>
          Buy
        </button>
        <button className={side === "sell" ? "on" : ""} onClick={() => (setSide("sell"), setInput(""))}>
          Sell
        </button>
      </div>
      <label className="field">
        <span>
          Amount ({inUnit})
          {balance !== null && (
            <em>
              balance {fmt(balance)}
              {side === "sell" && balance > 0n && (
                <button type="button" className="link" onClick={() => setInput(formatUnits(balance, 18))}>
                  max
                </button>
              )}
            </em>
          )}
        </span>
        <input inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0.0" />
      </label>

      {quote && "error" in quote && <p className="note bad">{quote.error}</p>}
      {quote && !("error" in quote) && (
        <dl>
          <dt>You receive about</dt>
          <dd>
            {fmt(quote.out)} {outUnit}
          </dd>
          <dt>Fees (protocol + creator)</dt>
          <dd>{fmt(quote.q.fee + quote.q.tax, 6)} ETH</dd>
          {quote.side === "buy" && quote.q.snipeTax > 0n && (
            <>
              <dt>Launch snipe tax ({pct(quote.q.snipeTaxBps)})</dt>
              <dd>{fmt(quote.q.snipeTax, 6)} ETH</dd>
            </>
          )}
          {quote.side === "buy" && quote.q.refund > 0n && (
            <>
              <dt>Refunded (curve sells out)</dt>
              <dd>{fmt(quote.q.refund)} ETH</dd>
            </>
          )}
          <dt>Max slippage</dt>
          <dd>{pct(SLIPPAGE_BPS)}</dd>
        </dl>
      )}
      {overBalance && <p className="note bad">Amount is more than your balance.</p>}

      {account ? (
        <button className="btn primary full" disabled={!ready} onClick={() => void submit()}>
          {busy ? "Confirm in wallet…" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
        </button>
      ) : (
        <button className="btn primary full" onClick={() => connect().catch((e) => setStatus({ ok: false, text: errMsg(e) }))}>
          Connect wallet to trade
        </button>
      )}
      {status && <p className={status.ok ? "note good" : "note bad"}>{status.text}</p>}
    </div>
  );
}
