import { createPublicClient, formatUnits, getAddress, http, type Address, type PublicClient } from "viem";
import { isValidClassicAddress } from "xrpl";
import {
  assetManagerAbi,
  erc20ReadAbi,
  masterAccountControllerAbi,
  priceAdapterAbi,
  registryAbi,
  standingAbi,
} from "./abis.js";
import { coston2, registryAddress } from "./config.js";
import {
  buildStandingCalls,
  calculateDirectMintPayment,
  encodeHashInstruction,
  parseDeposit,
} from "./protocol.js";
import { requireStandingFxrpBinding, requireStandingV2 } from "./standing-v2.js";

export type AtomicSubscribePreview = {
  operation: "SUBSCRIBE_V2";
  contractVersion: 2;
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
  maxInitialChargeFxrp: { display: string; atomic: string; decimals: number };
  quotedInitialChargeFxrp: {
    display: string;
    atomic: string;
    decimals: number;
    updatedAt: string | null;
    source: "FIXED_PLAN" | "FTSO_ADAPTER";
  };
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
  readiness: "READY";
  checks: {
    standingUnpaused: true;
    planActive: true;
    fxrpDecimals: 6;
    personalAccountHasC2Flr: boolean;
    personalAccountC2FlrAtomic: string;
    personalAccountC2FlrRequired: false;
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
  maxInitialChargeFxrp: string;
  standing: Address;
  client?: PublicClient;
}): Promise<AtomicSubscribePreview> {
  if (!isValidClassicAddress(input.xrplAddress)) throw new Error("XRPL_ADDRESS must be a valid classic address");
  if (input.planId <= 0n) throw new Error("PLAN_ID must be positive");

  const client = input.client ?? createCoston2Client();
  const standing = getAddress(input.standing);
  await requireStandingV2(client, standing);
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
  const fxrp = await requireStandingFxrpBinding(client, standing, assetManager);

  const [personalAccount, xrplDestination, executorFeeUBA, feeBips, minimumFeeUBA, paused, plan] =
    await Promise.all([
      client.readContract({
        address: masterAccountController,
        abi: masterAccountControllerAbi,
        functionName: "getPersonalAccount",
        args: [input.xrplAddress],
      }),
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
  let quotedInitialCharge = priceFxrp;
  let quoteUpdatedAt: bigint | null = null;
  let quoteSource: "FIXED_PLAN" | "FTSO_ADAPTER" = "FIXED_PLAN";
  if (priceUsdMicro > 0n) {
    const [priceAdapter, maxPriceAge, block] = await Promise.all([
      client.readContract({ address: standing, abi: standingAbi, functionName: "priceAdapter" }),
      client.readContract({ address: standing, abi: standingAbi, functionName: "maxPriceAge" }),
      client.getBlock(),
    ]);
    const [liveQuote, updatedAt] = await client.readContract({
      address: priceAdapter,
      abi: priceAdapterAbi,
      functionName: "getFxrpForUsdMicro",
      args: [priceUsdMicro],
    });
    if (liveQuote <= 0n || updatedAt <= 0n) throw new Error("FTSO adapter returned an invalid initial-charge quote");
    if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxPriceAge) {
      throw new Error("FTSO initial-charge quote is stale");
    }
    quotedInitialCharge = liveQuote;
    quoteUpdatedAt = updatedAt;
    quoteSource = "FTSO_ADAPTER";
  }
  const depositAtomic = parseDeposit(input.deposit, decimals);
  const maxInitialChargeFxrpAtomic = parseDeposit(input.maxInitialChargeFxrp, decimals);
  if (maxInitialChargeFxrpAtomic > depositAtomic) {
    throw new Error("maxInitialChargeFxrp cannot exceed the mandate deposit");
  }
  if (depositAtomic < quotedInitialCharge) {
    throw new Error(`deposit ${depositAtomic} is below the quoted first charge ${quotedInitialCharge}`);
  }
  if (maxInitialChargeFxrpAtomic < quotedInitialCharge) {
    throw new Error(`maxInitialChargeFxrp ${maxInitialChargeFxrpAtomic} is below the quoted first charge ${quotedInitialCharge}`);
  }
  const calls = buildStandingCalls({
    fxrp,
    standing,
    planId: input.planId,
    depositAtomic,
    maxInitialChargeFxrpAtomic,
  });
  // This is the Smart Account instruction fee, not AssetManager's direct-mint
  // executor fee. Flare's official 0xFE starter encodes zero here while adding
  // the separate direct-mint executor fee to the XRPL payment below.
  const encoded = encodeHashInstruction({ calls, sender: personalAccount, nonce, executorFeeUBA: 0n });
  const payment = calculateDirectMintPayment(depositAtomic, { executorFeeUBA, feeBips, minimumFeeUBA });

  return {
    operation: "SUBSCRIBE_V2",
    contractVersion: 2,
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
    maxInitialChargeFxrp: {
      display: input.maxInitialChargeFxrp,
      atomic: maxInitialChargeFxrpAtomic.toString(),
      decimals,
    },
    quotedInitialChargeFxrp: {
      display: formatUnits(quotedInitialCharge, decimals),
      atomic: quotedInitialCharge.toString(),
      decimals,
      updatedAt: quoteUpdatedAt?.toString() ?? null,
      source: quoteSource,
    },
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
    // Every call in this 0xFE operation carries value=0. The official Flare
    // Smart Accounts controller invokes the Personal Account and the executor
    // pays the outer C-chain transaction, so the Personal Account does not
    // need native C2FLR for this operation.
    readiness: "READY",
    checks: {
      standingUnpaused: true,
      planActive: true,
      fxrpDecimals: 6,
      personalAccountHasC2Flr: nativeBalance > 0n,
      personalAccountC2FlrAtomic: nativeBalance.toString(),
      personalAccountC2FlrRequired: false,
    },
    authorization: "NOT_SENT",
  };
}
