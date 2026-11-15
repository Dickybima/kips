import { describe, expect, it } from "vitest";
import { esc, sharePage } from "../api/share";
import { clip, short, splitDescription } from "../api/og";

const T = "0xd1F91331F3c9CE8b4C4E265392c27Afb90a7f82C";

describe("share page", () => {
  it("points previews at the token's card and sends people to the token page", () => {
    const html = sharePage(T, "Kips", "KIPS", "Your agent works.");
    expect(html).toContain(`<meta property="og:image" content="https://www.trykips.app/api/og?token=${T}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`url=https://www.trykips.app/#/agent/${T}`);
    expect(html).toContain("<title>Kips ($KIPS) on KIPS</title>");
  });
  it("escapes on-chain text so it cannot inject markup", () => {
    const html = sharePage(T, '"><script>alert(1)</script>', "X</title>", "a <img src=x onerror=alert(1)> b");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("X</title>");
    expect(esc(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("card helpers", () => {
  it("formats amounts for the card", () => {
    expect(short(339_800_000_000_000_000n)).toBe("0.3398");
    expect(short(1n)).toBe("0");
    expect(short(17_028_230n * 10n ** 18n)).toBe("17.03M");
    expect(short(2_430_000_000_000_000_000n)).toBe("2.43");
  });
  it("splits the KIPS profile off the description", () => {
    expect(splitDescription('Hello\n\n[kips:1]{"c":"profile","s":[]}')).toEqual({ about: "Hello", category: "profile" });
    expect(splitDescription("plain")).toEqual({ about: "plain", category: null });
  });
  it("clips long text on a word boundary", () => {
    expect(clip("one two three four", 12)).toBe("one two…");
    expect(clip("short", 12)).toBe("short");
  });
});
