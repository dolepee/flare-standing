import type { Address, Hex, PublicClient } from "viem";

export const MAX_FINALIZED_NONCE_SEARCH_STEPS = 64;

export type FinalizedNonceAnchor = {
  blockNumber: string;
  blockHash: Hex;
  transactionCount: number;
};

export type FinalizedNonceDisposition =
  | { kind: "NOT_CONSUMED"; finalizedBlockNumber: string }
  | { kind: "EXACT_HASH_MINED"; transactionHash: Hex; blockNumber: string }
  | { kind: "NONCE_DISPLACED"; transactionHash: Hex; blockNumber: string };

type FullTransaction = {
  hash: Hex;
  from: Address;
  nonce: number;
};

type FinalizedNonceRpc = {
  finalizedBlock: () => Promise<{ number: bigint; hash: Hex }>;
  block: (blockNumber: bigint) => Promise<{
    number: bigint;
    hash: Hex;
    transactions: readonly FullTransaction[];
  }>;
  transactionCount: (address: Address, blockNumber: bigint) => Promise<number>;
};

function safeNonce(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a safe account nonce`);
  }
  return value;
}

function blockNumber(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} is not a canonical block number`);
  return BigInt(value);
}

function canonicalHash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[A-Fa-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} is not a canonical transaction or block hash`);
  }
  return value.toLowerCase() as Hex;
}

function canonicalAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !/^0x[A-Fa-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} is not a canonical EVM address`);
  }
  return value.toLowerCase() as Address;
}

function requireBlock(value: {
  number: bigint | null;
  hash: Hex | null;
  transactions?: readonly unknown[];
}, expectedNumber: bigint, requireTransactions: boolean) {
  if (value.number !== expectedNumber) throw new Error(`Coston2 RPC returned the wrong finalized block ${expectedNumber}`);
  const hash = canonicalHash(value.hash, `finalized block ${expectedNumber} hash`);
  if (!requireTransactions) return { number: expectedNumber, hash, transactions: [] as FullTransaction[] };
  if (!Array.isArray(value.transactions)) {
    throw new Error(`finalized block ${expectedNumber} omitted its complete transaction list`);
  }
  const transactions = value.transactions.map((transaction, index) => {
    if (typeof transaction !== "object" || transaction === null) {
      throw new Error(`finalized block ${expectedNumber} transaction ${index} was not fully expanded`);
    }
    const record = transaction as { hash?: unknown; from?: unknown; nonce?: unknown };
    return {
      hash: canonicalHash(record.hash, `finalized block ${expectedNumber} transaction ${index} hash`),
      from: canonicalAddress(record.from, `finalized block ${expectedNumber} transaction ${index} sender`),
      nonce: safeNonce(record.nonce, `finalized block ${expectedNumber} transaction ${index} nonce`),
    };
  });
  return { number: expectedNumber, hash, transactions };
}

export function viemFinalizedNonceRpc(client: PublicClient): FinalizedNonceRpc {
  return {
    finalizedBlock: async () => {
      const value = await client.getBlock({ blockTag: "finalized" });
      if (value.number === null) throw new Error("Coston2 finalized head omitted its block number");
      const parsed = requireBlock(value, value.number, false);
      return { number: parsed.number, hash: parsed.hash };
    },
    block: async (number) => {
      const value = await client.getBlock({ blockNumber: number, includeTransactions: true });
      return requireBlock(value, number, true);
    },
    transactionCount: (address, number) => client.getTransactionCount({ address, blockNumber: number }),
  };
}

export async function captureFinalizedNonceAnchor(
  rpc: FinalizedNonceRpc,
  executorAddress: Address,
): Promise<FinalizedNonceAnchor> {
  const address = canonicalAddress(executorAddress, "executor address");
  const finalized = await rpc.finalizedBlock();
  return {
    blockNumber: finalized.number.toString(),
    blockHash: canonicalHash(finalized.hash, "finalized anchor hash"),
    transactionCount: safeNonce(
      await rpc.transactionCount(address, finalized.number),
      "finalized anchor transaction count",
    ),
  };
}

