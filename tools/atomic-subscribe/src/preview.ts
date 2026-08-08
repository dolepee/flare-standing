import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAddress } from "viem";
import { buildAtomicSubscribePreview } from "./preflight.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const preview = await buildAtomicSubscribePreview({
  xrplAddress: required("XRPL_ADDRESS"),
  planId: BigInt(process.env.PLAN_ID ?? "4"),
  deposit: process.env.DEPOSIT_FXRP ?? "1",
  ...(process.env.STANDING_ADDRESS ? { standing: getAddress(process.env.STANDING_ADDRESS) } : {}),
});

const json = `${JSON.stringify(preview, null, 2)}\n`;
const output = process.env.OUTPUT;
if (output) {
  const path = resolve(output);
  await writeFile(path, json, { mode: 0o600 });
  console.log(`Atomic subscription preview written to ${path}`);
} else {
  process.stdout.write(json);
}
