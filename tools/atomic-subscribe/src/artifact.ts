import { chmod, link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { dirname, extname, join } from "node:path";
import { decodeFunctionData } from "viem";
import { standingAbi } from "./abis.js";
import type { AtomicSubscribePreview } from "./preflight.js";
import type { AtomicCancelWithdrawPreview } from "./control.js";
import type { FdcProofRequestState, XrpPaymentProof } from "./fdc.js";

export type AtomicOperationPreview = AtomicSubscribePreview | AtomicCancelWithdrawPreview;

export type ExecutionAttempt = {
  transactionHash: `0x${string}`;
  serializedTransaction: `0x${string}`;
  submittedAt: string;
  receiptBlock?: string;
  outcome: "SIGNED" | "PENDING" | "DELAYED" | "REVERTED" | "COMPLETE";
};

export type ExecutionProgress = {
  phase: "CLAIMED" | "FDC_REQUESTED" | "PROOF_READY" | "EXECUTION_SIGNED" | "EXECUTION_SUBMITTED" | "DELAYED" | "RECOVERY_REQUIRED";
  fdc?: FdcProofRequestState;
  proof?: XrpPaymentProof;
  attempts?: ExecutionAttempt[];
  delay?: {
    kind: "DirectMintingDelayed" | "LargeDirectMintingDelayed";
    executionAllowedAt: string;
    observedAt: string;
  };
  lastError?: { at: string; message: string };
  updatedAt: string;
  claimBlockNumber?: string;
};

type AtomicSubscribeSentBase = {
  version: 1;
  preview: AtomicOperationPreview;
  xrplTransactionHash: string;
  sentAt: string;
};

export type SentAtomicSubscribe = AtomicSubscribeSentBase &
  (
    | { execution: "PENDING" }
    | {
        execution: "IN_PROGRESS";
        claimedAt: string;
        executorAddress: string;
        progress: ExecutionProgress;
      }
    | {
        execution: "COMPLETE";
        executorTransactionHash: string;
        mandateId: string;
        completedAt: string;
        controlResult?: {
          withdrawnFxrpAtomic: string;
          returnedToPersonalAccount: string;
        };
      }
  );

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8"), (_key, value: unknown) => {
    if (
      value !== null &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      typeof (value as { $standingBigInt?: unknown }).$standingBigInt === "string"
    ) {
      return BigInt((value as { $standingBigInt: string }).$standingBigInt);
    }
    return value;
  }) as T;
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const data = `${JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $standingBigInt: item.toString() } : item, 2)}\n`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function writePrivateJsonExclusive(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  const temporary = join(directory, `.${randomUUID()}.claim`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify(value, (_key, item: unknown) =>
        typeof item === "bigint" ? { $standingBigInt: item.toString() } : item, 2)}\n`,
      "utf8",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // link(2) is an atomic create-if-absent boundary: one claimant wins,
    // while the winner is always a fully fsynced file rather than a partial
    // write left by a crashed process.
    await link(temporary, path);
    await chmod(path, 0o600);
    await syncDirectory(directory);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function validatedXrplTransactionHash(xrplTransactionHash: string): string {
  if (!/^[A-Fa-f0-9]{64}$/.test(xrplTransactionHash)) {
    throw new Error("invalid XRPL transaction hash in sent artifact");
  }
  return xrplTransactionHash.toLowerCase();
}

export function transactionArtifactPath(basePath: string, xrplTransactionHash: string): string {
  const hash = validatedXrplTransactionHash(xrplTransactionHash);
  const extension = extname(basePath);
  const stem = extension ? basePath.slice(0, -extension.length) : basePath;
  return `${stem}.${hash}${extension || ".json"}`;
}

export function executionClaimPath(
  xrplTransactionHash: string,
  claimDirectory = join(homedir(), ".config", "flare-standing", "atomic-execution-claims"),
): string {
  return join(claimDirectory, `coston2-${validatedXrplTransactionHash(xrplTransactionHash)}.json`);
}

export async function createExecutionClaim(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateJsonExclusive(path, value);
}

export function executionLockPath(
  executorAddress: string,
  lockDirectory = join(homedir(), ".config", "flare-standing", "atomic-execution-locks"),
): string {
  if (!/^0x[A-Fa-f0-9]{40}$/.test(executorAddress)) {
    throw new Error("invalid executor address for execution lock");
  }
  return join(lockDirectory, `coston2-executor-${executorAddress.toLowerCase()}.lock`);
}

export type ExecutionLock = {
  path: string;
  ownerToken: string;
  release: () => void;
};

/**
 * Acquires a process-lifetime file lock with durable holder metadata.
 *
 * This is shared by the XRPL payment journal and the Coston2 executor. A stale
 * lock is deliberately never stolen automatically: an operator must first
 * establish that the recorded process is dead, preserving fail-closed
 * semantics around both payment and execution effects.
 */
export function acquireFailClosedProcessLock(
  path: string,
  label: string,
  identity: Record<string, string | number>,
): ExecutionLock {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const ownerToken = randomUUID();
  const record = {
    ...identity,
    version: 1,
    ownerToken,
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
  };

  let descriptor: number;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST") {
      let holder = "unreadable holder metadata";
      try {
        const existing = JSON.parse(readFileSync(path, "utf8")) as {
          pid?: unknown;
          hostname?: unknown;
          acquiredAt?: unknown;
        };
        holder = `pid ${String(existing.pid ?? "unknown")} on ${String(existing.hostname ?? "unknown")} since ${String(existing.acquiredAt ?? "unknown")}`;
      } catch {
        // Keep the lock fail-closed even when its metadata cannot be parsed.
      }
      throw new Error(
        `${label} is already locked at ${path} by ${holder}; ` +
          "do not remove the lock until the recorded process is confirmed dead",
      );
    }
    throw error;
  }

  try {
    writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(path);
    throw error;
  }

  let released = false;
  return {
    path,
    ownerToken,
    release: () => {
      if (released) return;
      const existing = JSON.parse(readFileSync(path, "utf8")) as { ownerToken?: unknown };
      if (existing.ownerToken !== ownerToken) {
        closeSync(descriptor);
        released = true;
        throw new Error(`refusing to release ${label} owned by another process`);
      }
      closeSync(descriptor);
      unlinkSync(path);
      released = true;
    },
  };
}

/**
 * Holds an atomic create-if-absent lock for the lifetime of one executor process.
 * A stale lock is deliberately never stolen automatically: an operator must first
 * establish that the recorded process is dead, preserving fail-closed semantics.
 */
export function acquireExecutionLock(
  path: string,
  identity: {
    xrplTransactionHash: string;
    userOperationHash: string;
    executorAddress: string;
  },
): ExecutionLock {
  return acquireFailClosedProcessLock(path, "atomic execution", {
    xrplTransactionHash: validatedXrplTransactionHash(identity.xrplTransactionHash),
    userOperationHash: identity.userOperationHash.toLowerCase(),
    executorAddress: identity.executorAddress.toLowerCase(),
  });
}

export function operationKind(preview: AtomicOperationPreview): "SUBSCRIBE_V2" | "CANCEL_WITHDRAW" | "LEGACY_SUBSCRIBE" {
  return "operation" in preview ? preview.operation : "LEGACY_SUBSCRIBE";
}

export function assertPreviewIntegrity(preview: AtomicOperationPreview): void {
  if (preview.network !== "Coston2" || preview.chainId !== 114) throw new Error("preview is not for Coston2");
  if (preview.readiness !== "READY") throw new Error("preview is blocked; resolve every preflight check before sending");
  if (preview.authorization !== "NOT_SENT") throw new Error("preview has already been authorized");
  if (preview.destinationTag !== null) throw new Error("atomic Smart Account payment must not use a destination tag");
  if (preview.instruction.opcode !== "0xFE" || preview.instruction.memoBytes !== 42) {
    throw new Error("preview does not contain a canonical 42-byte 0xFE instruction");
  }
  if (preview.instruction.smartAccountExecutorFeeUBA !== "0") {
    throw new Error("unexpected Smart Account executor fee in 0xFE instruction");
  }
  const operation = operationKind(preview);
  if (operation === "LEGACY_SUBSCRIBE") {
    throw new Error("legacy subscription artifact rejected; create and review a V2 openMandateAndCharge preview with an explicit maximum initial charge");
  }
  if (operation === "SUBSCRIBE_V2" && preview.instruction.calls.length !== 2) {
    throw new Error("subscription preview must contain exactly two calls");
  }
  if (operation === "CANCEL_WITHDRAW" && preview.instruction.calls.length !== 1) {
    throw new Error("cancel-withdraw preview must contain exactly one drift-safe contract call");
  }
  if (operation === "CANCEL_WITHDRAW") {
    if (!("control" in preview)) throw new Error("cancel-withdraw preview omitted its control binding");
    const call = preview.instruction.calls[0]!;
    if (call.target.toLowerCase() !== preview.standing.toLowerCase() || call.value !== "0") {
      throw new Error("cancel-withdraw preview call target or value does not match the reviewed contract");
    }
    const decoded = decodeFunctionData({ abi: standingAbi, data: call.data });
    if (decoded.functionName !== "cancelAndWithdrawExact") {
      throw new Error("cancel-withdraw preview must call cancelAndWithdrawExact");
    }
    const [mandateId, expectedRemaining] = decoded.args;
    if (
      mandateId !== BigInt(preview.control.mandateId) ||
      expectedRemaining !== BigInt(preview.control.remainingAtomic)
    ) {
      throw new Error("cancel-withdraw call does not bind the reviewed mandate and exact remaining balance");
    }
  }
}

function criticalFields(preview: AtomicOperationPreview) {
  return {
    operation: operationKind(preview),
    contractVersion: "contractVersion" in preview ? preview.contractVersion : undefined,
    network: preview.network,
    chainId: preview.chainId,
    xrplSource: preview.xrplSource,
    xrplDestination: preview.xrplDestination,
    destinationTag: preview.destinationTag,
    personalAccount: preview.personalAccount,
    standing: preview.standing,
    fxrp: preview.fxrp,
    assetManager: preview.assetManager,
    plan: preview.plan,
    deposit: preview.deposit,
    maxInitialChargeFxrp: "maxInitialChargeFxrp" in preview ? preview.maxInitialChargeFxrp : undefined,
    nonce: preview.nonce,
    payment: preview.payment,
    instruction: preview.instruction,
    control: "control" in preview ? preview.control : undefined,
  };
}

export function assertFreshPreviewMatches(
  committed: AtomicOperationPreview,
  fresh: AtomicOperationPreview,
): void {
  assertPreviewIntegrity(committed);
  assertPreviewIntegrity(fresh);
  if (JSON.stringify(criticalFields(committed)) !== JSON.stringify(criticalFields(fresh))) {
    throw new Error("live atomic-subscribe state drifted from the reviewed artifact");
  }
}
