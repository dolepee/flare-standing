import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { hashes, isValidClassicAddress } from "xrpl";
import {
  acquireFailClosedProcessLock,
  assertFreshPreviewMatches,
  operationKind,
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
  sentArtifactBasePath: string;
  preparedTransaction: Transaction;
  preparedAt: string;
  terminalFailures?: TerminalPaymentFailure<Transaction>[];
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

type TerminalFailedPaymentState<Transaction> = Omit<SignedPaymentState<Transaction>, "phase"> & {
  phase: "TERMINAL_FAILURE";
  failedAt: string;
  transactionResult: string;
};

type TerminalPaymentFailure<Transaction> = {
  preparedTransaction: Transaction;
  signedTransactionBlob: string;
  xrplTransactionHash: string;
  signedAt: string;
  failedAt: string;
  transactionResult: string;
};

export type XrplPaymentState<Transaction = unknown> =
  | PreparedPaymentState<Transaction>
  | SignedPaymentState<Transaction>
  | TerminalFailedPaymentState<Transaction>
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
  getValidatedLedgerIndex: () => Promise<number>;
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

function validatedXrplSource(xrplSource: string): string {
  if (!isValidClassicAddress(xrplSource)) {
    throw new Error("preview XRPL source is not a valid classic address");
  }
  return xrplSource;
}

function xrplPaymentJournalDirectory(): string {
  return join(homedir(), ".config", "flare-standing", "atomic-xrpl-payments");
}

export function xrplPaymentStatePath(xrplSource: string, operationHash: string): string {
  const source = validatedXrplSource(xrplSource);
  const digest = validatedOperationHash(operationHash);
  return join(xrplPaymentJournalDirectory(), `xrpl-${source}-${digest}.state.json`);
}

export function xrplPaymentLockPath(xrplSource: string, operationHash: string): string {
  return `${xrplPaymentStatePath(xrplSource, operationHash)}.lock`;
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
  if (!isAbsolute(state.sentArtifactBasePath)) {
    throw new Error("persisted XRPL payment state has a non-canonical sent artifact base path");
  }
  for (const failure of state.terminalFailures ?? []) {
    const failureHash = validatedHash(failure.xrplTransactionHash, "terminal XRPL transaction hash");
    const blobHash = validatedHash(hashes.hashSignedTx(failure.signedTransactionBlob), "terminal signed XRPL transaction hash");
    if (failureHash !== blobHash) {
      throw new Error("terminal XRPL transaction hash does not match the signed transaction bytes");
    }
    assertTerminalResultCode(failure.transactionResult);
  }
  if (state.phase === "PREPARED") return;
  const storedHash = validatedHash(state.xrplTransactionHash, "persisted XRPL transaction hash");
  const blobHash = validatedHash(hashes.hashSignedTx(state.signedTransactionBlob), "signed XRPL transaction hash");
  if (storedHash !== blobHash) throw new Error("persisted XRPL transaction hash does not match the signed transaction bytes");
  if (state.phase === "TERMINAL_FAILURE") assertTerminalResultCode(state.transactionResult);
}

function assertOutcomeIdentity(outcome: XrplTransactionOutcome, expectedHash: string): void {
  if (validatedHash(outcome.hash, "XRPL result hash") !== expectedHash) {
    throw new Error("XRPL result hash does not match the persisted signed transaction");
  }
  if (!outcome.validated) throw new Error("XRPL payment did not reach a validated ledger");
}

function assertTerminalResultCode(transactionResult: string): void {
  // Only tec-class failures can be included in a validated ledger. They consume
  // the fee and account sequence but do not apply the Payment's transfer. This
  // is the protocol-level proof that retrying cannot duplicate delivered XRP.
  if (!/^tec[A-Z0-9_]+$/.test(transactionResult)) {
    throw new Error(`XRPL payment has a non-terminal validated result ${transactionResult}`);
  }
}

function assertSuccessfulOutcome(outcome: XrplTransactionOutcome, expectedHash: string): void {
  assertOutcomeIdentity(outcome, expectedHash);
  if (outcome.transactionResult !== "tesSUCCESS") {
    throw new Error(`XRPL payment failed with ${outcome.transactionResult ?? "an unknown result"}`);
  }
}

function terminalResult(outcome: XrplTransactionOutcome, expectedHash: string): string {
  assertOutcomeIdentity(outcome, expectedHash);
  if (outcome.transactionResult === "tesSUCCESS") {
    throw new Error("XRPL payment unexpectedly succeeded while reconciling a terminal failure");
  }
  if (typeof outcome.transactionResult !== "string") {
    throw new Error("validated XRPL payment omitted its transaction result");
  }
  assertTerminalResultCode(outcome.transactionResult);
  return outcome.transactionResult;
}

function preparedSequence(transaction: unknown): number {
  if (typeof transaction !== "object" || transaction === null || !("Sequence" in transaction)) {
    throw new Error("prepared XRPL transaction omitted Sequence");
  }
  const sequence = (transaction as { Sequence?: unknown }).Sequence;
  if (!Number.isSafeInteger(sequence) || (sequence as number) <= 0) {
    throw new Error("prepared XRPL transaction has an invalid Sequence");
  }
  return sequence as number;
}

function preparedLastLedgerSequence(transaction: unknown): number {
  if (typeof transaction !== "object" || transaction === null || !("LastLedgerSequence" in transaction)) {
    throw new Error("prepared XRPL transaction omitted LastLedgerSequence");
  }
  const sequence = (transaction as { LastLedgerSequence?: unknown }).LastLedgerSequence;
  if (!Number.isSafeInteger(sequence) || (sequence as number) <= 0) {
    throw new Error("prepared XRPL transaction has an invalid LastLedgerSequence");
  }
  return sequence as number;
}

async function validatedLedgerIndex(input: Pick<RunDurableXrplPaymentInput<unknown>, "getValidatedLedgerIndex">): Promise<number> {
  const index = await input.getValidatedLedgerIndex();
  if (!Number.isSafeInteger(index) || index <= 0) {
    throw new Error("XRPL client returned an invalid validated ledger index");
  }
  return index;
}

/**
 * Persist-before-effect XRPL sender.
 *
 * The reviewed, autofilled transaction is written as PREPARED before signing.
 * The exact signed bytes and their hash are then written as SIGNED before any
 * broadcast. An expired PREPARED transaction may be durably refreshed because
 * it has no persisted signature; every SIGNED resume reconciles or, while the
 * transaction remains live, rebroadcasts only those same bytes. A timeout or
 * process crash therefore cannot turn into a second payment.
 */
async function runDurableXrplPaymentLocked<Transaction>(
  input: RunDurableXrplPaymentInput<Transaction>,
  statePath: string,
): Promise<DurableXrplPaymentResult> {
  const now = input.now ?? (() => new Date().toISOString());
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
      // The first invocation chooses the downstream executor artifact. Every
      // replay reuses this durable absolute path even if SENT_FILE changes, so
      // one XRPL payment can never fan out into independently executable files.
      sentArtifactBasePath: resolve(input.outputBasePath),
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

  if (state.phase === "TERMINAL_FAILURE") {
    const failedHash = validatedHash(state.xrplTransactionHash, "persisted terminal XRPL transaction hash");
    const confirmedFailure = await input.lookupTransaction(failedHash);
    if (confirmedFailure === null) {
      throw new Error(`terminal XRPL payment ${failedHash} could not be revalidated; refusing to prepare a replacement`);
    }
    const confirmedResult = terminalResult(confirmedFailure, failedHash);
    if (confirmedResult !== state.transactionResult) {
      throw new Error("revalidated XRPL failure result does not match the persisted terminal result");
    }

    // A retry is never automatic in the invocation that observed the failed
    // payment. A fresh operator invocation reaches this branch, revalidates the
    // exact failed hash, then re-runs every live pre-sign check before asking
    // autofill for the account's next sequence.
    await input.validateBeforeSigning();
    validatedBeforeSigning = true;
    const replacementTransaction = await input.prepareTransaction();
    const failedSequence = preparedSequence(state.preparedTransaction);
    const replacementSequence = preparedSequence(replacementTransaction);
    if (replacementSequence <= failedSequence) {
      throw new Error(
        `replacement XRPL transaction sequence ${replacementSequence} is not after terminal sequence ${failedSequence}`,
      );
    }
    const currentLedger = await validatedLedgerIndex(input);
    const replacementLastLedger = preparedLastLedgerSequence(replacementTransaction);
    if (replacementLastLedger <= currentLedger) {
      throw new Error(
        `replacement XRPL transaction expires at ledger ${replacementLastLedger}, not after validated ledger ${currentLedger}`,
      );
    }

    const replacementState: PreparedPaymentState<Transaction> = {
      version: 1,
      phase: "PREPARED",
      preview: state.preview,
      sentArtifactBasePath: state.sentArtifactBasePath,
      preparedTransaction: replacementTransaction,
      preparedAt: now(),
      terminalFailures: [
        ...(state.terminalFailures ?? []),
        {
          preparedTransaction: state.preparedTransaction,
          signedTransactionBlob: state.signedTransactionBlob,
          xrplTransactionHash: failedHash,
          signedAt: state.signedAt,
          failedAt: state.failedAt,
          transactionResult: state.transactionResult,
        },
      ],
    };
    await writePrivateJson(statePath, replacementState);
    state = replacementState;
  }

  if (state.phase === "PREPARED") {
    // PREPARED has no irreversible effect. If the process died before signing,
    // re-check live state so a stale contract nonce/mandate cannot turn into a
    // fresh XRP payment on resume.
    if (!validatedBeforeSigning) await input.validateBeforeSigning();

    const currentLedger = await validatedLedgerIndex(input);
    const preparedLastLedger = preparedLastLedgerSequence(state.preparedTransaction);
    if (preparedLastLedger <= currentLedger) {
      // PREPARED is the only phase that can be replaced safely: no signed
      // bytes or transaction hash have been persisted and this sender never
      // broadcasts before advancing to SIGNED. Persist the replacement before
      // asking the wallet to sign so another crash remains recoverable.
      const replacementTransaction = await input.prepareTransaction();
      const replacementLastLedger = preparedLastLedgerSequence(replacementTransaction);
      if (replacementLastLedger <= currentLedger) {
        throw new Error(
          `replacement XRPL transaction expires at ledger ${replacementLastLedger}, not after validated ledger ${currentLedger}`,
        );
      }
      const replacementState: PreparedPaymentState<Transaction> = {
        version: 1,
        phase: "PREPARED",
        preview: state.preview,
        sentArtifactBasePath: state.sentArtifactBasePath,
        preparedTransaction: replacementTransaction,
        preparedAt: now(),
        ...(state.terminalFailures === undefined ? {} : { terminalFailures: state.terminalFailures }),
      };
      await writePrivateJson(statePath, replacementState);
      state = replacementState;
    }

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
  const sentArtifactPath = transactionArtifactPath(state.sentArtifactBasePath, expectedHash);

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
    if (outcome.transactionResult !== "tesSUCCESS") {
      const transactionResult = terminalResult(outcome, expectedHash);
      await writePrivateJson(statePath, {
        ...state,
        phase: "TERMINAL_FAILURE",
        failedAt: now(),
        transactionResult,
      } satisfies TerminalFailedPaymentState<Transaction>);
      throw new Error(
        `XRPL payment failed with ${transactionResult}; terminal failure recorded and no XRP was delivered. ` +
          "Run the command again to revalidate and prepare one fresh payment",
      );
    }
    assertSuccessfulOutcome(outcome, expectedHash);
  } else {
    const currentLedger = await validatedLedgerIndex(input);
    const signedLastLedger = preparedLastLedgerSequence(state.preparedTransaction);
    if (signedLastLedger <= currentLedger) {
      throw new Error(
        `persisted SIGNED XRPL transaction ${expectedHash} expired at ledger ${signedLastLedger}; ` +
          "the signed bytes were preserved and must not be replaced without explicit payment reconciliation",
      );
    }
    outcome = await input.broadcastAndWait(state.signedTransactionBlob);
    if (outcome.transactionResult !== "tesSUCCESS") {
      const transactionResult = terminalResult(outcome, expectedHash);
      await writePrivateJson(statePath, {
        ...state,
        phase: "TERMINAL_FAILURE",
        failedAt: now(),
        transactionResult,
      } satisfies TerminalFailedPaymentState<Transaction>);
      throw new Error(
        `XRPL payment failed with ${transactionResult}; terminal failure recorded and no XRP was delivered. ` +
          "Run the command again to revalidate and prepare one fresh payment",
      );
    }
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

/**
 * Serializes the complete payment-state transition for one reviewed operation.
 * The lock covers state reads, expired PREPARED replacement, signing,
 * broadcasting, and final journaling so a concurrent sender can never retain a
 * stale PREPARED snapshot and overwrite a later SIGNED or VALIDATED state.
 */
export async function runDurableXrplPayment<Transaction>(
  input: RunDurableXrplPaymentInput<Transaction>,
): Promise<DurableXrplPaymentResult> {
  const operationHash = input.preview.instruction.userOperationHash;
  const statePath = xrplPaymentStatePath(input.preview.xrplSource, operationHash);
  const lock = acquireFailClosedProcessLock(
    xrplPaymentLockPath(input.preview.xrplSource, operationHash),
    "XRPL payment state",
    {
      operation: operationKind(input.preview),
      userOperationHash: operationHash.toLowerCase(),
      xrplSource: input.preview.xrplSource,
    },
  );

  try {
    return await runDurableXrplPaymentLocked(input, statePath);
  } finally {
    lock.release();
  }
}
