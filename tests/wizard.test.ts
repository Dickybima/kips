import { describe, expect, it } from "vitest";
import { validateLaunchForm } from "../src/lib/kips/agent";
import { STEPS, answerStep, initialBuyWei, taxBps, toLaunchForm, type Answers } from "../src/lib/kips/wizard";

const ctx = { maxTaxBps: 500n };
const step = (key: keyof Answers) => STEPS.find((s) => s.key === key)!;

describe("terminal question script", () => {
  it("requires the core fields and lets optional ones be skipped", () => {
    expect(answerStep(step("name"), "  ", ctx)).toEqual({ ok: false, error: "This one is required." });
    expect(answerStep(step("name"), "skip", ctx).ok).toBe(false);
    expect(answerStep(step("skills"), "", ctx)).toEqual({ ok: true, value: "" });
    expect(answerStep(step("tax"), "skip", ctx)).toEqual({ ok: true, value: "1" });
    expect(answerStep(step("buyback"), "", ctx)).toEqual({ ok: true, value: "no" });
    expect(answerStep(step("about"), "skip", ctx)).toEqual({ ok: true, value: "" });
    expect(answerStep(step("category"), "", ctx)).toEqual({ ok: true, value: "other" });
    expect(answerStep(step("symbol"), "", ctx).ok).toBe(false);
  });
  it("normalises answers", () => {
    expect(answerStep(step("symbol"), " $atlas ", ctx)).toEqual({ ok: true, value: "ATLAS" });
    expect(answerStep(step("category"), "Trading", ctx)).toEqual({ ok: true, value: "trading" });
    expect(answerStep(step("buyback"), "Y", ctx)).toEqual({ ok: true, value: "yes" });
    expect(answerStep(step("tax"), "2.5%", ctx)).toEqual({ ok: true, value: "2.5" });
  });
  it("rejects invalid answers with a message", () => {
    expect(answerStep(step("category"), "banking", ctx).ok).toBe(false);
    expect(answerStep(step("endpoint"), "javascript:alert(1)", ctx).ok).toBe(false);
    expect(answerStep(step("wallet"), "0x123", ctx).ok).toBe(false);
    expect(answerStep(step("tax"), "6", ctx).ok).toBe(false);
    expect(answerStep(step("tax"), "-1", ctx).ok).toBe(false);
    expect(answerStep(step("buy"), "lots", ctx).ok).toBe(false);
    expect(answerStep(step("symbol"), "x".repeat(17), ctx).ok).toBe(false);
    expect(answerStep(step("symbol"), "two words", ctx).ok).toBe(false);
  });
  it("a full run of answers produces a valid launch form", () => {
    const inputs: Record<keyof Answers, string> = {
      name: "Atlas", symbol: "atlas", about: "Trades for you.", category: "trading", skills: "swaps, alerts",
      endpoint: "https://agent.example/mcp", logo: "", website: "", twitter: "", telegram: "", wallet: "",
      tax: "2", buyback: "yes", buy: "0.05",
    };
    const a = {} as Answers;
    for (const s of STEPS) {
      const r = answerStep(s, inputs[s.key], ctx);
      if (!r.ok) throw new Error(`${s.key}: ${r.error}`);
      a[s.key] = r.value;
    }
    const form = toLaunchForm(a);
    expect(validateLaunchForm(form)).toEqual([]);
    expect(form.symbol).toBe("ATLAS");
    expect(taxBps(a)).toBe(200);
    expect(initialBuyWei(a)).toBe(5n * 10n ** 16n);
  });
});
