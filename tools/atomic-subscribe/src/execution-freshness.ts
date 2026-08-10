import {
  assertFreshPreviewMatches,
  assertPreviewIntegrity,
  operationKind,
  type AtomicOperationPreview,
} from "./artifact.js";

function assertEqual(label: string, committed: string | number | null, fresh: string | number | null): void {
  if (committed !== fresh) throw new Error(`live cancel-withdraw ${label} drifted from the paid artifact`);
}

function assertAddressEqual(label: string, committed: string, fresh: string): void {
  assertEqual(label, committed.toLowerCase(), fresh.toLowerCase());
}

/**
 * Revalidates only the state that can change the already-paid cancellation's
 * encoded operation or its safety boundary. Merchant presentation state is
 * deliberately excluded: plan activation, pricing, cadence, and merchant
 * metadata are not consulted by cancelAndWithdrawExact and must not strand a
 * validated XRPL authorization while FDC/direct minting is delayed.
 *
 * Subscription execution retains the original full-preview comparison.
 */
export function assertPostPaymentExecutionFreshness(
  committed: AtomicOperationPreview,
  fresh: AtomicOperationPreview,
): void {
  assertPreviewIntegrity(committed);
  assertPreviewIntegrity(fresh);

  const committedOperation = operationKind(committed);
  const freshOperation = operationKind(fresh);
  if (committedOperation !== "CANCEL_WITHDRAW" || freshOperation !== "CANCEL_WITHDRAW") {
    assertFreshPreviewMatches(committed, fresh);
    return;
  }
  if (!("control" in committed) || !("control" in fresh)) {
    throw new Error("cancel-withdraw preview omitted its control binding");
  }

  // The fresh preview builder has already required the exact V2 identity and
  // Standing-to-AssetManager FXRP binding. Keep those resolved identities and
  // the XRPL-derived owner pinned to the paid artifact.
  assertEqual("network", committed.network, fresh.network);
  assertEqual("chain", committed.chainId, fresh.chainId);
  assertEqual("XRPL source", committed.xrplSource, fresh.xrplSource);
  assertAddressEqual("Personal Account owner", committed.personalAccount, fresh.personalAccount);
  assertAddressEqual("Standing deployment", committed.standing, fresh.standing);
  assertAddressEqual("FXRP token", committed.fxrp, fresh.fxrp);
  assertAddressEqual("AssetManager", committed.assetManager, fresh.assetManager);

  // These are immutable mandate/payment bindings, not mutable plan
  // presentation. The display strings may be reformatted, so atomic amounts
  // and decimals are the authoritative values.
  assertEqual("mandate plan binding", committed.plan.id, fresh.plan.id);
  assertEqual("authorization mint amount", committed.deposit.atomic, fresh.deposit.atomic);
  assertEqual("authorization mint decimals", committed.deposit.decimals, fresh.deposit.decimals);
  assertEqual("Personal Account nonce", committed.nonce, fresh.nonce);
  assertEqual("mandate id", committed.control.mandateId, fresh.control.mandateId);
  assertEqual("mandate deposit", committed.control.depositedAtomic, fresh.control.depositedAtomic);
  assertEqual("mandate remaining balance", committed.control.remainingAtomic, fresh.control.remainingAtomic);

  // The hash and exact one-call encoding bind the nonce, owner, mandate, and
  // expected refund. Comparing them explicitly also avoids JSON property-order
  // sensitivity at this irreversible post-payment boundary.
  assertEqual("user-operation hash", committed.instruction.userOperationHash.toLowerCase(), fresh.instruction.userOperationHash.toLowerCase());
  assertEqual("packed user operation", committed.instruction.packedUserOperation.toLowerCase(), fresh.instruction.packedUserOperation.toLowerCase());
  assertEqual("memo data", committed.instruction.memoData.toLowerCase(), fresh.instruction.memoData.toLowerCase());
  assertEqual("call count", committed.instruction.calls.length, fresh.instruction.calls.length);
  for (let index = 0; index < committed.instruction.calls.length; index += 1) {
    const committedCall = committed.instruction.calls[index]!;
    const freshCall = fresh.instruction.calls[index]!;
    assertAddressEqual(`call ${index} target`, committedCall.target, freshCall.target);
    assertEqual(`call ${index} value`, committedCall.value, freshCall.value);
    assertEqual(`call ${index} data`, committedCall.data.toLowerCase(), freshCall.data.toLowerCase());
  }
}
