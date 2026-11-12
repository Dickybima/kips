import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, toFunctionSelector, zeroAddress, zeroHash } from "viem";
import {
  KIPS_TAG,
  LIMITS,
  decodeDescription,
  encodeDescription,
  normalizeSkills,
  safeUrl,
  validateLaunchForm,
  type LaunchForm,
} from "../src/lib/kips/agent";
import { factoryAbi, routerAbi } from "../src/lib/pons/abi";

const profile = { category: "trading" as const, skills: ["Swaps", " alerts ", "swaps"], endpoint: "https://a.example/mcp" };

describe("agent description trailer", () => {
  it("round-trips the profile and keeps the human text clean", () => {
    const d = encodeDescription("Trades for you.\nSecond line.", profile);
    expect(d.startsWith("Trades for you.\nSecond line.\n\n" + KIPS_TAG)).toBe(true);
    expect(decodeDescription(d)).toEqual({
      about: "Trades for you.\nSecond line.",
      profile: { category: "trading", skills: ["swaps", "alerts"], endpoint: "https://a.example/mcp" },
    });
  });
  it("treats plain Pons tokens and malformed trailers as non-agents", () => {
    expect(decodeDescription("just a memecoin")).toEqual({ about: "just a memecoin", profile: null });
    expect(decodeDescription(`x ${KIPS_TAG}{not json`).profile).toBeNull();
    expect(decodeDescription(`x ${KIPS_TAG}"str"`).profile).toBeNull();
  });
  it("sanitises untrusted on-chain profile fields", () => {
    const d = decodeDescription(`${KIPS_TAG}{"c":"evil","s":["ok",5,"${"x".repeat(60)}"],"e":7}`);
    expect(d.profile).toEqual({ category: "other", skills: ["ok", "x".repeat(32)], endpoint: "" });
  });
  it("caps skills at eight", () => {
    expect(normalizeSkills("a,b,c,d,e,f,g,h,i,j")).toHaveLength(8);
  });
});

describe("safeUrl", () => {
  it("allows only http(s) and ipfs", () => {
    expect(safeUrl("https://x.example/a.png")).toBe("https://x.example/a.png");
    expect(safeUrl("ipfs://bafy123")).toBe("https://ipfs.io/ipfs/bafy123");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });
});

describe("validateLaunchForm", () => {
  const ok: LaunchForm = {
    name: "Atlas",
    symbol: "ATLAS",
    logo: "",
    about: "An agent.",
    profile,
    socials: { twitter: "", telegram: "", discord: "", website: "" },
  };
  it("accepts a minimal form", () => expect(validateLaunchForm(ok)).toEqual([]));
  it("enforces Pons byte limits, counting the profile trailer", () => {
    expect(validateLaunchForm({ ...ok, name: "", symbol: "" })).toHaveLength(2);
    expect(validateLaunchForm({ ...ok, symbol: "é".repeat(9) })).toHaveLength(1);
    expect(validateLaunchForm({ ...ok, about: "a".repeat(LIMITS.description) })).toHaveLength(1);
    expect(validateLaunchForm({ ...ok, logo: "ftp://x" })).toHaveLength(1);
  });
});

describe("Pons v2 ABI", () => {
  const params = {
    name: "Atlas",
    symbol: "ATLAS",
    logo: "",
    description: encodeDescription("An agent.", profile),
    socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
    creatorFeeRecipient: zeroAddress,
    creatorTaxBps: 100,
    buybackEnabled: false,
    expectedEconomics: zeroHash,
    salt: zeroHash,
  };
  const tuple = "(string,string,string,string,(string,string,string,string,string),address,uint16,bool,bytes32,bytes32)";

  it("encodes launchToken with the on-chain signature", () => {
    const data = encodeFunctionData({ abi: factoryAbi, functionName: "launchToken", args: [params, 0n, zeroAddress, []] });
    expect(data.slice(0, 10)).toBe(toFunctionSelector(`launchToken(${tuple},uint256,address,address[])`));
    const decoded = decodeFunctionData({ abi: factoryAbi, data });
    expect(decodeDescription((decoded.args[0] as typeof params).description).profile?.category).toBe("trading");
  });
  it("encodes launchAndBuy with the on-chain signature", () => {
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: "launchAndBuy",
      args: [params, 0n, zeroAddress, 1n, 0n, zeroAddress, [zeroAddress]],
    });
    expect(data.slice(0, 10)).toBe(
      toFunctionSelector(`launchAndBuy(${tuple},uint256,address,uint256,uint256,address,address[])`),
    );
  });
});
