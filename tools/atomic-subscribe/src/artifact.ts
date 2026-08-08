import { readFile, writeFile } from "node:fs/promises";
import type { AtomicSubscribePreview } from "./preflight.js";

export type SentAtomicSubscribe = {
  version: 1;
  preview: AtomicSubscribePreview;
  xrplTransactionHash: string;
  sentAt: string;
  execution: "PENDING";
};

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
  if (preview.instruction.calls.length !== 2) throw new Error("preview must contain exactly two calls");
}
