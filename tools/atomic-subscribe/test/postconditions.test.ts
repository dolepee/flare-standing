import { describe, expect, it, vi } from "vitest";
import {
  readMandateAtReceiptBlock,
  validateImmediateOpenPostconditions,
  type StoredMandate,
} from "../src/postconditions.js";

const subscriber = "0x1111111111111111111111111111111111111111" as const;
const merchant = "0x2222222222222222222222222222222222222222" as const;

function valid() {
  return {
    committed: { planId: 4n, subscriber, merchant, deposit: 1_000n, maxInitialCharge: 110n },
    opened: { mandateId: 7n, planId: 4n, subscriber, deposited: 1_000n, firstChargeAt: 100n },
    charged: { mandateId: 7n, merchant, merchantAmount: 99n, feeAmount: 1n, nextChargeAt: 200n },
    stored: [4n, subscriber, 1_000n, 900n, 200n, 100n, false] as StoredMandate,
  };
}

describe("V2 immediate-open postconditions", () => {
  it("bounds the gross charge rather than only merchant net proceeds", () => {
    expect(validateImmediateOpenPostconditions(valid())).toBe(100n);
    const input = valid();
    input.committed.maxInitialCharge = 99n;
    expect(() => validateImmediateOpenPostconditions(input)).toThrow("gross initial charge");
  });

  it.each([
    ["remaining", 3, 901n],
    ["nextChargeAt", 4, 201n],
    ["lastChargeAt", 5, 101n],
  ] as const)("rejects a wrong stored %s", (_label, index, value) => {
    const input = valid();
    input.stored = input.stored.map((item, itemIndex) => itemIndex === index ? value : item) as unknown as StoredMandate;
    expect(() => validateImmediateOpenPostconditions(input)).toThrow("stored mandate");
  });

  it("binds MandateOpened.firstChargeAt and ChargeExecuted.nextChargeAt to storage", () => {
    const firstChargeDrift = valid();
    firstChargeDrift.opened.firstChargeAt = 101n;
    expect(() => validateImmediateOpenPostconditions(firstChargeDrift)).toThrow("stored mandate");
    const nextChargeDrift = valid();
    nextChargeDrift.charged.nextChargeAt = 201n;
    expect(() => validateImmediateOpenPostconditions(nextChargeDrift)).toThrow("stored mandate");
  });

  it("validates subscription state at the exact receipt block when a later keeper charge has advanced latest state", async () => {
    const receiptBlockNumber = 12_345n;
    const receiptBlockState = valid().stored;
    const latestState = [4n, subscriber, 1_000n, 800n, 300n, 200n, false] as StoredMandate;
    const readContract = vi.fn(async (request: { blockNumber: bigint }) =>
      request.blockNumber === receiptBlockNumber ? receiptBlockState : latestState);

    const stored = await readMandateAtReceiptBlock({
      readContract,
      standing: "0x3333333333333333333333333333333333333333",
      mandateId: 7n,
      receiptBlockNumber,
    });

    expect(readContract).toHaveBeenCalledOnce();
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "mandates",
      args: [7n],
      blockNumber: receiptBlockNumber,
    }));
    expect(validateImmediateOpenPostconditions({ ...valid(), stored })).toBe(100n);
    expect(() => validateImmediateOpenPostconditions({ ...valid(), stored: latestState })).toThrow("stored mandate");
  });
});