/**
 * Proves how one signed Coston2 account nonce resolved on the canonical chain.
 *
 * A different hash is accepted as displacement only when a complete scan of
 * canonical finalized blocks finds that exact executor+nonce pair. Merely
 * observing a higher latest/pending nonce is never treated as absence proof.
 */
export async function proveFinalizedNonceDisposition(input: {
  rpc: FinalizedNonceRpc;
  anchor: FinalizedNonceAnchor;
  executorAddress: Address;
  nonce: number;
  signedTransactionHash: Hex;
}): Promise<FinalizedNonceDisposition> {
  const executorAddress = canonicalAddress(input.executorAddress, "executor address");
  const nonce = safeNonce(input.nonce, "signed transaction nonce");
  const signedHash = canonicalHash(input.signedTransactionHash, "signed transaction hash");
  const anchorNumber = blockNumber(input.anchor.blockNumber, "finalized anchor block number");
  const anchorHash = canonicalHash(input.anchor.blockHash, "finalized anchor block hash");
  const anchorCount = safeNonce(input.anchor.transactionCount, "finalized anchor transaction count");
  if (anchorCount !== nonce) {
    throw new Error("signed transaction nonce does not equal its pre-sign finalized account nonce");
  }

  const canonicalAnchor = await input.rpc.block(anchorNumber);
  if (canonicalHash(canonicalAnchor.hash, "canonical finalized anchor hash") !== anchorHash) {
    throw new Error("pre-sign finalized anchor hash no longer matches the canonical Coston2 chain");
  }
  const canonicalAnchorCount = safeNonce(
    await input.rpc.transactionCount(executorAddress, anchorNumber),
    "canonical finalized anchor transaction count",
  );
  if (canonicalAnchorCount !== anchorCount) {
    throw new Error("pre-sign finalized anchor transaction count no longer matches the canonical Coston2 chain");
  }

  const head = await input.rpc.finalizedBlock();
  if (head.number < anchorNumber) throw new Error("Coston2 finalized head regressed behind the pre-sign anchor");
  const headCount = safeNonce(
    await input.rpc.transactionCount(executorAddress, head.number),
    "finalized head transaction count",
  );
  if (headCount <= nonce) {
    return { kind: "NOT_CONSUMED", finalizedBlockNumber: head.number.toString() };
  }

  // Account nonces are monotonic. Find the first finalized block whose state
  // has advanced past the signed nonce, then inspect that one complete block.
  // This keeps recovery bounded even when an operator returns months later.
  let low = anchorNumber;
  let high = head.number;
  let steps = 0;
  while (high - low > 1n) {
    if (++steps > MAX_FINALIZED_NONCE_SEARCH_STEPS) {
      throw new Error(`finalized nonce recovery exceeded ${MAX_FINALIZED_NONCE_SEARCH_STEPS} search steps`);
    }
    const middle = low + (high - low) / 2n;
    const count = safeNonce(
      await input.rpc.transactionCount(executorAddress, middle),
      `finalized transaction count at block ${middle}`,
    );
    if (count > nonce) high = middle;
    else low = middle;
  }
  const consumingBlock = await input.rpc.block(high);
  const matches = consumingBlock.transactions.filter(
    (transaction) => transaction.from.toLowerCase() === executorAddress && transaction.nonce === nonce,
  );
  if (matches.length !== 1) {
    throw new Error(
      `first finalized nonce-advancing block ${high} contained ${matches.length} matching executor transactions`,
    );
  }
  const consuming = {
    hash: canonicalHash(matches[0]!.hash, "nonce-consuming transaction hash"),
    blockNumber: high,
  };
  if (consuming.hash === signedHash) {
    return {
      kind: "EXACT_HASH_MINED",
      transactionHash: consuming.hash,
      blockNumber: consuming.blockNumber.toString(),
    };
  }
  return {
    kind: "NONCE_DISPLACED",
    transactionHash: consuming.hash,
    blockNumber: consuming.blockNumber.toString(),
  };
}
