import { readFile, writeFile } from "node:fs/promises";
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
