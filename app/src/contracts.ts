import { parseAbi } from 'viem'

export const standingAbi = parseAbi([
  'function standingIdentity() pure returns (uint256 version, bytes32 capability)',
  'function planCount() view returns (uint256)',
  'function mandateCount() view returns (uint256)',
  'function paused() view returns (bool)',
  'function feeBps() view returns (uint16)',
  'function maxPriceAge() view returns (uint256)',
  'function treasury() view returns (address)',
  'function contractBalance() view returns (uint256)',
  'function merchantBalance(address) view returns (uint256)',
  'function protocolFeeBalance(address) view returns (uint256)',
  'function plans(uint256) view returns (address merchant, uint256 priceUsdMicro, uint256 priceFxrp, uint32 periodSeconds, bool active)',
  'function mandates(uint256) view returns (uint256 planId, address subscriber, uint256 deposited, uint256 remaining, uint256 nextChargeAt, uint256 lastChargeAt, bool canceled)',
  'function createPlan(uint256 priceUsdMicro, uint256 priceFxrp, uint32 periodSeconds, address merchant) returns (uint256)',
  'function setPlanActive(uint256 planId, bool active)',
  'function openMandateAndCharge(uint256 planId, uint256 depositAmount, uint256 maxInitialChargeFxrp)',
  'function topUp(uint256 mandateId, uint256 amount)',
  'function cancel(uint256 mandateId)',
  'function charge(uint256 mandateId)',
  'function withdrawMandate(uint256 mandateId)',
  'function withdrawMerchant(uint256 amount)',
  'event PlanCreated(uint256 indexed planId, address indexed merchant, uint256 priceUsdMicro, uint256 priceFxrp, uint32 periodSeconds, bool active)',
  'event PlanUpdated(uint256 indexed planId, bool active)',
  'event MandateOpened(uint256 indexed mandateId, uint256 indexed planId, address indexed subscriber, uint256 deposited, uint256 firstChargeAt)',
  'event MandateTopUp(uint256 indexed mandateId, address indexed subscriber, uint256 amount)',
  'event MandateCanceled(uint256 indexed mandateId, address indexed subscriber)',
  'event ChargeExecuted(uint256 indexed mandateId, address indexed merchant, uint256 merchantAmount, uint256 feeAmount, uint256 nextChargeAt)',
  'event ChargeBlocked(uint256 indexed mandateId, uint256 remaining, uint256 expected)',
  'event MerchantWithdraw(address indexed merchant, uint256 amount)',
  'event ProtocolWithdraw(address indexed treasury, uint256 amount)',
  'event MandateWithdrawn(uint256 indexed mandateId, address indexed subscriber, uint256 amount)',
  'event PausedSet(bool paused)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner)',
])

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

// Intentionally excludes every legacy acquisition, keeper, and merchant write.
// This ABI is the recovery lane's second line of defense after UI ownership gates.
export const historicalV1RecoveryAbi = parseAbi([
  'function planCount() view returns (uint256)',
  'function mandateCount() view returns (uint256)',
  'function plans(uint256) view returns (address merchant, uint256 priceUsdMicro, uint256 priceFxrp, uint32 periodSeconds, bool active)',
  'function mandates(uint256) view returns (uint256 planId, address subscriber, uint256 deposited, uint256 remaining, uint256 nextChargeAt, uint256 lastChargeAt, bool canceled)',
  'function cancel(uint256 mandateId)',
  'function withdrawMandate(uint256 mandateId)',
])

export type StandingPlan = {
  id: bigint
  merchant: `0x${string}`
  priceUsdMicro: bigint
  priceFxrp: bigint
  periodSeconds: number
  active: boolean
}

export type StandingMandate = {
  id: bigint
  planId: bigint
  subscriber: `0x${string}`
  deposited: bigint
  remaining: bigint
  nextChargeAt: bigint
  lastChargeAt: bigint
  canceled: boolean
}
