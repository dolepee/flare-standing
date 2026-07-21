// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StandingMandates} from "../src/StandingMandates.sol";
import {FtsoUsdToFxrpAdapter} from "../src/FtsoPriceAdapter.sol";

contract StandingTest is Test {
    address constant MERCHANT = address(0x1111);
    address constant TREASURY = address(0x2222);
    MockFxrpToken token;
    MockFtsoOracle oracle;
    FtsoUsdToFxrpAdapter adapter;
    StandingMandates standing;
    uint256 constant CHARGE_USEC = 1_000_000;

    function setUp() public {
        token = new MockFxrpToken();
        oracle = new MockFtsoOracle();
        adapter = new FtsoUsdToFxrpAdapter(address(oracle), 6);
        standing = new StandingMandates(address(token), address(adapter), TREASURY, 100, 300);
        token.mint(address(this), CHARGE_USEC * 100);
    }

    function test_OpenPlanAndChargeFlow() public {
        uint256 planId = standing.createPlan(2_500_000, 0, 60, MERCHANT);
        token.approve(address(standing), CHARGE_USEC * 10);
        standing.openMandate(planId, CHARGE_USEC * 10);
        oracle.setMockRate(2_500_000_000_000_000_000, block.timestamp);
        vm.warp(block.timestamp + 61);
        standing.charge(1);
        vm.warp(block.timestamp + 60);
        standing.charge(1);

        uint256 chargeAmount = 1_000_000;
        uint256 expectedFee = (chargeAmount * 100) / 10_000;
        uint256 expectedMerchantPayment = chargeAmount - expectedFee;
        uint256 totalPayments = 2 * expectedMerchantPayment;
        uint256 totalFees = 2 * expectedFee;
        assertEq(standing.merchantBalance(MERCHANT), totalPayments);
        assertEq(standing.protocolFeeBalance(TREASURY), totalFees);
        assertEq(standing.mandate(1).remaining, CHARGE_USEC * 10 - (2 * chargeAmount));
        assertEq(standing.contractBalance(), CHARGE_USEC * 10);
    }

    function test_CancelThenWithdraw() public {
        uint256 planId = standing.createPlan(0, CHARGE_USEC, 60, MERCHANT);
        token.approve(address(standing), CHARGE_USEC * 2);
        standing.openMandate(planId, CHARGE_USEC * 2);
        standing.cancel(1);
        standing.withdrawMandate(1);
        assertEq(token.balanceOf(address(this)), CHARGE_USEC * 100);
    }

    function test_UsdPlanUsesFtsoAndRejectsStalePrice() public {
        uint256 planId = standing.createPlan(1_000_000, 0, 60, MERCHANT);
        token.approve(address(standing), 5_000_000);
        standing.openMandate(planId, 5_000_000);
        oracle.setMockRate(500_000_000_000_000_000, block.timestamp);
        vm.warp(block.timestamp + 301);

        vm.warp(block.timestamp + 61);
        vm.expectRevert(StandingMandates.StalePrice.selector);
        standing.charge(1);
    }

    function test_ChargeBlockedWhenInsufficientBalance() public {
        uint256 planId = standing.createPlan(0, CHARGE_USEC, 60, MERCHANT);
        token.approve(address(standing), CHARGE_USEC / 2);
        standing.openMandate(planId, CHARGE_USEC / 2);

        vm.warp(block.timestamp + 61);
        standing.charge(1);
        StandingMandates.Mandate memory state = standing.mandate(1);
        assertEq(state.nextChargeAt, block.timestamp + 60);
    }

    function test_TopUpAndWithdraw() public {
        uint256 planId = standing.createPlan(0, CHARGE_USEC, 60, MERCHANT);
        token.approve(address(standing), CHARGE_USEC);
        standing.openMandate(planId, CHARGE_USEC / 2);
        token.approve(address(standing), CHARGE_USEC);
        standing.topUp(1, CHARGE_USEC);

        vm.warp(block.timestamp + 61);
        standing.cancel(1);
        standing.withdrawMandate(1);
        assertEq(token.balanceOf(address(this)), CHARGE_USEC * 100);
    }

    function test_PlanDeactivationBlocksCharges() public {
        uint256 planId = standing.createPlan(0, CHARGE_USEC, 60, MERCHANT);
        token.approve(address(standing), CHARGE_USEC * 2);
        standing.openMandate(planId, CHARGE_USEC * 2);

        vm.warp(block.timestamp + 61);

        standing.setPlanActive(planId, false);
        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.charge(1);

        standing.setPlanActive(planId, true);
        standing.charge(1);

        StandingMandates.Mandate memory state = standing.mandate(1);
        assertGt(state.lastChargeAt, 0);
    }

    function test_SetPausedPreventsOpenAndCharge() public {
        uint256 planId = standing.createPlan(0, CHARGE_USEC, 60, MERCHANT);
        standing.setPaused(true);

        token.approve(address(standing), CHARGE_USEC);
        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.openMandate(planId, CHARGE_USEC);

        vm.warp(block.timestamp + 61);
        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.charge(1);

        standing.setPaused(false);
        standing.openMandate(planId, CHARGE_USEC);
        vm.warp(block.timestamp + 61);
        standing.charge(1);

        StandingMandates.Mandate memory state = standing.mandate(1);
        assertGt(state.lastChargeAt, 0);
    }

    function test_ChargeUsesFeeCap() public {
        uint256 planId = standing.createPlan(0, CHARGE_USEC, 60, MERCHANT);
        token.approve(address(standing), CHARGE_USEC);
        standing.openMandate(planId, CHARGE_USEC);

        // Fast path: fee is 10 bps by default, so expected merchant payout is exactly 990000 of 1000000.
        vm.warp(block.timestamp + 61);
        standing.charge(1);

        assertEq(standing.merchantBalance(MERCHANT), 990000);
        assertEq(standing.protocolFeeBalance(TREASURY), 10000);
    }
}

contract MockFxrpToken {
    string public constant name = "FTestXRP";
    string public constant symbol = "FTestXRP";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] < amount) return false;
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockFtsoOracle {
    uint256 internal rateWei;
    uint256 internal timestamp;

    function setMockRate(uint256 rate, uint256 at) external {
        rateWei = rate;
        timestamp = at;
    }

    function getFeedByIdInWei(bytes21) external view returns (uint256 value, uint64 at) {
        return (rateWei, uint64(timestamp));
    }
}
