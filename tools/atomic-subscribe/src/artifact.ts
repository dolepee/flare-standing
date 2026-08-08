import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import type { AtomicSubscribePreview } from "./preflight.js";

type AtomicSubscribeSentBase = {
  version: 1;
  preview: AtomicSubscribePreview;
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
      }
    | {
        execution: "COMPLETE";
        executorTransactionHash: string;
        mandateId: string;
        completedAt: string;
      }
  );

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function writePrivateJsonExclusive(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
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
  await chmod(directory, 0o700);
  await writePrivateJsonExclusive(path, value);
}

export function assertPreviewIntegrity(preview: AtomicSubscribePreview): void {
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
  if (preview.instruction.calls.length !== 2) throw new Error("preview must contain exactly two calls");
}

function criticalFields(preview: AtomicSubscribePreview) {
  return {
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
    nonce: preview.nonce,
    payment: preview.payment,
    instruction: preview.instruction,
  };
}

export function assertFreshPreviewMatches(
  committed: AtomicSubscribePreview,
  fresh: AtomicSubscribePreview,
): void {
  assertPreviewIntegrity(committed);
  assertPreviewIntegrity(fresh);
  if (JSON.stringify(criticalFields(committed)) !== JSON.stringify(criticalFields(fresh))) {
    throw new Error("live atomic-subscribe state drifted from the reviewed artifact");
  }
}
