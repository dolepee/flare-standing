import { resolve } from "node:path";
import { getAddress } from "viem";
import { writePrivateJson } from "./artifact.js";
import { buildAtomicSubscribePreview } from "./preflight.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const preview = await buildAtomicSubscribePreview({
  xrplAddress: required("XRPL_ADDRESS"),
  planId: BigInt(required("PLAN_ID")),
  deposit: process.env.DEPOSIT_FXRP ?? "1",
  maxInitialChargeFxrp: required("MAX_INITIAL_CHARGE_FXRP"),
  standing: getAddress(required("STANDING_ADDRESS")),
});

const json = `${JSON.stringify(preview, null, 2)}\n`;
const output = process.env.OUTPUT;
if (output) {
  const path = resolve(output);
  await writePrivateJson(path, preview);
  console.log(`Atomic subscription preview written to ${path}`);
} else {
  process.stdout.write(json);
}
