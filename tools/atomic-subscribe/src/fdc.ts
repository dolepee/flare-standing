import {
  decodeAbiParameters,
  toHex,
  type AbiParameter,
  type Address,
  type ContractFunctionArgs,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  fdcHubAbi,
  fdcRequestFeeAbi,
  fdcVerificationAbi,
  flareSystemsManagerAbi,
  registryAbi,
  relayAbi,
  xrpPaymentVerificationAbi,
} from "./abis.js";
import { registryAddress } from "./config.js";

export type XrpPaymentProof = ContractFunctionArgs<
  typeof xrpPaymentVerificationAbi,
  "view",
  "verifyXRPPayment"
>[0];
type XrpPaymentResponse = XrpPaymentProof["data"];

const responseAbi = (
  xrpPaymentVerificationAbi.find(
    (item) => item.type === "function" && "name" in item && item.name === "verifyXRPPayment",
  ) as { inputs: readonly { components?: readonly AbiParameter[] }[] } | undefined
)?.inputs[0]?.components?.[1];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function contractAddress(client: PublicClient, name: string): Promise<Address> {
  return client.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
}

export async function obtainXrpPaymentProof(input: {
  transactionId: Hex;
  proofOwner: Address;
  client: PublicClient;
  walletClient: WalletClient;
  verifierUrl: string;
  verifierApiKey: string;
  daLayerUrl?: string;
}): Promise<XrpPaymentProof> {
  const prepared = await postJson(
    `${input.verifierUrl.replace(/\/$/, "")}/verifier/xrp/XRPPayment/prepareRequest`,
    {
      attestationType: toHex("XRPPayment", { size: 32 }),
      sourceId: toHex("testXRP", { size: 32 }),
      requestBody: { transactionId: input.transactionId, proofOwner: input.proofOwner },
    },
    { "X-API-KEY": input.verifierApiKey },
  );
  if (prepared.status !== "VALID" && !(typeof prepared.status === "string" && prepared.status.startsWith("OK"))) {
    throw new Error(`FDC verifier rejected XRPL payment: ${JSON.stringify(prepared)}`);
  }
  const request = prepared.abiEncodedRequest as Hex | undefined;
  if (!request) throw new Error("FDC verifier response omitted abiEncodedRequest");

  const [fdcHub, flareSystemsManager, relay, fdcVerification] = await Promise.all([
    contractAddress(input.client, "FdcHub"),
    contractAddress(input.client, "FlareSystemsManager"),
    contractAddress(input.client, "Relay"),
    contractAddress(input.client, "FdcVerification"),
  ]);
  const feeConfig = await input.client.readContract({
    address: fdcHub,
    abi: fdcHubAbi,
    functionName: "fdcRequestFeeConfigurations",
  });
  const requestFee = await input.client.readContract({
    address: feeConfig,
    abi: fdcRequestFeeAbi,
    functionName: "getRequestFee",
    args: [request],
  });
  const hash = await input.walletClient.writeContract({
    address: fdcHub,
    abi: fdcHubAbi,
    functionName: "requestAttestation",
    args: [request],
    value: requestFee,
    chain: input.walletClient.chain,
    account: input.walletClient.account!,
  });
  const receipt = await input.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`FDC request transaction reverted: ${hash}`);
  const block = await input.client.getBlock({ blockNumber: receipt.blockNumber });
  const [firstRoundStart, roundDuration, protocolId] = await Promise.all([
    input.client.readContract({
      address: flareSystemsManager,
      abi: flareSystemsManagerAbi,
      functionName: "firstVotingRoundStartTs",
    }),
    input.client.readContract({
      address: flareSystemsManager,
      abi: flareSystemsManagerAbi,
      functionName: "votingEpochDurationSeconds",
    }),
    input.client.readContract({
      address: fdcVerification,
      abi: fdcVerificationAbi,
      functionName: "fdcProtocolId",
    }),
  ]);
  const votingRoundId = Number((block.timestamp - firstRoundStart) / roundDuration);

  const finalizationDeadline = Date.now() + 20 * 60_000;
  for (;;) {
    const finalized = await input.client.readContract({
      address: relay,
      abi: relayAbi,
      functionName: "isFinalized",
      args: [BigInt(protocolId), BigInt(votingRoundId)],
    });
    if (finalized) break;
    if (Date.now() >= finalizationDeadline) {
      throw new Error(`FDC round ${votingRoundId} did not finalize within 20 minutes`);
    }
    await sleep(15_000);
  }

  if (!responseAbi) throw new Error("IXRPPayment response ABI is unavailable");
  const daUrl = `${(input.daLayerUrl ?? "https://ctn2-data-availability.flare.network").replace(/\/$/, "")}/api/v1/fdc/proof-by-request-round-raw`;
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const result = await postJson(daUrl, { votingRoundId, requestBytes: request });
      if (typeof result.response_hex === "string") {
        const [data] = decodeAbiParameters([responseAbi], result.response_hex as Hex);
        return {
          merkleProof: (result.proof as readonly Hex[] | undefined) ?? [],
          data: data as XrpPaymentResponse,
        };
      }
    } catch (error) {
      if (attempt === 20) throw error;
    }
    await sleep(10_000);
  }
  throw new Error(`FDC proof unavailable after 20 polls for round ${votingRoundId}`);
}
