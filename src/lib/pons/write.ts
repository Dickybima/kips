import { parseEventLogs, toHex, type Address, type Hex, type WalletClient } from "viem";
import { curveAbi, factoryAbi, routerAbi, tokenAbi } from "./abi";
import { NATIVE_QUOTE, PONS, publicClient, robinhoodChain } from "./chain";
import { minWithSlippage } from "./quote";
import { encodeDescription, type LaunchForm } from "../kips/agent";

export interface LaunchRequest {
  form: LaunchForm;
  account: Address;
  /** Receives the creator tax. For kips this is the agent's own wallet. */
  creatorFeeRecipient: Address;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  launchConfigId: bigint;
  launchFee: bigint;
  /** ETH spent on the creator's first buy, in wei. 0 launches without buying. */
  initialBuy: bigint;
  slippageBps: bigint;
}

export interface PreparedLaunch {
  token: Address;
  curve: Address;
  /** Tokens the initial buy is simulated to receive (0 when not buying). */
  tokensOut: bigint;
  value: bigint;
  send: (wallet: WalletClient) => Promise<Hex>;
}

function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Builds the launch and simulates it against current chain state. Nothing is
 * signed here: the caller shows the simulated result, then calls `send`.
 */
export async function prepareLaunch(req: LaunchRequest): Promise<PreparedLaunch> {
  const { form, account } = req;
  // Commits the launch to the economics the user was shown; the factory
  // reverts if the config changes before the transaction lands.
  const expectedEconomics = await publicClient.readContract({
    address: PONS.factory,
    abi: factoryAbi,
    functionName: "previewLaunchEconomics",
    args: [req.launchConfigId, NATIVE_QUOTE],
  });
  const params = {
    name: form.name.trim(),
    symbol: form.symbol.trim(),
    logo: form.logo.trim(),
    description: encodeDescription(form.about, form.profile),
    socials: {
      twitter: form.socials.twitter.trim(),
      telegram: form.socials.telegram.trim(),
      discord: form.socials.discord.trim(),
      website: form.socials.website.trim(),
      farcaster: "",
    },
    creatorFeeRecipient: req.creatorFeeRecipient,
    creatorTaxBps: req.creatorTaxBps,
    buybackEnabled: req.buybackEnabled,
    expectedEconomics,
    salt: randomSalt(),
  };

  if (req.initialBuy === 0n) {
    const call = {
      address: PONS.factory,
      abi: factoryAbi,
      functionName: "launchToken",
      args: [params, req.launchConfigId, NATIVE_QUOTE, []],
      value: req.launchFee,
      account,
    } as const;
    const { result } = await publicClient.simulateContract(call);
    return {
      token: result[0],
      curve: result[1],
      tokensOut: 0n,
      value: call.value,
      send: (wallet) => wallet.writeContract({ ...call, chain: robinhoodChain }),
    };
  }

  // The creator's own first buy is exempted from the launch snipe tax.
  const exemptions = [account];
  const base = {
    address: PONS.launchAndBuyRouter,
    abi: routerAbi,
    functionName: "launchAndBuy",
    value: req.launchFee + req.initialBuy,
    account,
  } as const;
  const { result } = await publicClient.simulateContract({
    ...base,
    args: [params, req.launchConfigId, NATIVE_QUOTE, req.initialBuy, 0n, account, exemptions],
  });
  const tokensOut = result[2];
  const minTokensOut = minWithSlippage(tokensOut, req.slippageBps);
  return {
    token: result[0],
    curve: result[1],
    tokensOut,
    value: base.value,
    send: (wallet) =>
      wallet.writeContract({
        ...base,
        args: [params, req.launchConfigId, NATIVE_QUOTE, req.initialBuy, minTokensOut, account, exemptions],
        chain: robinhoodChain,
      }),
  };
}

/** Waits for the launch and returns the token address from its TokenLaunched event. */
export async function waitForLaunch(hash: Hex): Promise<Address> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Launch transaction reverted.");
  const [log] = parseEventLogs({ abi: factoryAbi, eventName: "TokenLaunched", logs: receipt.logs });
  if (!log) throw new Error("Launch confirmed but no TokenLaunched event was found.");
  return log.args.token;
}

async function confirm(hash: Hex): Promise<Hex> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted.");
  return hash;
}

export async function buy(wallet: WalletClient, account: Address, curve: Address, quoteIn: bigint, minTokensOut: bigint) {
  const { request } = await publicClient.simulateContract({
    address: curve,
    abi: curveAbi,
    functionName: "buy",
    args: [quoteIn, minTokensOut, account],
    value: quoteIn,
    account,
  });
  return confirm(await wallet.writeContract(request));
}

export async function sell(
  wallet: WalletClient,
  account: Address,
  token: Address,
  curve: Address,
  tokensIn: bigint,
  minQuoteOut: bigint,
) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "allowance",
    args: [account, curve],
  });
  if (allowance < tokensIn) {
    // Approve exactly what this sell needs rather than an unlimited allowance.
    const { request } = await publicClient.simulateContract({
      address: token,
      abi: tokenAbi,
      functionName: "approve",
      args: [curve, tokensIn],
      account,
    });
    await confirm(await wallet.writeContract(request));
  }
  const { request } = await publicClient.simulateContract({
    address: curve,
    abi: curveAbi,
    functionName: "sell",
    args: [tokensIn, minQuoteOut, account],
    account,
  });
  return confirm(await wallet.writeContract(request));
}
