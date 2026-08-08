import { createPublicClient, formatUnits, getAddress, http, type Address, type PublicClient } from "viem";
import { isValidClassicAddress } from "xrpl";
import {
  assetManagerAbi,
  erc20ReadAbi,
  masterAccountControllerAbi,
  registryAbi,
  standingAbi,
} from "./abis.js";
import { coston2, defaultStandingAddress, registryAddress } from "./config.js";
import {
  buildStandingCalls,
  calculateDirectMintPayment,
  encodeHashInstruction,
  parseDeposit,
} from "./protocol.js";

export type AtomicSubscribePreview = {
  network: "Coston2";
  chainId: 114;
  xrplSource: string;
  xrplDestination: string;
  destinationTag: null;
  personalAccount: Address;
  standing: Address;
  fxrp: Address;
  assetManager: Address;
  plan: {
    id: string;
    merchant: Address;
    active: true;
    periodSeconds: number;
    priceUsdMicro: string;
    priceFxrpAtomic: string;
  };
  deposit: { display: string; atomic: string; decimals: number };
  nonce: string;
  payment: {
    netMintUBA: string;
    mintingFeeUBA: string;
    executorFeeUBA: string;
    totalPaymentUBA: string;
    totalPaymentXrp: string;
  };
  instruction: {
    opcode: "0xFE";
    memoBytes: 42;
    smartAccountExecutorFeeUBA: "0";
    memoData: `0x${string}`;
    packedUserOperation: `0x${string}`;
    userOperationHash: `0x${string}`;
    calls: readonly { target: Address; value: "0"; data: `0x${string}` }[];
  };
  readiness: "READY" | "BLOCKED";
  checks: {
    standingUnpaused: true;
    planActive: true;
    fxrpDecimals: 6;
    personalAccountHasC2Flr: boolean;
    personalAccountC2FlrAtomic: string;
  };
  authorization: "NOT_SENT";
};

export function createCoston2Client(rpcUrl = process.env.COSTON2_RPC_URL ?? coston2.rpcUrls.default.http[0]) {
  return createPublicClient({ chain: coston2, transport: http(rpcUrl) });
}

export async function buildAtomicSubscribePreview(input: {
  xrplAddress: string;
  planId: bigint;
  deposit: string;
  standing?: Address;
  client?: PublicClient;
}): Promise<AtomicSubscribePreview> {
  if (!isValidClassicAddress(input.xrplAddress)) throw new Error("XRPL_ADDRESS must be a valid classic address");
  if (input.planId <= 0n) throw new Error("PLAN_ID must be positive");

  const client = input.client ?? createCoston2Client();
  const standing = getAddress(input.standing ?? defaultStandingAddress);
  const [masterAccountController, assetManager] = await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "getContractAddressByName",
      args: ["MasterAccountController"],
    }),
    client.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "getContractAddressByName",
      args: ["AssetManagerFXRP"],
    }),
  ]);

  const [personalAccount, fxrp, xrplDestination, executorFeeUBA, feeBips, minimumFeeUBA, paused, plan] =
    await Promise.all([
      client.readContract({
        address: masterAccountController,
        abi: masterAccountControllerAbi,
        functionName: "getPersonalAccount",
        args: [input.xrplAddress],
      }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "fAsset" }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "directMintingPaymentAddress" }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingExecutorFeeUBA" }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingFeeBIPS" }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingMinimumFeeUBA" }),
      client.readContract({ address: standing, abi: standingAbi, functionName: "paused" }),
      client.readContract({ address: standing, abi: standingAbi, functionName: "plans", args: [input.planId] }),
    ]);

  if (paused) throw new Error("Standing is paused");
  const [merchant, priceUsdMicro, priceFxrp, periodSeconds, active] = plan;
  if (!active || merchant === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Standing plan ${input.planId} is not active`);
  }

  const [decimals, nonce, nativeBalance] = await Promise.all([
    client.readContract({ address: fxrp, abi: erc20ReadAbi, functionName: "decimals" }),
    client.readContract({
      address: masterAccountController,
      abi: masterAccountControllerAbi,
      functionName: "getNonce",
      args: [personalAccount],
    }),
    client.getBalance({ address: personalAccount }),
  ]);
  if (decimals !== 6) throw new Error(`FXRP decimals mismatch: expected 6, got ${decimals}`);
  const depositAtomic = parseDeposit(input.deposit, decimals);
  if (priceFxrp > 0n && depositAtomic < priceFxrp) {
    throw new Error(`deposit ${depositAtomic} is below the fixed first charge ${priceFxrp}`);
  }
  const calls = buildStandingCalls({ fxrp, standing, planId: input.planId, depositAtomic });
  // This is the Smart Account instruction fee, not AssetManager's direct-mint
  // executor fee. Flare's official 0xFE starter encodes zero here while adding
  // the separate direct-mint executor fee to the XRPL payment below.
  const encoded = encodeHashInstruction({ calls, sender: personalAccount, nonce, executorFeeUBA: 0n });
  const payment = calculateDirectMintPayment(depositAtomic, { executorFeeUBA, feeBips, minimumFeeUBA });

  return {
    network: "Coston2",
    chainId: 114,
    xrplSource: input.xrplAddress,
    xrplDestination,
    destinationTag: null,
    personalAccount,
    standing,
    fxrp,
    assetManager,
    plan: {
      id: input.planId.toString(),
      merchant,
      active: true,
      periodSeconds,
      priceUsdMicro: priceUsdMicro.toString(),
      priceFxrpAtomic: priceFxrp.toString(),
    },
    deposit: { display: input.deposit, atomic: depositAtomic.toString(), decimals },
    nonce: nonce.toString(),
    payment: {
      netMintUBA: depositAtomic.toString(),
      mintingFeeUBA: payment.mintingFeeUBA.toString(),
      executorFeeUBA: executorFeeUBA.toString(),
      totalPaymentUBA: payment.totalPaymentUBA.toString(),
      totalPaymentXrp: formatUnits(payment.totalPaymentUBA, 6),
    },
    instruction: {
      opcode: "0xFE",
      memoBytes: 42,
      smartAccountExecutorFeeUBA: "0",
      memoData: encoded.memoData,
      packedUserOperation: encoded.data,
      userOperationHash: encoded.userOperationHash,
      calls: calls.map((call) => ({ target: call.target, value: "0", data: call.data })),
    },
    readiness: nativeBalance > 0n ? "READY" : "BLOCKED",
    checks: {
      standingUnpaused: true,
      planActive: true,
      fxrpDecimals: 6,
      personalAccountHasC2Flr: nativeBalance > 0n,
      personalAccountC2FlrAtomic: nativeBalance.toString(),
    },
    authorization: "NOT_SENT",
  };
}
