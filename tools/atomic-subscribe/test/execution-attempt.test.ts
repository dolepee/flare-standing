import { describe, expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ExecutionAttempt } from "../src/artifact.js";
import { validatePersistedExecutionAttempt } from "../src/execution-attempt.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const other = privateKeyToAccount(`0x${"2".repeat(64)}`);
const serialized = await account.signTransaction({
  type: "eip1559",
  chainId: 114,
  nonce: 7,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  gas: 21_000n,
  to: other.address,
  value: 1n,
});
const legacy: ExecutionAttempt = {
  transactionHash: keccak256(serialized),
  serializedTransaction: serialized,
  submittedAt: "2026-08-09T00:00:00.000Z",
  outcome: "SIGNED",
};

describe("persisted execution-attempt validation", () => {
  it("accepts a legacy exact-hash attempt without synthesizing nonce metadata", async () => {
    await expect(validatePersistedExecutionAttempt(legacy, account.address)).resolves.toBe(7);
    expect(legacy.nonce).toBeUndefined();
    expect(legacy.nonceAnchor).toBeUndefined();
  });

  it("rejects partial anchors, altered hashes, and a different signer", async () => {
    await expect(validatePersistedExecutionAttempt({ ...legacy, nonce: 7 }, account.address))
      .rejects.toThrow("incomplete finalized nonce anchor");
    await expect(validatePersistedExecutionAttempt({
      ...legacy,
      transactionHash: `0x${"f".repeat(64)}` as Hex,
    }, account.address)).rejects.toThrow("hash does not match");
    await expect(validatePersistedExecutionAttempt(legacy, other.address)).rejects.toThrow("different account");
  });
});
