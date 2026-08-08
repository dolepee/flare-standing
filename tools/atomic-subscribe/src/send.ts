import { resolve } from "node:path";
import { Client, Wallet, xrpToDrops } from "xrpl";
import {
  assertFreshPreviewMatches,
  assertPreviewIntegrity,
  readJson,
  writePrivateJson,
  type SentAtomicSubscribe,
} from "./artifact.js";
import type { AtomicSubscribePreview } from "./preflight.js";
import { buildAtomicSubscribePreview } from "./preflight.js";

const requiredConfirmation = "APPROVE STANDING ATOMIC XRPL SUBSCRIPTION";
if (process.env.CONFIRM_SEND !== requiredConfirmation) {
  throw new Error(`Refusing to send. Set CONFIRM_SEND exactly to: ${requiredConfirmation}`);
}

const previewPath = resolve(process.env.PREVIEW_FILE ?? "atomic-subscribe-preview.json");
const outputPath = resolve(process.env.SENT_FILE ?? "atomic-subscribe-sent.json");
const seed = process.env.XRPL_SEED;
if (!seed) throw new Error("XRPL_SEED is required");

const preview = await readJson<AtomicSubscribePreview>(previewPath);
assertPreviewIntegrity(preview);
const fresh = await buildAtomicSubscribePreview({
  xrplAddress: preview.xrplSource,
  planId: BigInt(preview.plan.id),
  deposit: preview.deposit.display,
  standing: preview.standing,
});
assertFreshPreviewMatches(preview, fresh);
const wallet = Wallet.fromSeed(seed);
if (wallet.address !== preview.xrplSource) {
  throw new Error(`XRPL_SEED derives ${wallet.address}, but preview is bound to ${preview.xrplSource}`);
}

const client = new Client(process.env.XRPL_TESTNET_RPC_URL ?? "wss://s.altnet.rippletest.net:51233");
await client.connect();
try {
  const balanceDrops = BigInt(xrpToDrops(await client.getXrpBalance(wallet.address)));
  const paymentDrops = BigInt(preview.payment.totalPaymentUBA);
  if (balanceDrops <= paymentDrops) {
    throw new Error(`XRPL balance is not sufficient for ${preview.payment.totalPaymentXrp} XRP plus network reserve and fee`);
  }

  const transaction = await client.autofill({
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: preview.xrplDestination,
    Amount: preview.payment.totalPaymentUBA,
    Memos: [{ Memo: { MemoData: preview.instruction.memoData.slice(2) } }],
  });
  if ("DestinationTag" in transaction) throw new Error("autofilled transaction unexpectedly contains DestinationTag");
  const signed = wallet.sign(transaction);
  const result = await client.submitAndWait(signed.tx_blob);
  if (result.result.meta === undefined || typeof result.result.meta === "string" || result.result.meta.TransactionResult !== "tesSUCCESS") {
    throw new Error(`XRPL payment failed: ${JSON.stringify(result.result.meta)}`);
  }

  const sent: SentAtomicSubscribe = {
    version: 1,
    preview,
    xrplTransactionHash: result.result.hash,
    sentAt: new Date().toISOString(),
    execution: "PENDING",
  };
  await writePrivateJson(outputPath, sent);
  console.log(`XRPL payment validated: ${result.result.hash}`);
  console.log(`Executor artifact written to ${outputPath}`);
} finally {
  await client.disconnect();
}
