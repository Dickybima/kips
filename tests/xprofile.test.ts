import { describe, expect, it, vi } from "vitest";
import { GET, largeAvatar, lookup, toProfile } from "../api/x-profile";
import { decodeDescription, encodeDescription, validateLaunchForm } from "../src/lib/kips/agent";
import { parseHandle, profileForm, tickerFromHandle } from "../src/lib/kips/xprofile";

const USER = {
  screen_name: "jack",
  name: "jack",
  description: "no state is the best state",
  avatar_url: "https://pbs.twimg.com/profile_images/1/abc_200x200.jpg",
  banner_url: "https://pbs.twimg.com/profile_banners/12/1",
  followers: 12_469_138,
  verification: { verified: true },
};

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("parseHandle", () => {
  it("accepts usernames, @handles and profile links", () => {
    expect(parseHandle("jack")).toBe("jack");
    expect(parseHandle(" @Robinhood_App ")).toBe("Robinhood_App");
    expect(parseHandle("x.com/jack")).toBe("jack");
    expect(parseHandle("https://twitter.com/jack?s=20")).toBe("jack");
    expect(parseHandle("https://mobile.x.com/jack/status/20")).toBe("jack");
  });
  it("rejects anything that is not a handle", () => {
    expect(parseHandle("")).toBeNull();
    expect(parseHandle("two words")).toBeNull();
    expect(parseHandle("waytoolonghandle123")).toBeNull();
    expect(parseHandle("bad-char")).toBeNull();
  });
});

describe("tickerFromHandle", () => {
  it("upper-cases and drops underscores", () => {
    expect(tickerFromHandle("jack")).toBe("JACK");
    expect(tickerFromHandle("Robinhood_App")).toBe("ROBINHOODAPP");
    expect(tickerFromHandle("___")).toBe("XPROFILE");
  });
});

describe("profileForm", () => {
  it("builds a valid launch marked as an X profile", () => {
    const p = toProfile(USER);
    const form = profileForm(p, { name: p.name, symbol: "$jack", logo: "https://www.trykips.app/api/logo?id=x.webp" });
    expect(form.symbol).toBe("JACK");
    expect(form.socials.twitter).toBe("https://x.com/jack");
    expect(validateLaunchForm(form)).toEqual([]);
    const decoded = decodeDescription(encodeDescription(form.about, form.profile));
    expect(decoded.profile?.category).toBe("profile");
    expect(decoded.about).toBe("no state is the best state");
  });
  it("keeps long bios inside the on-chain limit", () => {
    const p = toProfile({ ...USER, description: "é".repeat(3000) });
    expect(validateLaunchForm(profileForm(p, { name: p.name, symbol: "JACK", logo: "" }))).toEqual([]);
  });
});

describe("api/x-profile", () => {
  it("normalises the profile and asks for the large avatar", () => {
    const p = toProfile(USER);
    expect(p).toMatchObject({ handle: "jack", verified: true, followers: 12_469_138 });
    expect(p.avatar).toBe("https://pbs.twimg.com/profile_images/1/abc_400x400.jpg");
    expect(largeAvatar("https://x/a_normal.png")).toBe("https://x/a_400x400.png");
  });
  it("retries the flaky not-found answer before believing it", async () => {
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply(404, { code: 404, message: "User not found" }))
      .mockResolvedValueOnce(reply(200, { code: 200, user: USER }));
    const r = await lookup("jack", f, 0);
    expect(r.status).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("reports a missing account after every try says so", async () => {
    const f = vi.fn<typeof fetch>(async () => reply(404, { code: 404, message: "User not found" }));
    expect((await lookup("nobody", f, 0)).status).toBe("missing");
    expect(f).toHaveBeenCalledTimes(4);
  });
  it("rejects invalid usernames without calling out", async () => {
    const res = await GET(new Request("https://www.trykips.app/api/x-profile?u=../../etc"));
    expect(res.status).toBe(400);
  });
});

describe("top accounts", () => {
  it("ranks the readable accounts by followers and skips the rest", async () => {
    const { lookupMany } = await import("../api/x-profile");
    const f = vi.fn<typeof fetch>(async (url) => {
      const h = String(url).split("/").pop();
      if (h === "gone") return reply(404, { code: 404, message: "User not found" });
      const followers = { small: 10, big: 5_000 }[h as "small" | "big"];
      return reply(200, { user: { ...USER, screen_name: h, followers } });
    });
    const out = await lookupMany(["small", "gone", "big"], f, 0, 2);
    expect(out.map((p) => p.handle)).toEqual(["big", "small"]);
  });
});
