import { resolve } from "node:path";
import { getAddress } from "viem";
import { writePrivateJson } from "./artifact.js";
import { buildCancelWithdrawPreview } from "./control.js";

const xrplAddress = process.env.XRPL_ADDRESS;
if (!xrplAddress) throw new Error("XRPL_ADDRESS is required");
const mandateIdRaw = process.env.MANDATE_ID;
if (!mandateIdRaw || !/^\d+$/.test(mandateIdRaw)) throw new Error("MANDATE_ID must be a positive integer");
const standingAddress = process.env.STANDING_ADDRESS;
if (!standingAddress) throw new Error("STANDING_ADDRESS is required");
const authorizationMint = process.env.AUTHORIZATION_MINT_FXRP;
if (!authorizationMint) {
  throw new Error("AUTHORIZATION_MINT_FXRP is required and is the reviewed net FXRP minted to the Personal Account");
}

const preview = await buildCancelWithdrawPreview({
  xrplAddress,
  mandateId: BigInt(mandateIdRaw),
  authorizationMint,
  standing: getAddress(standingAddress),
});
const outputPath = resolve(process.env.PREVIEW_FILE ?? "atomic-cancel-withdraw-preview.json");
await writePrivateJson(outputPath, preview);
console.log(JSON.stringify(preview, null, 2));
console.log(`Review artifact written to ${outputPath}`);
console.log("No XRPL payment or Flare transaction has been sent.");
