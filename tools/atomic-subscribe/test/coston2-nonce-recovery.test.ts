import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  captureFinalizedNonceAnchor,
  proveFinalizedNonceDisposition,
  viemFinalizedNonceRpc,
} from "../src/coston2-nonce-recovery.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const executor = address("1");
const signedHash = hash("a");

function rpc(input: {
  head?: bigint;
  anchorHash?: Hex;
  headCount?: number;
  blocks?: Map<bigint, readonly { hash: Hex; from: Address; nonce: number }[]>;
  consumedAt?: bigint;
}) {
  const head = input.head ?? 12n;
  const anchorHash = input.anchorHash ?? hash("1");
  return {
    finalizedBlock: async () => ({ number: head, hash: hash("f") }),
    block: async (blockNumber: bigint) => ({
      number: blockNumber,
      hash: blockNumber === 10n ? anchorHash : hash(String(Number(blockNumber) % 10)),
      transactions: input.blocks?.get(blockNumber) ?? [],
    }),
    transactionCount: async (_address: Address, blockNumber: bigint) => {
      if (input.headCount !== undefined && blockNumber === head) return input.headCount;
      return input.consumedAt !== undefined && blockNumber >= input.consumedAt ? 8 : 7;
    },
  };
}

const anchor = { blockNumber: "10", blockHash: hash("1"), transactionCount: 7 };

describe("finalized Coston2 nonce recovery", () => {
  it("captures a pre-sign finalized block and account nonce", async () => {
    const captured = await captureFinalizedNonceAnchor(rpc({ head: 10n }) as never, executor);
    expect(captured).toEqual({ blockNumber: "10", blockHash: hash("f"), transactionCount: 7 });
  });

  it("does not treat a pending or latest nonce as finalized consumption", async () => {
    await expect(proveFinalizedNonceDisposition({
      rpc: rpc({ headCount: 7 }) as never,
      anchor,
      executorAddress: executor,
      nonce: 7,
      signedTransactionHash: signedHash,
    })).resolves.toEqual({ kind: "NOT_CONSUMED", finalizedBlockNumber: "12" });
  });

  it("recognizes the exact signed hash in canonical finalized history", async () => {
    const blocks = new Map([[11n, [{ hash: signedHash, from: executor, nonce: 7 }]]]);
    await expect(proveFinalizedNonceDisposition({
      rpc: rpc({ blocks, consumedAt: 11n }) as never,
      anchor,
      executorAddress: executor,
      nonce: 7,
      signedTransactionHash: signedHash,
    })).resolves.toEqual({ kind: "EXACT_HASH_MINED", transactionHash: signedHash, blockNumber: "11" });
  });

  it("proves displacement only from a different finalized hash at the exact executor nonce", async () => {
    const competingHash = hash("b");
    const blocks = new Map([[12n, [{ hash: competingHash, from: executor, nonce: 7 }]]]);
    await expect(proveFinalizedNonceDisposition({
      rpc: rpc({ blocks, consumedAt: 12n }) as never,
      anchor,
      executorAddress: executor,
      nonce: 7,
      signedTransactionHash: signedHash,
    })).resolves.toEqual({ kind: "NONCE_DISPLACED", transactionHash: competingHash, blockNumber: "12" });
  });

  it("fails closed when the anchor changes or the complete scan cannot explain the advanced nonce", async () => {
    await expect(proveFinalizedNonceDisposition({
      rpc: rpc({ anchorHash: hash("2") }) as never,
      anchor,
      executorAddress: executor,
      nonce: 7,
      signedTransactionHash: signedHash,
    })).rejects.toThrow("anchor hash");
    await expect(proveFinalizedNonceDisposition({
      rpc: rpc({ consumedAt: 12n }) as never,
      anchor,
      executorAddress: executor,
      nonce: 7,
      signedTransactionHash: signedHash,
    })).rejects.toThrow("contained 0 matching executor transactions");
  });

  it("fails closed when the canonical anchor account count changes", async () => {
    const changed = rpc({ consumedAt: 10n });
    await expect(proveFinalizedNonceDisposition({
      rpc: changed as never,
      anchor,
      executorAddress: executor,
      nonce: 7,
      signedTransactionHash: signedHash,
    })).rejects.toThrow("anchor transaction count");
  });

  it("rejects hash-only and malformed full-block transaction data", async () => {
    const adapter = viemFinalizedNonceRpc({
      getBlock: async () => ({
        number: 11n,
        hash: hash("1"),
        transactions: [hash("2")],
      }),
      getTransactionCount: async () => 8,
    } as never);
    await expect(adapter.block(11n)).rejects.toThrow("was not fully expanded");
  });

  it("finds an old displaced nonce with bounded logarithmic work instead of an age cliff", async () => {
    const consumedAt = 1_000_010n;
    const competingHash = hash("c");
    const blocks = new Map([[consumedAt, [{ hash: competingHash, from: executor, nonce: 7 }]]]);
    await expect(proveFinalizedNonceDisposition({
      rpc: rpc({ head: 5_000_000n, consumedAt, blocks }) as never,
      anchor,
      executorAddress: executor,
      nonce: 7,
      signedTransactionHash: signedHash,
    })).resolves.toEqual({ kind: "NONCE_DISPLACED", transactionHash: competingHash, blockNumber: consumedAt.toString() });
  });
});
