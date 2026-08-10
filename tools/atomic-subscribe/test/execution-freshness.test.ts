import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { standingAbi } from "../src/abis.js";
import { assertPostPaymentExecutionFreshness } from "../src/execution-freshness.js";
import type { AtomicCancelWithdrawPreview } from "../src/control.js";
import type { AtomicSubscribePreview } from "../src/preflight.js";

const addresses = {
  personalAccount: "0x1111111111111111111111111111111111111111",
  standing: "0x2222222222222222222222222222222222222222",
  fxrp: "0x3333333333333333333333333333333333333333",
  assetManager: "0x4444444444444444444444444444444444444444",
  merchant: "0x5555555555555555555555555555555555555555",
} as const;

function cancellationPreview(): AtomicCancelWithdrawPreview {
  const mandateId = 5n;
  const remaining = 700_000n;
  return {
    operation: "CANCEL_WITHDRAW",
    network: "Coston2",
    chainId: 114,
    xrplSource: "rSource",
    xrplDestination: "rDestination",
    destinationTag: null,
    personalAccount: addresses.personalAccount,
    standing: addresses.standing,
    fxrp: addresses.fxrp,
    assetManager: addresses.assetManager,
    plan: {
      id: "4",
      merchant: addresses.merchant,
      active: true,
      periodSeconds: 86_400,
      priceUsdMicro: "100000",
      priceFxrpAtomic: "0",
    },
    deposit: { display: "1", atomic: "1000000", decimals: 6 },
    nonce: "3",
    payment: {
      netMintUBA: "1000000",
      mintingFeeUBA: "100000",
      executorFeeUBA: "100000",
      totalPaymentUBA: "1200000",
      totalPaymentXrp: "1.2",
    },
    instruction: {
      opcode: "0xFE",
      memoBytes: 42,
      smartAccountExecutorFeeUBA: "0",
      memoData: `0x${"11".repeat(42)}`,
      packedUserOperation: "0x1234",
      userOperationHash: `0x${"22".repeat(32)}`,
      calls: [{
        target: addresses.standing,
        value: "0",
        data: encodeFunctionData({
          abi: standingAbi,
          functionName: "cancelAndWithdrawExact",
          args: [mandateId, remaining],
        }),
      }],
    },
    control: {
      mandateId: mandateId.toString(),
      alreadyCanceled: false,
      depositedAtomic: "1000000",
      remainingAtomic: remaining.toString(),
      nextChargeAt: "200",
      lastChargeAt: "100",
      action: "CANCEL_AND_WITHDRAW",
      reviewWarning: "reviewed before payment",
    },
    readiness: "READY",
    checks: {
      mandateOwnedByPersonalAccount: true,
      remainingBalancePositive: true,
      personalAccountHasC2Flr: true,
      personalAccountC2FlrAtomic: "1",
      personalAccountC2FlrRequired: false,
    },
    authorization: "NOT_SENT",
  };
}

function subscriptionPreview(): AtomicSubscribePreview {
  const control = cancellationPreview();
  return {
    operation: "SUBSCRIBE_V2",
    contractVersion: 2,
    network: control.network,
    chainId: control.chainId,
    xrplSource: control.xrplSource,
    xrplDestination: control.xrplDestination,
    destinationTag: null,
    personalAccount: control.personalAccount,
    standing: control.standing,
    fxrp: control.fxrp,
    assetManager: control.assetManager,
    plan: { ...control.plan, active: true },
    deposit: control.deposit,
    maxInitialChargeFxrp: { display: "0.2", atomic: "200000", decimals: 6 },
    quotedInitialChargeFxrp: {
      display: "0.1",
      atomic: "100000",
      decimals: 6,
      updatedAt: null,
      source: "FIXED_PLAN",
    },
    nonce: control.nonce,
    payment: control.payment,
    instruction: {
      ...control.instruction,
      calls: [
        { target: control.fxrp, value: "0", data: "0x01" },
        { target: control.standing, value: "0", data: "0x02" },
      ],
    },
    readiness: "READY",
    checks: {
      standingUnpaused: true,
      planActive: true,
      fxrpDecimals: 6,
      personalAccountHasC2Flr: true,
      personalAccountC2FlrAtomic: "1",
      personalAccountC2FlrRequired: false,
    },
    authorization: "NOT_SENT",
  };
}

