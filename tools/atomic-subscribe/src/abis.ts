export const registryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const masterAccountControllerAbi = [
  {
    type: "function",
    name: "getPersonalAccount",
    stateMutability: "view",
    inputs: [{ name: "xrplAddress", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [{ name: "personalAccount", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isTransactionIdUsed",
    stateMutability: "view",
    inputs: [{ name: "transactionId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const assetManagerAbi = [
  {
    type: "function",
    name: "fAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "directMintingPaymentAddress",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "getDirectMintingExecutorFeeUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingFeeBIPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingMinimumFeeUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "directMintingDelayState",
    stateMutability: "view",
    inputs: [{ name: "transactionId", type: "bytes32" }],
    outputs: [
      { name: "delayState", type: "uint8" },
      { name: "allowedAt", type: "uint256" },
      { name: "startedAt", type: "uint256" },
    ],
  },
] as const;

export const standingAbi = [
  {
    type: "function",
    name: "standingIdentity",
    stateMutability: "pure",
    inputs: [],
    outputs: [
      { name: "version", type: "uint256" },
      { name: "capability", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "fxrp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "priceAdapter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "maxPriceAge",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "plans",
    stateMutability: "view",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [
      { name: "merchant", type: "address" },
      { name: "priceUsdMicro", type: "uint256" },
      { name: "priceFxrp", type: "uint256" },
      { name: "periodSeconds", type: "uint32" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "openMandateAndCharge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "planId", type: "uint256" },
      { name: "depositAmount", type: "uint256" },
      { name: "maxInitialChargeFxrp", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawMandate",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAndWithdrawExact",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "uint256" },
      { name: "expectedRemaining", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mandates",
    stateMutability: "view",
    inputs: [{ name: "mandateId", type: "uint256" }],
    outputs: [
      { name: "planId", type: "uint256" },
      { name: "subscriber", type: "address" },
      { name: "deposited", type: "uint256" },
      { name: "remaining", type: "uint256" },
      { name: "nextChargeAt", type: "uint256" },
      { name: "lastChargeAt", type: "uint256" },
      { name: "canceled", type: "bool" },
    ],
  },
] as const;

export const priceAdapterAbi = [
  {
    type: "function",
    name: "getFxrpForUsdMicro",
    stateMutability: "view",
    inputs: [{ name: "usdMicro", type: "uint256" }],
    outputs: [
      { name: "fxrpAmount", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
    ],
  },
] as const;

export const erc20ReadAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const personalAccountAbi = [
  {
    type: "function",
    name: "executeUserOp",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export const standingEventsAbi = [
  {
    type: "event",
    name: "MandateOpened",
    inputs: [
      { name: "mandateId", type: "uint256", indexed: true },
      { name: "planId", type: "uint256", indexed: true },
      { name: "subscriber", type: "address", indexed: true },
      { name: "deposited", type: "uint256", indexed: false },
      { name: "firstChargeAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ChargeExecuted",
    inputs: [
      { name: "mandateId", type: "uint256", indexed: true },
      { name: "merchant", type: "address", indexed: true },
      { name: "merchantAmount", type: "uint256", indexed: false },
      { name: "feeAmount", type: "uint256", indexed: false },
      { name: "nextChargeAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MandateWithdrawn",
    inputs: [
      { name: "mandateId", type: "uint256", indexed: true },
      { name: "subscriber", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

const xrpPaymentResponseComponents = [
  { name: "attestationType", type: "bytes32" },
  { name: "sourceId", type: "bytes32" },
  { name: "votingRound", type: "uint64" },
  { name: "lowestUsedTimestamp", type: "uint64" },
  {
    name: "requestBody",
    type: "tuple",
    components: [
      { name: "transactionId", type: "bytes32" },
      { name: "proofOwner", type: "address" },
    ],
  },
  {
    name: "responseBody",
    type: "tuple",
    components: [
      { name: "blockNumber", type: "uint64" },
      { name: "blockTimestamp", type: "uint64" },
      { name: "sourceAddress", type: "string" },
      { name: "sourceAddressHash", type: "bytes32" },
      { name: "receivingAddressHash", type: "bytes32" },
      { name: "intendedReceivingAddressHash", type: "bytes32" },
      { name: "spentAmount", type: "int256" },
      { name: "intendedSpentAmount", type: "int256" },
      { name: "receivedAmount", type: "int256" },
      { name: "intendedReceivedAmount", type: "int256" },
      { name: "hasMemoData", type: "bool" },
      { name: "firstMemoData", type: "bytes" },
      { name: "hasDestinationTag", type: "bool" },
      { name: "destinationTag", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
  },
] as const;

const xrpPaymentProofComponents = [
  { name: "merkleProof", type: "bytes32[]" },
  { name: "data", type: "tuple", components: xrpPaymentResponseComponents },
] as const;

export const xrpPaymentVerificationAbi = [
  {
    type: "function",
    name: "verifyXRPPayment",
    stateMutability: "view",
    inputs: [{ name: "proof", type: "tuple", components: xrpPaymentProofComponents }],
    outputs: [{ name: "proved", type: "bool" }],
  },
] as const;

export const fdcHubAbi = [
  {
    type: "function",
    name: "fdcRequestFeeConfigurations",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "requestAttestation",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [],
  },
] as const;

export const fdcRequestFeeAbi = [
  {
    type: "function",
    name: "getRequestFee",
    stateMutability: "view",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const flareSystemsManagerAbi = [
  {
    type: "function",
    name: "firstVotingRoundStartTs",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "votingEpochDurationSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export const fdcVerificationAbi = [
  {
    type: "function",
    name: "fdcProtocolId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const relayAbi = [
  {
    type: "function",
    name: "isFinalized",
    stateMutability: "view",
    inputs: [
      { name: "protocolId", type: "uint256" },
      { name: "votingRoundId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const directMintingExecuteAbi = [
  {
    type: "function",
    name: "executeDirectMintingWithData",
    stateMutability: "payable",
    inputs: [
      { name: "payment", type: "tuple", components: xrpPaymentProofComponents },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const directMintingEventsAbi = [
  {
    type: "event",
    name: "DirectMintingDelayed",
    anonymous: false,
    inputs: [
      { name: "transactionId", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executionAllowedAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LargeDirectMintingDelayed",
    anonymous: false,
    inputs: [
      { name: "transactionId", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executionAllowedAt", type: "uint256", indexed: false },
    ],
  },
] as const;

export const userOperationExecutedAbi = [
  {
    type: "event",
    name: "UserOperationExecuted",
    anonymous: false,
    inputs: [
      { name: "personalAccount", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
] as const;

export const smartAccountDirectMintingEventsAbi = [
  {
    type: "event",
    name: "DirectMintingExecuted",
    anonymous: false,
    inputs: [
      { name: "personalAccount", type: "address", indexed: true },
      { name: "transactionId", type: "bytes32", indexed: true },
      { name: "sourceAddress", type: "string", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executorFee", type: "uint256", indexed: false },
      { name: "executor", type: "address", indexed: false },
    ],
  },
] as const;
