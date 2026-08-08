import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { erc20ApproveAbi, personalAccountAbi, standingAbi } from "./abis.js";

export type StandingCall = {
  target: Address;
  value: bigint;
  data: Hex;
};

export type MintFeeSettings = {
  executorFeeUBA: bigint;
  feeBips: bigint;
  minimumFeeUBA: bigint;
};

const zeroBytes32 = `0x${"00".repeat(32)}` as Hex;
const packedUserOperationTuple = {
  type: "tuple",
  components: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export function buildStandingCalls(input: {
  fxrp: Address;
  standing: Address;
  planId: bigint;
  depositAtomic: bigint;
}): readonly StandingCall[] {
  if (input.planId <= 0n) throw new Error("planId must be positive");
  if (input.depositAtomic <= 0n) throw new Error("depositAtomic must be positive");

  return [
    {
      target: input.fxrp,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [input.standing, input.depositAtomic],
      }),
    },
    {
      target: input.standing,
      value: 0n,
      data: encodeFunctionData({
        abi: standingAbi,
        functionName: "openMandate",
        args: [input.planId, input.depositAtomic],
      }),
    },
  ] as const;
}

export function encodePackedUserOperation(input: {
  calls: readonly StandingCall[];
  sender: Address;
  nonce: bigint;
}): Hex {
  if (input.calls.length !== 2) throw new Error("Standing atomic subscribe requires exactly two calls");
  if (input.nonce < 0n) throw new Error("nonce cannot be negative");

  const callData = encodeFunctionData({
    abi: personalAccountAbi,
    functionName: "executeUserOp",
    args: [input.calls],
  });

  return encodeAbiParameters(
    [packedUserOperationTuple],
    [
      {
        sender: input.sender,
        nonce: input.nonce,
        initCode: "0x",
        callData,
        accountGasLimits: zeroBytes32,
        preVerificationGas: 0n,
        gasFees: zeroBytes32,
        paymasterAndData: "0x",
        signature: "0x",
      },
    ],
  );
}

export function encodeHashInstruction(input: {
  calls: readonly StandingCall[];
  sender: Address;
  nonce: bigint;
  walletId?: number;
  executorFeeUBA?: bigint;
}): { data: Hex; memoData: Hex; userOperationHash: Hex } {
  const walletId = input.walletId ?? 0;
  const executorFeeUBA = input.executorFeeUBA ?? 0n;
  if (!Number.isInteger(walletId) || walletId < 0 || walletId > 255) {
    throw new Error("walletId must fit uint8");
  }
  if (executorFeeUBA < 0n || executorFeeUBA > 2n ** 64n - 1n) {
    throw new Error("executorFeeUBA must fit uint64");
  }

  const data = encodePackedUserOperation(input);
  const userOperationHash = keccak256(data);
  const memoData = concatHex([
    "0xFE",
    toHex(walletId, { size: 1 }),
    toHex(executorFeeUBA, { size: 8 }),
    userOperationHash,
  ]);
  if ((memoData.length - 2) / 2 !== 42) throw new Error("0xFE memo must be exactly 42 bytes");
  return { data, memoData, userOperationHash };
}

export function calculateDirectMintPayment(
  netMintUBA: bigint,
  settings: MintFeeSettings,
): { mintingFeeUBA: bigint; totalPaymentUBA: bigint } {
  if (netMintUBA <= 0n) throw new Error("netMintUBA must be positive");
  if (settings.feeBips < 0n || settings.feeBips > 10_000n) throw new Error("invalid feeBips");
  if (settings.executorFeeUBA < 0n || settings.minimumFeeUBA < 0n) throw new Error("fees cannot be negative");

  const proportionalFee = (netMintUBA * settings.feeBips) / 10_000n;
  const mintingFeeUBA = proportionalFee > settings.minimumFeeUBA ? proportionalFee : settings.minimumFeeUBA;
  return {
    mintingFeeUBA,
    totalPaymentUBA: netMintUBA + mintingFeeUBA + settings.executorFeeUBA,
  };
}

export function parseDeposit(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("deposit must be a positive decimal string");
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n) throw new Error("deposit must be positive");
  return parsed;
}
