import type { ExecutionProgress } from "./artifact.js";

export type DelayedMintResumeDecision =
  | { action: "WAIT"; executionAllowedAt: bigint }
  | { action: "REUSE_PERSISTED_PROOF" };

export function decideDelayedMintResume(input: {
  progress: ExecutionProgress;
  delayState: number;
  executionAllowedAt: bigint;
  now: bigint;
}): DelayedMintResumeDecision {
  if (input.progress.phase !== "DELAYED") throw new Error("execution is not in the delayed-mint phase");
  if (!input.progress.proof) throw new Error("delayed mint cannot resume without its persisted FDC proof");
  if (input.delayState === 1 && input.executionAllowedAt > input.now) {
    return { action: "WAIT", executionAllowedAt: input.executionAllowedAt };
  }
  return { action: "REUSE_PERSISTED_PROOF" };
}
