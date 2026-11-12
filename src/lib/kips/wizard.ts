// The question script behind the KIPS terminal. Pure data and functions so the
// conversation can be tested without a browser.
import { isAddress } from "viem";
import { CATEGORIES, LIMITS, byteLength, safeUrl, type Category, type LaunchForm } from "./agent";
import { parseAmount } from "../format";

export interface Answers {
  name: string;
  symbol: string;
  about: string;
  category: string;
  skills: string;
  endpoint: string;
  logo: string;
  website: string;
  twitter: string;
  telegram: string;
  wallet: string;
  tax: string;
  buyback: string;
  buy: string;
}

export interface WizardContext {
  /** Protocol cap on the creator fee, in basis points; null while unknown. */
  maxTaxBps: bigint | null;
}

export interface Step {
  key: keyof Answers;
  ask: (ctx: WizardContext) => string;
  /** Used when the user presses enter or types "skip". Without one the step is required. */
  fallback?: string;
  /** Normalises the answer; throws an Error with a user-facing message when invalid. */
  parse: (raw: string, ctx: WizardContext) => string;
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

const text = (label: string, max: number) => (raw: string) =>
  byteLength(raw) > max ? fail(`${label} is too long (max ${max} bytes).`) : raw;

const url = (label: string) => (raw: string) => (safeUrl(raw) ? raw : fail(`${label} must be an http(s) URL.`));

export const STEPS: Step[] = [
  { key: "name", ask: () => "What is your agent called?", parse: text("Name", LIMITS.name) },
  {
    key: "symbol",
    ask: () => "Ticker?",
    parse: (raw) =>
      /\s/.test(raw) ? fail("A ticker cannot contain spaces.") : text("Ticker", LIMITS.symbol)(raw.replace(/^\$/, "").toUpperCase()),
  },
  { key: "about", ask: () => "What does it do? Describe it in one message.", parse: (raw) => raw },
  {
    key: "category",
    ask: () => `Category? ${CATEGORIES.join(" / ")}`,
    parse: (raw) =>
      CATEGORIES.includes(raw.toLowerCase() as Category) ? raw.toLowerCase() : fail(`Pick one of: ${CATEGORIES.join(", ")}.`),
  },
  { key: "skills", ask: () => "Skills, comma separated? (enter to skip)", fallback: "", parse: (raw) => raw },
  {
    key: "endpoint",
    ask: () => "Agent endpoint — an API, MCP or A2A URL? (enter to skip)",
    fallback: "",
    parse: url("Endpoint"),
  },
  {
    key: "logo",
    ask: () => "Logo URL, https:// or ipfs://? (enter to skip)",
    fallback: "",
    parse: (raw) => (safeUrl(raw) ? text("Logo URL", LIMITS.logo)(raw) : fail("Logo must be an http(s) or ipfs:// URL.")),
  },
  { key: "website", ask: () => "Website? (enter to skip)", fallback: "", parse: text("Website", LIMITS.social) },
  { key: "twitter", ask: () => "X / Twitter link? (enter to skip)", fallback: "", parse: text("X link", LIMITS.social) },
  { key: "telegram", ask: () => "Telegram link? (enter to skip)", fallback: "", parse: text("Telegram link", LIMITS.social) },
  {
    key: "wallet",
    ask: () => "Agent wallet that earns the creator fees? (enter to use your own wallet)",
    fallback: "",
    parse: (raw) => (isAddress(raw) ? raw : fail("That is not a valid address.")),
  },
  {
    key: "tax",
    ask: (ctx) =>
      `Creator fee % on every trade?${ctx.maxTaxBps !== null ? ` Max ${Number(ctx.maxTaxBps) / 100}.` : ""} (enter for 1)`,
    fallback: "1",
    parse: (raw, ctx) => {
      const n = Number(raw.replace(/%$/, ""));
      if (!Number.isFinite(n) || n < 0) fail("Enter a number, for example 1.");
      if (ctx.maxTaxBps !== null && Math.round(n * 100) > Number(ctx.maxTaxBps)) {
        fail(`The protocol caps the creator fee at ${Number(ctx.maxTaxBps) / 100}%.`);
      }
      return String(n);
    },
  },
  {
    key: "buyback",
    ask: () => "Enable Pons buyback? Part of the trading fees buys back and locks the token. yes / no (enter for no)",
    fallback: "no",
    parse: (raw) => {
      const v = raw.toLowerCase();
      return v === "yes" || v === "y" ? "yes" : v === "no" || v === "n" ? "no" : fail("Answer yes or no.");
    },
  },
  {
    key: "buy",
    ask: () => "Initial buy in ETH, made in the launch transaction? (enter for none)",
    fallback: "",
    parse: (raw) => (parseAmount(raw) !== null ? raw : fail("Enter an ETH amount, for example 0.05.")),
  },
];

export type StepResult = { ok: true; value: string } | { ok: false; error: string };

export function answerStep(step: Step, raw: string, ctx: WizardContext): StepResult {
  const input = raw.trim();
  if (input === "" || input.toLowerCase() === "skip") {
    return step.fallback !== undefined ? { ok: true, value: step.fallback } : { ok: false, error: "This one is required." };
  }
  try {
    return { ok: true, value: step.parse(input, ctx) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function toLaunchForm(a: Answers): LaunchForm {
  return {
    name: a.name,
    symbol: a.symbol,
    logo: a.logo,
    about: a.about,
    profile: { category: a.category as Category, skills: a.skills.split(","), endpoint: a.endpoint },
    socials: { twitter: a.twitter, telegram: a.telegram, discord: "", website: a.website },
  };
}

export const taxBps = (a: Answers) => Math.round(Number(a.tax) * 100);
export const initialBuyWei = (a: Answers) => (a.buy ? (parseAmount(a.buy) ?? 0n) : 0n);
