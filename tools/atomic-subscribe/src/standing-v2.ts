import { getAddress, keccak256, stringToHex, type Address, type PublicClient } from "viem";
import { assetManagerAbi, standingAbi } from "./abis.js";

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

export async function requireStandingFxrpBinding(
  client: PublicClient,
  standing: Address,
  assetManager: Address,
): Promise<Address> {
  let standingFxrp: Address;
  let assetManagerFxrp: Address;
  try {
    [standingFxrp, assetManagerFxrp] = await Promise.all([
      client.readContract({
        address: standing,
        abi: standingAbi,
        functionName: "fxrp",
      }),
      client.readContract({
        address: assetManager,
        abi: assetManagerAbi,
        functionName: "fAsset",
      }),
    ]);
  } catch {
    throw new Error(
      `Unable to verify the FXRP binding between Standing ${standing} and AssetManagerFXRP ${assetManager}; refusing before XRPL authorization`,
    );
  }

  const normalizedStandingFxrp = getAddress(standingFxrp);
  const normalizedAssetManagerFxrp = getAddress(assetManagerFxrp);
  if (normalizedStandingFxrp !== normalizedAssetManagerFxrp) {
    throw new Error(
      `FXRP binding mismatch: Standing.fxrp() is ${normalizedStandingFxrp}, but AssetManagerFXRP.fAsset() is ${normalizedAssetManagerFxrp}; refusing before XRPL authorization`,
    );
  }

  return normalizedAssetManagerFxrp;
}