describe("post-payment execution freshness", () => {
  it("continues paid cancellation recovery after the merchant deactivates or edits the plan", () => {
    const committed = cancellationPreview();
    const fresh: AtomicCancelWithdrawPreview = {
      ...committed,
      xrplDestination: "rRotatedDestination",
      plan: {
        ...committed.plan,
        merchant: "0x6666666666666666666666666666666666666666",
        active: false,
        periodSeconds: 600,
        priceUsdMicro: "999999",
        priceFxrpAtomic: "123456",
      },
      payment: {
        ...committed.payment,
        mintingFeeUBA: "200000",
        totalPaymentUBA: "1300000",
        totalPaymentXrp: "1.3",
      },
      control: {
        ...committed.control,
        alreadyCanceled: true,
        nextChargeAt: "300",
        lastChargeAt: "250",
        action: "WITHDRAW_CANCELED",
        reviewWarning: "fresh presentation after payment",
      },
      checks: {
        ...committed.checks,
        personalAccountHasC2Flr: false,
        personalAccountC2FlrAtomic: "0",
      },
    };

    expect(() => assertPostPaymentExecutionFreshness(committed, fresh)).not.toThrow();
  });

  it.each([
    ["nonce", (fresh: AtomicCancelWithdrawPreview): AtomicCancelWithdrawPreview => ({ ...fresh, nonce: "4" })],
    ["mandate", (fresh: AtomicCancelWithdrawPreview): AtomicCancelWithdrawPreview => ({
      ...fresh,
      plan: { ...fresh.plan, id: "9" },
    })],
    ["mandate deposit", (fresh: AtomicCancelWithdrawPreview): AtomicCancelWithdrawPreview => ({
      ...fresh,
      control: { ...fresh.control, depositedAtomic: "999999" },
    })],
    ["remaining balance", (fresh: AtomicCancelWithdrawPreview): AtomicCancelWithdrawPreview => ({
      ...fresh,
      instruction: {
        ...fresh.instruction,
        calls: [{
          target: fresh.standing,
          value: "0",
          data: encodeFunctionData({
            abi: standingAbi,
            functionName: "cancelAndWithdrawExact",
            args: [BigInt(fresh.control.mandateId), 699_999n],
          }),
        }],
      },
      control: { ...fresh.control, remainingAtomic: "699999" },
    })],
    ["Personal Account owner", (fresh: AtomicCancelWithdrawPreview): AtomicCancelWithdrawPreview => ({
      ...fresh,
      personalAccount: "0x7777777777777777777777777777777777777777",
    })],
    ["call hash", (fresh: AtomicCancelWithdrawPreview): AtomicCancelWithdrawPreview => ({
      ...fresh,
      instruction: { ...fresh.instruction, userOperationHash: `0x${"33".repeat(32)}` },
    })],
  ])("rejects post-payment cancellation drift in %s", (_label, mutate) => {
    const committed = cancellationPreview();
    expect(() => assertPostPaymentExecutionFreshness(committed, mutate(cancellationPreview()))).toThrow("drifted");
  });

  it("keeps subscription recovery on the strict full-preview comparator", () => {
    const committed = subscriptionPreview();
    const fresh = {
      ...subscriptionPreview(),
      plan: { ...subscriptionPreview().plan, active: false },
    } as unknown as AtomicSubscribePreview;
    expect(() => assertPostPaymentExecutionFreshness(committed, fresh)).toThrow("drifted");
  });
});
