import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type TransactionSerialized,
} from "viem";
import type { ExecutionAttempt } from "./artifact.js";

export async function validatePersistedExecutionAttempt(
  attempt: ExecutionAttempt,
  expectedSigner: Address,
): Promise<number> {
  if (keccak256(attempt.serializedTransaction).toLowerCase() !== attempt.transactionHash.toLowerCase()) {
    throw new Error("persisted executor transaction hash does not match its signed bytes");
  }
  const parsedNonce = parseTransaction(attempt.serializedTransaction).nonce;
  if (parsedNonce === undefined || !Number.isSafeInteger(parsedNonce) || parsedNonce < 0) {
    throw new Error("persisted executor transaction nonce does not match its signed bytes");
  }
  if (Boolean(attempt.nonce !== undefined) !== Boolean(attempt.nonceAnchor)) {
    throw new Error("persisted executor attempt has an incomplete finalized nonce anchor");
  }
  if (attempt.nonce !== undefined && parsedNonce !== attempt.nonce) {
    throw new Error("persisted executor transaction nonce does not match its signed bytes");
  }
  const signer = await recoverTransactionAddress({
    serializedTransaction: attempt.serializedTransaction as TransactionSerialized,
  });
  if (signer.toLowerCase() !== expectedSigner.toLowerCase()) {
    throw new Error("persisted executor transaction was signed by a different account");
  }
  return parsedNonce;
}
