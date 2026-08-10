import { keccak256, stringToHex, type Address, type PublicClient } from "viem";
import { standingAbi } from "./abis.js";

export const STANDING_V2_VERSION = 2n;
export const STANDING_V2_CAPABILITY = keccak256(
  stringToHex("standing.mandates.v2.open-and-charge.cancel-and-withdraw-exact"),
);

export async function requireStandingV2(client: PublicClient, standing: Address): Promise<void> {
  let identity: readonly [bigint, `0x${string}`];
  try {
    identity = await client.readContract({
      address: standing,
      abi: standingAbi,
      functionName: "standingIdentity",
    });
  } catch {
    throw new Error(
      `Standing deployment ${standing} does not expose the required V2 identity; refusing before XRPL authorization`,
    );
  }

  const [version, capability] = identity;
  if (version !== STANDING_V2_VERSION || capability.toLowerCase() !== STANDING_V2_CAPABILITY.toLowerCase()) {
    throw new Error(
      `Standing deployment ${standing} has an incompatible identity; expected V2 capability ${STANDING_V2_CAPABILITY}`,
    );
  }
}
