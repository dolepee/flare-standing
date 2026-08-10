import {
  decodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type AbiParameter,
  type Address,
  type ContractFunctionArgs,
  type Hex,
  type PublicClient,
  type TransactionSerialized,
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
import {
  captureFinalizedNonceAnchor,
  proveFinalizedNonceDisposition,
  viemFinalizedNonceRpc,
  type FinalizedNonceAnchor,
} from "./coston2-nonce-recovery.js";

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
  phase: "PREPARED" | "SIGNED" | "REQUESTED" | "RETRYABLE" | "ROUND_IDENTIFIED";
  requestTransactionHash?: Hex;
  serializedRequestTransaction?: Hex;
  requestTransactionNonce?: number;
  requestNonceAnchor?: FinalizedNonceAnchor;
  minimumRequestNonce?: number;
  revertedRequestTransactions?: readonly {
    transactionHash: Hex;
    nonce: number;
    blockNumber: string;
    revertedAt: string;
  }[];
  displacedRequestTransactions?: readonly {
    transactionHash: Hex;
    nonce: number;
    consumingTransactionHash: Hex;
    blockNumber: string;
    displacedAt: string;
  }[];
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

function assertTransactionNonce(nonce: unknown, label: string): asserts nonce is number {
  if (typeof nonce !== "number" || !Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error(`${label} omitted a safe transaction nonce`);
  }
}

function signedTransactionNonce(state: FdcProofRequestState): number {
  if (!state.serializedRequestTransaction) {
    throw new Error("persisted FDC request omitted its signed transaction nonce");
  }
  const nonce = parseTransaction(state.serializedRequestTransaction).nonce;
  assertTransactionNonce(nonce, "persisted FDC request");
  if (state.requestTransactionNonce !== undefined) {
    assertTransactionNonce(state.requestTransactionNonce, "persisted FDC request");
    if (state.requestTransactionNonce !== nonce) {
      throw new Error("persisted FDC request nonce does not match its signed transaction");
    }
  }
  return nonce;
}

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
    if (Boolean(state.requestTransactionHash) !== Boolean(state.serializedRequestTransaction)) {
      throw new Error("persisted FDC request has an incomplete signed transaction");
    }
    if (Boolean(state.requestTransactionHash) !== Boolean(state.requestNonceAnchor)) {
      throw new Error("persisted FDC request has an incomplete finalized nonce anchor");
    }
    if (
      state.requestTransactionHash &&
      state.serializedRequestTransaction &&
      keccak256(state.serializedRequestTransaction).toLowerCase() !== state.requestTransactionHash.toLowerCase()
    ) {
      throw new Error("persisted FDC request hash does not match its signed transaction");
    }
    if (state.serializedRequestTransaction) {
      const signer = await recoverTransactionAddress({
        serializedTransaction: state.serializedRequestTransaction as TransactionSerialized,
      });
      if (signer.toLowerCase() !== input.walletClient.account!.address.toLowerCase()) {
        throw new Error("persisted FDC request was signed by a different executor account");
      }
    }
    if (state.phase === "RETRYABLE") {
      if (state.requestTransactionHash || state.serializedRequestTransaction || state.requestNonceAnchor) {
        throw new Error("retryable FDC request still contains a reverted signed transaction");
      }
      assertTransactionNonce(state.minimumRequestNonce, "retryable FDC request");
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
    let retryNonce: number | undefined;
    if (state.phase === "RETRYABLE") {
      assertTransactionNonce(state.minimumRequestNonce, "retryable FDC request");
      const pendingNonce = await input.client.getTransactionCount({
        address: input.walletClient.account!.address,
        blockTag: "pending",
      });
      retryNonce = Math.max(pendingNonce, state.minimumRequestNonce);
    }
    const requestNonceAnchor = await captureFinalizedNonceAnchor(
      viemFinalizedNonceRpc(input.client),
      input.walletClient.account!.address,
    );
    const preparedTransaction = await input.walletClient.prepareTransactionRequest({
      account: input.walletClient.account!,
      chain: input.walletClient.chain,
      to: fdcHub,
      data: encodeFunctionData({ abi: fdcHubAbi, functionName: "requestAttestation", args: [request] }),
      value: requestFee,
      ...(retryNonce !== undefined ? { nonce: retryNonce } : {}),
    });
    const requestTransactionNonce = (preparedTransaction as { nonce?: number }).nonce;
    assertTransactionNonce(requestTransactionNonce, "prepared FDC request");
    if (requestNonceAnchor.transactionCount !== requestTransactionNonce) {
      throw new Error("prepared FDC request nonce does not equal its finalized pre-sign account nonce");
    }
    if (retryNonce !== undefined && requestTransactionNonce < retryNonce) {
      throw new Error("prepared FDC retry did not advance beyond the consumed nonce");
    }
    const serializedRequestTransaction = await input.walletClient.signTransaction(preparedTransaction as never);
    const signedNonce = parseTransaction(serializedRequestTransaction).nonce;
    assertTransactionNonce(signedNonce, "signed FDC request");
    if (signedNonce !== requestTransactionNonce) {
      throw new Error("signed FDC request did not preserve the prepared nonce");
    }
    const signedAddress = await recoverTransactionAddress({
      serializedTransaction: serializedRequestTransaction as TransactionSerialized,
    });
    if (signedAddress.toLowerCase() !== input.walletClient.account!.address.toLowerCase()) {
      throw new Error("signed FDC request did not preserve the configured executor account");
    }
    const hash = keccak256(serializedRequestTransaction);
    if (state.revertedRequestTransactions?.some(
      (reverted) => reverted.transactionHash.toLowerCase() === hash.toLowerCase(),
    )) {
      throw new Error("prepared FDC retry reused a reverted transaction hash");
    }
    if (state.displacedRequestTransactions?.some(
      (displaced) => displaced.transactionHash.toLowerCase() === hash.toLowerCase(),
    )) {
      throw new Error("prepared FDC retry reused a nonce-displaced transaction hash");
    }
    state = {
      ...state,
      phase: "SIGNED",
      requestTransactionHash: hash,
      serializedRequestTransaction,
      requestTransactionNonce,
      requestNonceAnchor,
      updatedAt: new Date().toISOString(),
    };
    await input.onState?.(state);
  }
  const requestTransactionHash = state.requestTransactionHash;
  const serializedRequestTransaction = state.serializedRequestTransaction;
  const requestNonceAnchor = state.requestNonceAnchor;
  if (!requestTransactionHash || !serializedRequestTransaction || !requestNonceAnchor) {
    throw new Error("persisted FDC request omitted its signed transaction");
  }
  let receipt: Awaited<ReturnType<typeof input.client.waitForTransactionReceipt>>;
  if (state.phase === "SIGNED" || state.phase === "REQUESTED") {
    try {
      const broadcastHash = await input.client.sendRawTransaction({ serializedTransaction: serializedRequestTransaction });
      if (broadcastHash.toLowerCase() !== requestTransactionHash.toLowerCase()) {
        throw new Error("FDC broadcast hash did not match the persisted signed transaction");
      }
      if (state.phase !== "REQUESTED") {
        state = { ...state, phase: "REQUESTED", updatedAt: new Date().toISOString() };
        await input.onState?.(state);
      }
      receipt = await input.client.waitForTransactionReceipt({ hash: requestTransactionHash });
    } catch (error) {
      // Cover both an immediate nonce-too-low broadcast failure and a hash that
      // entered a mempool but later lost the nonce race before receipt wait.
      const nonce = signedTransactionNonce(state);
      const disposition = await proveFinalizedNonceDisposition({
        rpc: viemFinalizedNonceRpc(input.client),
        anchor: requestNonceAnchor,
        executorAddress: input.walletClient.account!.address,
        nonce,
        signedTransactionHash: requestTransactionHash,
      });
      if (disposition.kind === "NOT_CONSUMED") throw error;
      if (disposition.kind === "EXACT_HASH_MINED") {
        receipt = await input.client.getTransactionReceipt({ hash: requestTransactionHash });
      } else {
        const displacedAt = new Date().toISOString();
        const {
          requestTransactionHash: _requestTransactionHash,
          serializedRequestTransaction: _serializedRequestTransaction,
          requestTransactionNonce: _requestTransactionNonce,
          requestNonceAnchor: _requestNonceAnchor,
          requestBlockNumber: _requestBlockNumber,
          votingRoundId: _votingRoundId,
          protocolId: _protocolId,
          relay: _relay,
          ...retryableBase
        } = state;
        state = {
          ...retryableBase,
          phase: "RETRYABLE",
          minimumRequestNonce: nonce + 1,
          displacedRequestTransactions: [
            ...(state.displacedRequestTransactions ?? []),
            {
              transactionHash: requestTransactionHash,
              nonce,
              consumingTransactionHash: disposition.transactionHash,
              blockNumber: disposition.blockNumber,
              displacedAt,
            },
          ],
          updatedAt: displacedAt,
        };
        await input.onState?.(state);
        throw new Error(
          `FDC request nonce ${nonce} was consumed by finalized transaction ${disposition.transactionHash}; ` +
            "retry state persisted, rerun once to sign the same request at a fresh nonce",
        );
      }
    }
  } else {
    receipt = await input.client.waitForTransactionReceipt({ hash: requestTransactionHash });
  }
  if (receipt.status !== "success") {
    const nonce = signedTransactionNonce(state);
    const revertedAt = new Date().toISOString();
    const {
      requestTransactionHash: _requestTransactionHash,
      serializedRequestTransaction: _serializedRequestTransaction,
      requestTransactionNonce: _requestTransactionNonce,
      requestNonceAnchor: _requestNonceAnchor,
      requestBlockNumber: _requestBlockNumber,
      votingRoundId: _votingRoundId,
      protocolId: _protocolId,
      relay: _relay,
      ...retryableBase
    } = state;
    state = {
      ...retryableBase,
      phase: "RETRYABLE",
      minimumRequestNonce: nonce + 1,
      revertedRequestTransactions: [
        ...(state.revertedRequestTransactions ?? []),
        {
          transactionHash: requestTransactionHash,
          nonce,
          blockNumber: receipt.blockNumber.toString(),
          revertedAt,
        },
      ],
      updatedAt: revertedAt,
    };
    await input.onState?.(state);
    throw new Error(
      `FDC request transaction reverted: ${requestTransactionHash}; retry state persisted, rerun once after revalidation`,
    );
  }
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
