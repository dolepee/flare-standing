import { decodeFunctionData, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { erc20ApproveAbi, standingAbi } from "../src/abis.js";
import {
  buildStandingCalls,
  buildCancelWithdrawCalls,
  calculateDirectMintPayment,
  encodeHashInstruction,
  parseDeposit,
} from "../src/protocol.js";

const fxrp = "0x0b6A3645c240605887a5532109323A3E12273dc7" as const;
const standing = "0x8a29c741280554028d76666dc75558d98caab855" as const;
const sender = "0x1111111111111111111111111111111111111111" as const;

describe("Standing atomic subscription instruction", () => {
  it("encodes exact approve then bounded openMandateAndCharge calls", () => {
    const calls = buildStandingCalls({
      fxrp,
      standing,
      planId: 4n,
      depositAtomic: 1_000_000n,
      maxInitialChargeFxrpAtomic: 200_000n,
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.value === 0n)).toBe(true);
    expect(calls[0]?.target).toBe(fxrp);
    expect(calls[1]?.target).toBe(standing);
    const approval = decodeFunctionData({ abi: erc20ApproveAbi, data: calls[0]!.data });
    expect(approval.functionName).toBe("approve");
    expect(approval.args?.[0].toLowerCase()).toBe(standing.toLowerCase());
    expect(approval.args?.[1]).toBe(1_000_000n);
    expect(decodeFunctionData({ abi: standingAbi, data: calls[1]!.data })).toEqual({
      functionName: "openMandateAndCharge",
      args: [4n, 1_000_000n, 200_000n],
    });
  });

  it("creates the canonical 42-byte 0xFE hash commitment", () => {
    const calls = buildStandingCalls({
      fxrp,
      standing,
      planId: 4n,
      depositAtomic: 1_000_000n,
      maxInitialChargeFxrpAtomic: 200_000n,
    });
    const encoded = encodeHashInstruction({ calls, sender, nonce: 7n });
    expect(encoded.memoData.slice(0, 4).toLowerCase()).toBe("0xfe");
    expect((encoded.memoData.length - 2) / 2).toBe(42);
    expect(encoded.memoData.slice(-64)).toBe(keccak256(encoded.data).slice(2));
    expect(encoded.userOperationHash).toBe(keccak256(encoded.data));
  });

  it("builds one XRP-authorized exact cancel-and-withdraw operation without native value", () => {
    const calls = buildCancelWithdrawCalls({
      standing,
      mandateId: 5n,
      remainingAtomic: 700_000n,
    });
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.value === 0n)).toBe(true);
    expect(decodeFunctionData({ abi: standingAbi, data: calls[0]!.data })).toEqual({
      functionName: "cancelAndWithdrawExact",
      args: [5n, 700_000n],
    });
    const encoded = encodeHashInstruction({ calls, sender, nonce: 3n });
    expect(encoded.memoData.slice(0, 4).toLowerCase()).toBe("0xfe");
  });

  it("uses the same exact withdrawal guard for an already-canceled mandate", () => {
    const calls = buildCancelWithdrawCalls({
      standing,
      mandateId: 5n,
      remainingAtomic: 700_000n,
    });
    expect(calls).toHaveLength(1);
    expect(decodeFunctionData({ abi: standingAbi, data: calls[0]!.data })).toEqual({
      functionName: "cancelAndWithdrawExact",
      args: [5n, 700_000n],
    });
    expect(() => buildCancelWithdrawCalls({ standing, mandateId: 5n, remainingAtomic: 0n })).toThrow("no remaining");
  });

  it("accounts for proportional, minimum and executor fees", () => {
    expect(
      calculateDirectMintPayment(1_000_000n, {
        executorFeeUBA: 10_000n,
        feeBips: 100n,
        minimumFeeUBA: 20_000n,
      }),
    ).toEqual({ mintingFeeUBA: 20_000n, totalPaymentUBA: 1_030_000n });
    expect(
      calculateDirectMintPayment(10_000_000n, {
        executorFeeUBA: 10_000n,
        feeBips: 100n,
        minimumFeeUBA: 20_000n,
      }),
    ).toEqual({ mintingFeeUBA: 100_000n, totalPaymentUBA: 10_110_000n });
  });

  it("rejects invalid amounts and instruction shapes", () => {
    expect(() => parseDeposit("0", 6)).toThrow("positive");
    expect(() => parseDeposit("1e2", 6)).toThrow("decimal string");
    expect(() => buildStandingCalls({
      fxrp,
      standing,
      planId: 0n,
      depositAtomic: 1n,
      maxInitialChargeFxrpAtomic: 1n,
    })).toThrow("planId");
    expect(() => buildStandingCalls({
      fxrp,
      standing,
      planId: 4n,
      depositAtomic: 1n,
      maxInitialChargeFxrpAtomic: 2n,
    })).toThrow("cannot exceed");
    const calls = buildStandingCalls({
      fxrp,
      standing,
      planId: 4n,
      depositAtomic: 1n,
      maxInitialChargeFxrpAtomic: 1n,
    });
    expect(() => encodeHashInstruction({ calls: [], sender, nonce: 0n })).toThrow("between one and eight");
    expect(() => encodeHashInstruction({ calls, sender, nonce: 0n })).not.toThrow();
  });
});
