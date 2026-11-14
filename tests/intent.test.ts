import { describe, expect, it } from "vitest";
import { parseIntent, parseQuick } from "../src/lib/kips/intent";

describe("parseIntent", () => {
  it("reads key: value pairs on one line or many", () => {
    expect(parseIntent("name: Atlas ticker: ATLAS x: @atlas website: atlas.xyz")).toEqual({
      name: "Atlas",
      symbol: "ATLAS",
      twitter: "https://x.com/atlas",
      website: "https://atlas.xyz",
    });
    expect(parseIntent("name: Atlas\nticker: $atlas\ncategory: trading")).toEqual({
      name: "Atlas",
      symbol: "atlas",
      category: "trading",
    });
  });
  it("reads the loose form without colons", () => {
    expect(parseIntent("agent Atlas ticker ATLAS x x.com/atlas web atlas.io")).toEqual({
      name: "Atlas",
      symbol: "ATLAS",
      twitter: "https://x.com/atlas",
      website: "https://atlas.io",
    });
    expect(parseIntent("token Test")).toEqual({ name: "Test" });
  });
  it("keeps descriptions intact when colons are used", () => {
    expect(parseIntent("about: Trades on the web for x users, fast. category: trading")).toEqual({
      about: "Trades on the web for x users, fast.",
      category: "trading",
    });
  });
  it("normalises telegram, endpoint and keeps full URLs", () => {
    expect(parseIntent("tg: @atlasgroup endpoint: api.atlas.dev/mcp logo: ipfs://bafy")).toEqual({
      telegram: "https://t.me/atlasgroup",
      endpoint: "https://api.atlas.dev/mcp",
      logo: "ipfs://bafy",
    });
    expect(parseIntent("x: https://x.com/atlas")).toEqual({ twitter: "https://x.com/atlas" });
  });
  it("returns nothing for plain chat", () => {
    expect(parseIntent("hello there")).toEqual({});
  });
});

describe("parseQuick", () => {
  it("reads name, $ticker and an optional description", () => {
    expect(parseQuick("Atlas $ATLAS Finds momentum and trades it")).toEqual({
      name: "Atlas",
      symbol: "ATLAS",
      about: "Finds momentum and trades it",
    });
    expect(parseQuick("Market Scout ($SCOUT) - watches new launches")).toEqual({
      name: "Market Scout",
      symbol: "SCOUT",
      about: "watches new launches",
    });
    expect(parseQuick("Echo $echo")).toEqual({ name: "Echo", symbol: "echo" });
  });
  it("ignores messages without a name before the ticker", () => {
    expect(parseQuick("$ATLAS")).toEqual({});
    expect(parseQuick("hello there")).toEqual({});
    expect(parseQuick("name: Atlas")).toEqual({});
  });
});
