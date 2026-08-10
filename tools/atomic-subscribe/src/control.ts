import { createPublicClient, formatUnits, getAddress, http, type Address, type PublicClient } from "viem";
import { isValidClassicAddress } from "xrpl";
import {
  assetManagerAbi,
  erc20ReadAbi,
  masterAccountControllerAbi,
  registryAbi,
  standingAbi,
} from "./abis.js";
import { coston2, registryAddress } from "./config.js";
import {
  buildCancelWithdrawCalls,
  calculateDirectMintPayment,
  encodeHashInstruction,
  parseDeposit,
} from "./protocol.js";
import { requireStandingFxrpBinding, requireStandingV2 } from "./standing-v2.js";

export type AtomicCancelWithdrawPreview = {
  operation: "CANCEL_WITHDRAW";
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
    active: boolean;
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
  control: {
    mandateId: string;
    alreadyCanceled: boolean;
    depositedAtomic: string;
    remainingAtomic: string;
    nextChargeAt: string;
    lastChargeAt: string;
    action: "CANCEL_AND_WITHDRAW" | "WITHDRAW_CANCELED";
    reviewWarning: string;
  };
  readiness: "READY";
  checks: {
    mandateOwnedByPersonalAccount: true;
    remainingBalancePositive: true;
    personalAccountHasC2Flr: boolean;
    personalAccountC2FlrAtomic: string;
    personalAccountC2FlrRequired: false;
  };
  authorization: "NOT_SENT";
};

export async function buildCancelWithdrawPreview(input: {
  xrplAddress: string;
  mandateId: bigint;
  authorizationMint: string;
  standing: Address;
  client?: PublicClient;
}): Promise<AtomicCancelWithdrawPreview> {
  if (!isValidClassicAddress(input.xrplAddress)) throw new Error("XRPL_ADDRESS must be a valid classic address");
  if (input.mandateId <= 0n) throw new Error("MANDATE_ID must be positive");

  const client = input.client ?? createPublicClient({ chain: coston2, transport: http(process.env.COSTON2_RPC_URL) });
  const standing = getAddress(input.standing);
  await requireStandingV2(client, standing);
  const [controller, assetManager] = await Promise.all([
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
  const [personalAccount, xrplDestination, executorFeeUBA, feeBips, minimumFeeUBA, mandate] =
    await Promise.all([
      client.readContract({
        address: controller,
        abi: masterAccountControllerAbi,
        functionName: "getPersonalAccount",
        args: [input.xrplAddress],
      }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "directMintingPaymentAddress" }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingExecutorFeeUBA" }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingFeeBIPS" }),
      client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingMinimumFeeUBA" }),
      client.readContract({ address: standing, abi: standingAbi, functionName: "mandates", args: [input.mandateId] }),
    ]);

  const [planId, subscriber, deposited, remaining, nextChargeAt, lastChargeAt, canceled] = mandate;
  if (subscriber.toLowerCase() !== personalAccount.toLowerCase()) {
    throw new Error(`mandate ${input.mandateId} is not owned by the XRPL-derived Personal Account`);
  }
  if (remaining <= 0n) throw new Error(`mandate ${input.mandateId} has no remaining balance to recover`);

  const [decimals, nonce, nativeBalance, plan] = await Promise.all([
    client.readContract({ address: fxrp, abi: erc20ReadAbi, functionName: "decimals" }),
    client.readContract({ address: controller, abi: masterAccountControllerAbi, functionName: "getNonce", args: [personalAccount] }),
    client.getBalance({ address: personalAccount }),
    client.readContract({ address: standing, abi: standingAbi, functionName: "plans", args: [planId] }),
  ]);
  if (decimals !== 6) throw new Error(`FXRP decimals mismatch: expected 6, got ${decimals}`);
  const authorizationMintAtomic = parseDeposit(input.authorizationMint, decimals);
  const calls = buildCancelWithdrawCalls({
    standing,
    mandateId: input.mandateId,
    remainingAtomic: remaining,
  });
  const encoded = encodeHashInstruction({ calls, sender: personalAccount, nonce, executorFeeUBA: 0n });
  const payment = calculateDirectMintPayment(authorizationMintAtomic, {
    executorFeeUBA,
    feeBips,
    minimumFeeUBA,
  });
  const [merchant, priceUsdMicro, priceFxrp, periodSeconds, active] = plan;

  return {
    operation: "CANCEL_WITHDRAW",
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
      id: planId.toString(),
      merchant,
      active,
      periodSeconds,
      priceUsdMicro: priceUsdMicro.toString(),
      priceFxrpAtomic: priceFxrp.toString(),
    },
    deposit: { display: input.authorizationMint, atomic: authorizationMintAtomic.toString(), decimals },
    nonce: nonce.toString(),
    payment: {
      netMintUBA: authorizationMintAtomic.toString(),
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
    control: {
      mandateId: input.mandateId.toString(),
      alreadyCanceled: canceled,
      depositedAtomic: deposited.toString(),
      remainingAtomic: remaining.toString(),
      nextChargeAt: nextChargeAt.toString(),
      lastChargeAt: lastChargeAt.toString(),
      action: canceled ? "WITHDRAW_CANCELED" : "CANCEL_AND_WITHDRAW",
      reviewWarning:
        `Authorization sends ${payment.totalPaymentUBA} drops to the FXRP Core Vault, mints ` +
        `${authorizationMintAtomic} atomic FXRP to the same Personal Account, then atomically ${canceled ? "withdraws" : "cancels and withdraws"} ` +
        `exactly ${remaining} atomic FXRP back to that Personal Account. The contract binds the refund to this observed mandate balance; if a keeper charge changes it before execution, the entire operation reverts rather than accepting less. It does not return native XRP to the XRPL address and never gives the executor custody.`,
    },
    readiness: "READY",
    checks: {
      mandateOwnedByPersonalAccount: true,
      remainingBalancePositive: true,
      personalAccountHasC2Flr: nativeBalance > 0n,
      personalAccountC2FlrAtomic: nativeBalance.toString(),
      personalAccountC2FlrRequired: false,
    },
    authorization: "NOT_SENT",
  };
}
