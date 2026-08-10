import { acquireExecutionLock } from "../../src/artifact.js";

const [lockPath, xrplTransactionHash, executorAddress] = process.argv.slice(2);
if (!lockPath || !xrplTransactionHash || !executorAddress) {
  throw new Error("lockPath, xrplTransactionHash, and executorAddress are required");
}

const lock = acquireExecutionLock(lockPath, {
  xrplTransactionHash,
  userOperationHash: `0x${"33".repeat(32)}`,
  executorAddress,
});

function shutdown(code: number): void {
  lock.release();
  process.exit(code);
}

process.once("SIGTERM", () => shutdown(0));
process.once("SIGINT", () => shutdown(0));
process.stdout.write("LOCKED\n");
setInterval(() => undefined, 1_000);
