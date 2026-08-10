import type { Address } from "viem";
import { standingAbi } from "./abis.js";

export type StoredMandate = readonly [
  planId: bigint,
  subscriber: Address,
  deposited: bigint,
  remaining: bigint,
  nextChargeAt: bigint,
  lastChargeAt: bigint,
  canceled: boolean,
];

export type MandateAtBlockRead = (request: {
  address: Address;
  abi: typeof standingAbi;
  functionName: "mandates";
  args: readonly [bigint];
  blockNumber: bigint;
}) => Promise<StoredMandate>;

export async function readMandateAtReceiptBlock(input: {
  readContract: MandateAtBlockRead;
  standing: Address;
  mandateId: bigint;
  receiptBlockNumber: bigint;
}): Promise<StoredMandate> {
  return input.readContract({
    address: input.standing,
    abi: standingAbi,
    functionName: "mandates",
    args: [input.mandateId],
    blockNumber: input.receiptBlockNumber,
  });
}

export function validateImmediateOpenPostconditions(input: {
  committed: {
    planId: bigint;
    subscriber: Address;
    merchant: Address;
    deposit: bigint;
    maxInitialCharge: bigint;
  };
  opened: {
    mandateId: bigint;
    planId: bigint;
    subscriber: Address;
    deposited: bigint;
    firstChargeAt: bigint;
  };
  charged: {
    mandateId: bigint;
    merchant: Address;
    merchantAmount: bigint;
    feeAmount: bigint;
    nextChargeAt: bigint;
  };
  stored: StoredMandate;
}): bigint {
  const { committed, opened, charged, stored } = input;
  if (
    opened.planId !== committed.planId ||
    opened.subscriber.toLowerCase() !== committed.subscriber.toLowerCase() ||
    opened.deposited !== committed.deposit
  ) {
    throw new Error("MandateOpened does not match the reviewed V2 subscription");
  }
  if (
    charged.mandateId !== opened.mandateId ||
    charged.merchant.toLowerCase() !== committed.merchant.toLowerCase()
  ) {
    throw new Error("ChargeExecuted does not match the opened mandate and merchant");
  }
  const grossInitialCharge = charged.merchantAmount + charged.feeAmount;
  if (grossInitialCharge <= 0n || grossInitialCharge > committed.maxInitialCharge) {
    throw new Error("gross initial charge exceeded the reviewed maximum");
  }
  if (
    stored[0] !== committed.planId ||
    stored[1].toLowerCase() !== committed.subscriber.toLowerCase() ||
    stored[2] !== committed.deposit ||
    stored[3] !== committed.deposit - grossInitialCharge ||
    stored[4] === 0n ||
    stored[4] !== charged.nextChargeAt ||
    stored[5] === 0n ||
    stored[5] !== opened.firstChargeAt ||
    stored[6]
  ) {
    throw new Error("stored mandate does not match the immediate-open postconditions");
  }
  return grossInitialCharge;
}
