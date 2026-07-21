// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IPriceAdapter {
    function getFxrpForUsdMicro(uint256 usdMicro) external returns (uint256 fxrpAmount, uint256 updatedAt);
}

contract StandingMandates {
    struct Plan {
        address merchant;
        uint256 priceUsdMicro;
        uint256 priceFxrp; // exact FXRP amount when priceUsdMicro == 0
        uint32 periodSeconds;
        bool active;
    }

    struct Mandate {
        uint256 planId;
        address subscriber;
        uint256 deposited;
        uint256 remaining;
        uint256 nextChargeAt;
        uint256 lastChargeAt;
        bool canceled;
    }

    IERC20 public immutable fxrp;
    IPriceAdapter public immutable priceAdapter;
    address public immutable treasury;
    address public owner;

    uint16 public constant MAX_BPS = 10_000;
    uint16 public immutable feeBps;
    uint256 public immutable maxPriceAge;

    uint256 public planCount;
    uint256 public mandateCount;

    mapping(uint256 => Plan) public plans;
    mapping(uint256 => Mandate) public mandates;
    mapping(address => uint256) public merchantBalance;
    mapping(address => uint256) public protocolFeeBalance;
    bool private entered;
    bool public paused;

    event PlanCreated(
        uint256 indexed planId,
        address indexed merchant,
        uint256 priceUsdMicro,
        uint256 priceFxrp,
        uint32 periodSeconds,
        bool active
    );
    event PlanUpdated(uint256 indexed planId, bool active);
    event MandateOpened(
        uint256 indexed mandateId,
        uint256 indexed planId,
        address indexed subscriber,
        uint256 deposited,
        uint256 firstChargeAt
    );
    event MandateTopUp(uint256 indexed mandateId, address indexed subscriber, uint256 amount);
    event MandateCanceled(uint256 indexed mandateId, address indexed subscriber);
    event ChargeExecuted(
        uint256 indexed mandateId, address indexed merchant, uint256 amount, uint256 fee, uint256 nextChargeAt
    );
    event ChargeBlocked(uint256 indexed mandateId, uint256 remaining, uint256 expected);
    event MerchantWithdraw(address indexed merchant, uint256 amount);
    event ProtocolWithdraw(address indexed treasury, uint256 amount);
    event MandateWithdrawn(uint256 indexed mandateId, address indexed subscriber, uint256 amount);

    error Unauthorized();
    error NotActive();
    error NotReady();
    error InvalidArgument();
    error Reentrant();
    error InsufficientBalance();
    error StalePrice();
    error UnsupportedTokenBehavior();

    constructor(address fxrpToken, address priceAdapter_, address treasury_, uint16 feeBps_, uint256 maxPriceAge_) {
        if (fxrpToken == address(0) || priceAdapter_ == address(0) || treasury_ == address(0)) {
            revert InvalidArgument();
        }
        if (feeBps_ > MAX_BPS) revert InvalidArgument();
        if (maxPriceAge_ == 0) revert InvalidArgument();

        fxrp = IERC20(fxrpToken);
        priceAdapter = IPriceAdapter(priceAdapter_);
        treasury = treasury_;
        feeBps = feeBps_;
        maxPriceAge = maxPriceAge_;
        owner = msg.sender;
        paused = false;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier notPaused() {
        if (paused) revert NotActive();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert Reentrant();
        entered = true;
        _;
        entered = false;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidArgument();
        owner = nextOwner;
    }

    function createPlan(uint256 priceUsdMicro, uint256 priceFxrp, uint32 periodSeconds, address merchant)
        external
        returns (uint256 planId)
    {
        if (periodSeconds == 0 || merchant == address(0)) revert InvalidArgument();
        if (merchant != msg.sender) revert Unauthorized();
        if ((priceUsdMicro == 0 && priceFxrp == 0) || (priceUsdMicro != 0 && priceFxrp != 0)) {
            revert InvalidArgument();
        }

        planId = ++planCount;
        plans[planId] = Plan({
            merchant: merchant,
            priceUsdMicro: priceUsdMicro,
            priceFxrp: priceFxrp,
            periodSeconds: periodSeconds,
            active: true
        });

        emit PlanCreated(planId, merchant, priceUsdMicro, priceFxrp, periodSeconds, true);
    }

    function setPlanActive(uint256 planId, bool active) external {
        Plan storage planData = plans[planId];
        if (planId == 0 || planData.merchant == address(0)) revert InvalidArgument();
        if (msg.sender != planData.merchant) revert Unauthorized();
        planData.active = active;
        emit PlanUpdated(planId, active);
    }

    function openMandate(uint256 planId, uint256 depositAmount) external notPaused nonReentrant {
        Plan memory planData = plans[planId];
        if (planId == 0 || !planData.active || planData.merchant == address(0)) revert NotActive();
        if (depositAmount == 0) revert InvalidArgument();

        uint256 expectedFirstCharge = nextChargeTime(planData.periodSeconds, 0);
        _pullExact(msg.sender, depositAmount);

        mandateCount += 1;
        mandates[mandateCount] = Mandate({
            planId: planId,
            subscriber: msg.sender,
            deposited: depositAmount,
            remaining: depositAmount,
            nextChargeAt: expectedFirstCharge,
            lastChargeAt: 0,
            canceled: false
        });

        emit MandateOpened(mandateCount, planId, msg.sender, depositAmount, expectedFirstCharge);
    }

    function topUp(uint256 mandateId, uint256 amount) external notPaused nonReentrant {
        Mandate storage mandateData = mandates[mandateId];
        if (mandateData.subscriber != msg.sender || mandateData.canceled) revert Unauthorized();
        if (amount == 0) revert InvalidArgument();
        _pullExact(msg.sender, amount);
        mandateData.deposited += amount;
        mandateData.remaining += amount;
        emit MandateTopUp(mandateId, msg.sender, amount);
    }

    function cancel(uint256 mandateId) external {
        Mandate storage mandateData = mandates[mandateId];
        if (mandateData.subscriber != msg.sender || mandateData.canceled) revert Unauthorized();
        mandateData.canceled = true;
        emit MandateCanceled(mandateId, msg.sender);
    }

    function charge(uint256 mandateId) external notPaused nonReentrant {
        Mandate storage mandateData = mandates[mandateId];
        if (mandateData.canceled) revert NotActive();
        if (mandateData.nextChargeAt == 0 || block.timestamp < mandateData.nextChargeAt) revert NotReady();

        Plan memory planData = plans[mandateData.planId];
        if (planData.merchant == address(0) || !planData.active) revert NotActive();

        uint256 chargeAmount = _getChargeAmount(planData.priceUsdMicro, planData.priceFxrp);
        if (chargeAmount == 0 || chargeAmount > mandateData.remaining) {
            emit ChargeBlocked(mandateId, mandateData.remaining, chargeAmount);
            mandateData.nextChargeAt = nextChargeTime(planData.periodSeconds, block.timestamp);
            return;
        }

        mandateData.remaining -= chargeAmount;
        mandateData.lastChargeAt = block.timestamp;
        mandateData.nextChargeAt = nextChargeTime(planData.periodSeconds, block.timestamp);

        uint256 fee = (chargeAmount * feeBps) / MAX_BPS;
        uint256 payToMerchant = chargeAmount - fee;

        merchantBalance[planData.merchant] += payToMerchant;
        protocolFeeBalance[treasury] += fee;

        emit ChargeExecuted(mandateId, planData.merchant, payToMerchant, fee, mandateData.nextChargeAt);
    }

    function withdrawMandate(uint256 mandateId) external nonReentrant {
        Mandate storage mandateData = mandates[mandateId];
        if (mandateData.subscriber != msg.sender) revert Unauthorized();
        if (!mandateData.canceled) revert NotActive();
        uint256 amount = mandateData.remaining;
        if (amount == 0) revert InvalidArgument();
        mandateData.deposited = 0;
        mandateData.remaining = 0;
        _pushExact(msg.sender, amount);
        emit MandateWithdrawn(mandateId, msg.sender, amount);
    }

    function withdrawMerchant(uint256 amount) external nonReentrant {
        uint256 available = merchantBalance[msg.sender];
        if (amount == 0 || amount > available) revert InsufficientBalance();
        merchantBalance[msg.sender] = available - amount;
        _pushExact(msg.sender, amount);
        emit MerchantWithdraw(msg.sender, amount);
    }

    function withdrawProtocol(uint256 amount) external nonReentrant {
        uint256 available = protocolFeeBalance[treasury];
        if (msg.sender != treasury) revert Unauthorized();
        if (amount == 0 || amount > available) revert InsufficientBalance();
        protocolFeeBalance[treasury] = available - amount;
        _pushExact(treasury, amount);
        emit ProtocolWithdraw(treasury, amount);
    }

    function _getChargeAmount(uint256 priceUsdMicro, uint256 priceFxrp) internal returns (uint256 amount) {
        if (priceUsdMicro == 0) return priceFxrp;
        (uint256 fxrpAmount, uint256 updatedAt) = priceAdapter.getFxrpForUsdMicro(priceUsdMicro);
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxPriceAge) revert StalePrice();
        return fxrpAmount;
    }

    function nextChargeTime(uint32 periodSeconds, uint256 fromTimestamp) internal view returns (uint256) {
        uint256 base = fromTimestamp == 0 ? block.timestamp : fromTimestamp;
        return base + uint256(periodSeconds);
    }

    function contractBalance() external view returns (uint256) {
        return fxrp.balanceOf(address(this));
    }

    function plan(uint256 planId) external view returns (Plan memory) {
        return plans[planId];
    }

    function mandate(uint256 mandateId) external view returns (Mandate memory) {
        return mandates[mandateId];
    }

    function _pullExact(address from, uint256 amount) private {
        uint256 balanceBefore = fxrp.balanceOf(address(this));
        if (!_safeTransferFrom(address(fxrp), from, address(this), amount)) revert InsufficientBalance();
        uint256 balanceAfter = fxrp.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert UnsupportedTokenBehavior();
        }
    }

    function _pushExact(address to, uint256 amount) private {
        uint256 contractBalanceBefore = fxrp.balanceOf(address(this));
        uint256 recipientBalanceBefore = fxrp.balanceOf(to);
        if (!_safeTransfer(address(fxrp), to, amount)) revert InsufficientBalance();
        uint256 contractBalanceAfter = fxrp.balanceOf(address(this));
        uint256 recipientBalanceAfter = fxrp.balanceOf(to);
        if (
            contractBalanceAfter > contractBalanceBefore || contractBalanceBefore - contractBalanceAfter != amount
                || recipientBalanceAfter < recipientBalanceBefore
                || recipientBalanceAfter - recipientBalanceBefore != amount
        ) {
            revert UnsupportedTokenBehavior();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private returns (bool ok) {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        ok = success && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _safeTransfer(address token, address to, uint256 amount) private returns (bool ok) {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        ok = success && (data.length == 0 || abi.decode(data, (bool)));
    }
}
