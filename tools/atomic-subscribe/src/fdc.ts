import {
  decodeAbiParameters,
  encodeFunctionData,
  keccak256,
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

export type FdcProofRequestState = {
  version: 1;
  transactionId: Hex;
  proofOwner: Address;
  requestBytes: Hex;
  phase: "PREPARED" | "SIGNED" | "REQUESTED" | "ROUND_IDENTIFIED";
  requestTransactionHash?: Hex;
  serializedRequestTransaction?: Hex;
  requestBlockNumber?: string;
  votingRoundId?: number;
  protocolId?: number;
  relay?: Address;
  createdAt: string;
  updatedAt: string;
};

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
  resume?: FdcProofRequestState;
  onState?: (state: FdcProofRequestState) => Promise<void>;
}): Promise<{ proof: XrpPaymentProof; state: FdcProofRequestState }> {
  let state = input.resume;
  if (state) {
    if (state.version !== 1 || state.transactionId.toLowerCase() !== input.transactionId.toLowerCase()) {
      throw new Error("persisted FDC request is bound to a different XRPL transaction");
    }
    if (state.proofOwner.toLowerCase() !== input.proofOwner.toLowerCase()) {
      throw new Error("persisted FDC request is bound to a different proof owner");
    }
  } else {
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
    const now = new Date().toISOString();
    state = {
      version: 1,
      transactionId: input.transactionId,
      proofOwner: input.proofOwner,
      requestBytes: request,
      phase: "PREPARED",
      createdAt: now,
      updatedAt: now,
    };
    await input.onState?.(state);
  }
  const request = state.requestBytes;

  const [fdcHub, flareSystemsManager, relay, fdcVerification] = await Promise.all([
    contractAddress(input.client, "FdcHub"),
    contractAddress(input.client, "FlareSystemsManager"),
    contractAddress(input.client, "Relay"),
    contractAddress(input.client, "FdcVerification"),
  ]);
  if (!state.requestTransactionHash || !state.serializedRequestTransaction) {
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
    const preparedTransaction = await input.walletClient.prepareTransactionRequest({
      account: input.walletClient.account!,
      chain: input.walletClient.chain,
      to: fdcHub,
      data: encodeFunctionData({ abi: fdcHubAbi, functionName: "requestAttestation", args: [request] }),
      value: requestFee,
    });
    const serializedRequestTransaction = await input.walletClient.signTransaction(preparedTransaction as never);
    const hash = keccak256(serializedRequestTransaction);
    state = {
      ...state,
      phase: "SIGNED",
      requestTransactionHash: hash,
      serializedRequestTransaction,
      updatedAt: new Date().toISOString(),
    };
    await input.onState?.(state);
  }
  const requestTransactionHash = state.requestTransactionHash;
  const serializedRequestTransaction = state.serializedRequestTransaction;
  if (!requestTransactionHash || !serializedRequestTransaction) {
    throw new Error("persisted FDC request omitted its signed transaction");
  }
  if (state.phase === "SIGNED" || state.phase === "REQUESTED") {
    try {
      const broadcastHash = await input.client.sendRawTransaction({ serializedTransaction: serializedRequestTransaction });
      if (broadcastHash.toLowerCase() !== requestTransactionHash.toLowerCase()) {
        throw new Error("FDC broadcast hash did not match the persisted signed transaction");
      }
    } catch (error) {
      // A network failure may happen after the node accepted the exact signed
      // transaction. If the hash is now visible, continue; otherwise retain
      // SIGNED so the next run rebroadcasts the same bytes and nonce.
      const visible = await input.client.getTransaction({ hash: requestTransactionHash }).then(() => true).catch(async () =>
        input.client.getTransactionReceipt({ hash: requestTransactionHash }).then(() => true).catch(() => false));
      if (!visible) throw error;
    }
    if (state.phase !== "REQUESTED") {
      state = { ...state, phase: "REQUESTED", updatedAt: new Date().toISOString() };
      await input.onState?.(state);
    }
  }
  const receipt = await input.client.waitForTransactionReceipt({ hash: requestTransactionHash });
  if (receipt.status !== "success") throw new Error(`FDC request transaction reverted: ${requestTransactionHash}`);
  if (state.votingRoundId === undefined || state.protocolId === undefined || !state.relay) {
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
    state = {
      ...state,
      phase: "ROUND_IDENTIFIED",
      requestBlockNumber: receipt.blockNumber.toString(),
      votingRoundId: Number((block.timestamp - firstRoundStart) / roundDuration),
      protocolId: Number(protocolId),
      relay,
      updatedAt: new Date().toISOString(),
    };
    await input.onState?.(state);
  }
  const votingRoundId = state.votingRoundId;
  const protocolId = state.protocolId;
  const relayAddress = state.relay;
  if (votingRoundId === undefined || protocolId === undefined || !relayAddress) {
    throw new Error("persisted FDC request omitted finalized-round metadata");
  }

  const finalizationDeadline = Date.now() + 20 * 60_000;
  for (;;) {
    const finalized = await input.client.readContract({
      address: relayAddress,
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
          proof: {
            merkleProof: (result.proof as readonly Hex[] | undefined) ?? [],
            data: data as XrpPaymentResponse,
          },
          state,
        };
      }
    } catch (error) {
      if (attempt === 20) throw error;
    }
    await sleep(10_000);
  }
  throw new Error(`FDC proof unavailable after 20 polls for round ${votingRoundId}`);
}
