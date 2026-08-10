import { mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { hashes } from "xrpl";
import {
  assertFreshPreviewMatches,
  readJson,
  transactionArtifactPath,
  writePrivateJson,
  writePrivateJsonExclusive,
  type AtomicOperationPreview,
  type SentAtomicSubscribe,
} from "./artifact.js";

type PreparedPaymentState<Transaction> = {
  version: 1;
  phase: "PREPARED";
  preview: AtomicOperationPreview;
  preparedTransaction: Transaction;
  preparedAt: string;
};

type SignedPaymentState<Transaction> = Omit<PreparedPaymentState<Transaction>, "phase"> & {
  phase: "SIGNED";
  signedTransactionBlob: string;
  xrplTransactionHash: string;
  signedAt: string;
};

type ValidatedPaymentState<Transaction> = Omit<SignedPaymentState<Transaction>, "phase"> & {
  phase: "VALIDATED";
  validatedAt: string;
  sentArtifactPath: string;
};

export type XrplPaymentState<Transaction = unknown> =
  | PreparedPaymentState<Transaction>
  | SignedPaymentState<Transaction>
  | ValidatedPaymentState<Transaction>;

export type XrplTransactionOutcome = {
  hash: string;
  validated: boolean;
  transactionResult?: string;
};

export type DurableXrplPaymentResult = {
  xrplTransactionHash: string;
  statePath: string;
  sentArtifactPath: string;
  resumed: boolean;
};

type RunDurableXrplPaymentInput<Transaction> = {
  preview: AtomicOperationPreview;
  outputBasePath: string;
  validateBeforeSigning: () => Promise<void>;
  prepareTransaction: () => Promise<Transaction>;
  signTransaction: (transaction: Transaction) => { tx_blob: string; hash: string };
  lookupTransaction: (hash: string) => Promise<XrplTransactionOutcome | null>;
  broadcastAndWait: (signedTransactionBlob: string) => Promise<XrplTransactionOutcome>;
  now?: () => string;
};

function validatedHash(hash: string, label: string): string {
  if (!/^[A-Fa-f0-9]{64}$/.test(hash)) throw new Error(`${label} is not a valid XRPL transaction hash`);
  return hash.toUpperCase();
}

function validatedOperationHash(operationHash: string): string {
  if (!/^0x[A-Fa-f0-9]{64}$/.test(operationHash)) {
    throw new Error("preview user operation hash is invalid");
  }
  return operationHash.slice(2).toLowerCase();
}

export function xrplPaymentStatePath(basePath: string, operationHash: string): string {
  const digest = validatedOperationHash(operationHash);
  const extension = extname(basePath);
  const stem = extension ? basePath.slice(0, -extension.length) : basePath;
  return `${stem}.xrpl-${digest}.state.json`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

async function readStateIfPresent<Transaction>(path: string): Promise<XrplPaymentState<Transaction> | null> {
  try {
    return await readJson<XrplPaymentState<Transaction>>(path);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function ensureSentArtifact(path: string, sent: SentAtomicSubscribe): Promise<string> {
  try {
    const existing = await readJson<SentAtomicSubscribe>(path);
    if (existing.version !== 1) throw new Error("existing executor artifact has an unsupported version");
    if (
      validatedHash(existing.xrplTransactionHash, "existing executor XRPL transaction hash") !==
      validatedHash(sent.xrplTransactionHash, "expected executor XRPL transaction hash")
    ) {
      throw new Error("existing executor artifact is bound to a different XRPL transaction");
    }
    assertFreshPreviewMatches(existing.preview, sent.preview);
    // Preserve IN_PROGRESS/COMPLETE executor state. The sender owns payment
    // recovery only and must never rewind downstream execution to PENDING.
    return existing.sentAt;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    await writePrivateJson(path, sent);
    return sent.sentAt;
  }
}

function assertStateIntegrity<Transaction>(
  state: XrplPaymentState<Transaction>,
  preview: AtomicOperationPreview,
): void {
  if (state.version !== 1) throw new Error("unsupported XRPL payment-state version");
  assertFreshPreviewMatches(state.preview, preview);
  if (state.phase === "PREPARED") return;
  const storedHash = validatedHash(state.xrplTransactionHash, "persisted XRPL transaction hash");
  const blobHash = validatedHash(hashes.hashSignedTx(state.signedTransactionBlob), "signed XRPL transaction hash");
  if (storedHash !== blobHash) throw new Error("persisted XRPL transaction hash does not match the signed transaction bytes");
}

function assertSuccessfulOutcome(outcome: XrplTransactionOutcome, expectedHash: string): void {
  if (validatedHash(outcome.hash, "XRPL result hash") !== expectedHash) {
    throw new Error("XRPL result hash does not match the persisted signed transaction");
  }
  if (!outcome.validated) throw new Error("XRPL payment did not reach a validated ledger");
  if (outcome.transactionResult !== "tesSUCCESS") {
    throw new Error(`XRPL payment failed with ${outcome.transactionResult ?? "an unknown result"}`);
  }
}

/**
 * Persist-before-effect XRPL sender.
 *
 * The reviewed, autofilled transaction is written as PREPARED before signing.
 * The exact signed bytes and their hash are then written as SIGNED before any
 * broadcast. Every resume reconciles or rebroadcasts those same bytes, so a
 * timeout or process crash can never turn into a second payment.
 */
export async function runDurableXrplPayment<Transaction>(
  input: RunDurableXrplPaymentInput<Transaction>,
): Promise<DurableXrplPaymentResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const statePath = xrplPaymentStatePath(input.outputBasePath, input.preview.instruction.userOperationHash);
  let state = await readStateIfPresent<Transaction>(statePath);
  const resumed = state !== null;
  let validatedBeforeSigning = false;

  if (state === null) {
    await input.validateBeforeSigning();
    validatedBeforeSigning = true;
    const prepared: PreparedPaymentState<Transaction> = {
      version: 1,
      phase: "PREPARED",
      preview: input.preview,
      preparedTransaction: await input.prepareTransaction(),
      preparedAt: now(),
    };
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    try {
      await writePrivateJsonExclusive(statePath, prepared);
      state = prepared;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      state = await readJson<XrplPaymentState<Transaction>>(statePath);
    }
  }

  assertStateIntegrity(state, input.preview);

  if (state.phase === "PREPARED") {
    // PREPARED has no irreversible effect. If the process died before signing,
    // re-check live state so a stale contract nonce/mandate cannot turn into a
    // fresh XRP payment on resume.
    if (!validatedBeforeSigning) await input.validateBeforeSigning();
    const signed = input.signTransaction(state.preparedTransaction);
    const signedHash = validatedHash(signed.hash, "wallet-supplied XRPL transaction hash");
    const derivedHash = validatedHash(hashes.hashSignedTx(signed.tx_blob), "signed XRPL transaction hash");
    if (signedHash !== derivedHash) throw new Error("wallet-supplied XRPL hash does not match the signed transaction bytes");
    const signedState: SignedPaymentState<Transaction> = {
      ...state,
      phase: "SIGNED",
      signedTransactionBlob: signed.tx_blob,
      xrplTransactionHash: signedHash,
      signedAt: now(),
    };
    await writePrivateJson(statePath, signedState);
    state = signedState;
  }

  assertStateIntegrity(state, input.preview);
  const expectedHash = validatedHash(state.xrplTransactionHash, "persisted XRPL transaction hash");
  const sentArtifactPath = transactionArtifactPath(input.outputBasePath, expectedHash);

  if (state.phase === "VALIDATED") {
    if (state.sentArtifactPath !== sentArtifactPath) {
      throw new Error("persisted XRPL payment state points at an unexpected sent artifact");
    }
    // Repair a missing executor artifact without touching XRPL, while
    // preserving any downstream executor progress already stored there.
    await ensureSentArtifact(sentArtifactPath, {
      version: 1,
      preview: state.preview,
      xrplTransactionHash: expectedHash,
      sentAt: state.validatedAt,
      execution: "PENDING",
    });
    return { xrplTransactionHash: expectedHash, statePath, sentArtifactPath, resumed };
  }

  const existing = await input.lookupTransaction(expectedHash);
  let outcome = existing;
  if (outcome?.validated === true) {
    assertSuccessfulOutcome(outcome, expectedHash);
  } else {
    outcome = await input.broadcastAndWait(state.signedTransactionBlob);
    assertSuccessfulOutcome(outcome, expectedHash);
  }

  const observedValidatedAt = now();
  const sent: SentAtomicSubscribe = {
    version: 1,
    preview: state.preview,
    xrplTransactionHash: expectedHash,
    sentAt: observedValidatedAt,
    execution: "PENDING",
  };
  // The executor artifact is durable before the journal advances. A crash in
  // between simply causes the next run to reconcile and rewrite the same file.
  const validatedAt = await ensureSentArtifact(sentArtifactPath, sent);
  await writePrivateJson(statePath, {
    ...state,
    phase: "VALIDATED",
    validatedAt,
    sentArtifactPath,
  } satisfies ValidatedPaymentState<Transaction>);

  return { xrplTransactionHash: expectedHash, statePath, sentArtifactPath, resumed };
}
