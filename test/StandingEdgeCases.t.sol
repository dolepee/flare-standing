// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StandingMandates} from "../src/StandingMandates.sol";
import {FtsoUsdToFxrpAdapter} from "../src/FtsoPriceAdapter.sol";

contract StandingEdgeCasesTest is Test {
    address internal constant MERCHANT = address(0x1111);
    address internal constant TREASURY = address(0x2222);
    address internal constant STRANGER = address(0x3333);
    uint256 internal constant UNIT = 1_000_000;

    EdgeToken internal token;
    EdgeOracle internal oracle;
    FtsoUsdToFxrpAdapter internal adapter;
    StandingMandates internal standing;

    function setUp() public {
        token = new EdgeToken();
        oracle = new EdgeOracle();
        adapter = new FtsoUsdToFxrpAdapter(address(oracle), 6);
        standing = new StandingMandates(address(token), address(adapter), TREASURY, 100, 300);
        token.mint(address(this), 100 * UNIT);
        token.approve(address(standing), type(uint256).max);
    }

    function _fixedPlan(uint256 amount) internal returns (uint256 planId) {
        vm.prank(MERCHANT);
        planId = standing.createPlan(0, amount, 60, MERCHANT);
    }

    function test_ConstructorRejectsInvalidConfiguration() public {
        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        new StandingMandates(address(0), address(adapter), TREASURY, 100, 300);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        new StandingMandates(address(token), address(0), TREASURY, 100, 300);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        new StandingMandates(address(token), address(adapter), address(0), 100, 300);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        new StandingMandates(address(token), address(adapter), TREASURY, 10_001, 300);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        new StandingMandates(address(token), address(adapter), TREASURY, 100, 0);
    }

    function test_OwnerCanTransferOwnershipAndOnlyNewOwnerCanPause() public {
        standing.transferOwnership(STRANGER);
        assertEq(standing.owner(), STRANGER);

        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.setPaused(true);

        vm.prank(STRANGER);
        standing.setPaused(true);
        assertTrue(standing.paused());

        vm.prank(STRANGER);
        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.transferOwnership(address(0));
    }

    function test_CreatePlanRejectsMalformedTerms() public {
        vm.startPrank(MERCHANT);
        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.createPlan(0, UNIT, 0, MERCHANT);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.createPlan(0, UNIT, 60, address(0));

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.createPlan(0, 0, 60, MERCHANT);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.createPlan(UNIT, UNIT, 60, MERCHANT);
        vm.stopPrank();
    }

    function test_InvalidPlanAndZeroDepositCannotOpen() public {
        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.openMandate(0, UNIT);

        uint256 planId = _fixedPlan(UNIT);
        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.openMandate(planId, 0);
    }

    function test_ImmediateOpenRejectsInvalidPlanZeroDepositAndZeroMaximum() public {
        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.openMandateAndCharge(0, UNIT, UNIT);

        uint256 planId = _fixedPlan(UNIT);
        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.openMandateAndCharge(planId, 0, UNIT);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.openMandateAndCharge(planId, UNIT, 0);

        assertEq(standing.mandateCount(), 0);
        assertEq(token.balanceOf(address(standing)), 0);
    }

    function test_ImmediateOpenIsBlockedWhilePausedOrPlanInactive() public {
        uint256 planId = _fixedPlan(UNIT);
        standing.setPaused(true);

        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.openMandateAndCharge(planId, UNIT, UNIT);

        standing.setPaused(false);
        vm.prank(MERCHANT);
        standing.setPlanActive(planId, false);

        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.openMandateAndCharge(planId, UNIT, UNIT);
        assertEq(standing.mandateCount(), 0);
    }

    function test_ChargeBoundaryAndDuplicateChargeAreRejected() public {
        uint256 planId = _fixedPlan(UNIT);
        standing.openMandate(planId, 3 * UNIT);
        StandingMandates.Mandate memory opened = standing.mandate(1);

        vm.warp(opened.nextChargeAt - 1);
        vm.expectRevert(StandingMandates.NotReady.selector);
        standing.charge(1);

        vm.warp(opened.nextChargeAt);
        standing.charge(1);
        StandingMandates.Mandate memory charged = standing.mandate(1);

        vm.expectRevert(StandingMandates.NotReady.selector);
        standing.charge(1);
        assertEq(charged.remaining, 2 * UNIT);
        assertEq(charged.nextChargeAt, block.timestamp + 60);
    }

    function test_CanceledMandateRejectsTopUpChargeAndSecondCancel() public {
        uint256 planId = _fixedPlan(UNIT);
        standing.openMandate(planId, UNIT);
        standing.cancel(1);

        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.topUp(1, UNIT);

        vm.expectRevert(StandingMandates.NotActive.selector);
        standing.charge(1);

        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.cancel(1);
    }

    function test_OnlySubscriberCanMutateOrWithdrawMandate() public {
        uint256 planId = _fixedPlan(UNIT);
        standing.openMandate(planId, UNIT);

        vm.startPrank(STRANGER);
        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.topUp(1, UNIT);
        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.cancel(1);
        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.withdrawMandate(1);
        vm.stopPrank();

        standing.cancel(1);
        standing.withdrawMandate(1);
        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.withdrawMandate(1);
    }

    function test_ExactCancelWithdrawRejectsUnauthorizedAndZeroExpectation() public {
        uint256 planId = _fixedPlan(UNIT);
        standing.openMandate(planId, UNIT);

        vm.prank(STRANGER);
        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.cancelAndWithdrawExact(1, UNIT);

        vm.expectRevert(StandingMandates.InvalidArgument.selector);
        standing.cancelAndWithdrawExact(1, 0);

        StandingMandates.Mandate memory unchanged = standing.mandate(1);
        assertFalse(unchanged.canceled);
        assertEq(unchanged.remaining, UNIT);
    }

    function test_MerchantAndTreasuryWithdrawExactAccruals() public {
        uint256 planId = _fixedPlan(UNIT);
        standing.openMandate(planId, UNIT);
        vm.warp(standing.mandate(1).nextChargeAt);
        standing.charge(1);

        vm.prank(STRANGER);
        vm.expectRevert(StandingMandates.InsufficientBalance.selector);
        standing.withdrawMerchant(1);

        vm.prank(MERCHANT);
        vm.expectRevert(StandingMandates.InsufficientBalance.selector);
        standing.withdrawMerchant(0);

        vm.prank(MERCHANT);
        standing.withdrawMerchant(990_000);
        assertEq(token.balanceOf(MERCHANT), 990_000);

        vm.prank(STRANGER);
        vm.expectRevert(StandingMandates.Unauthorized.selector);
        standing.withdrawProtocol(10_000);

        vm.prank(TREASURY);
        standing.withdrawProtocol(10_000);
        assertEq(token.balanceOf(TREASURY), 10_000);
        assertEq(token.balanceOf(address(standing)), 0);
    }

    function test_FalseReturningTokenIsRejected() public {
        FalseReturnToken falseToken = new FalseReturnToken();
        StandingMandates falseStanding = new StandingMandates(address(falseToken), address(adapter), TREASURY, 100, 300);
        falseToken.mint(address(this), UNIT);
        falseToken.approve(address(falseStanding), UNIT);
        vm.prank(MERCHANT);
        uint256 planId = falseStanding.createPlan(0, UNIT, 60, MERCHANT);

        vm.expectRevert(StandingMandates.InsufficientBalance.selector);
        falseStanding.openMandate(planId, UNIT);
        assertEq(falseStanding.mandateCount(), 0);
    }

    function test_NoReturnTokenSupportsExactDepositAndRefund() public {
        NoReturnToken noReturnToken = new NoReturnToken();
        StandingMandates noReturnStanding =
            new StandingMandates(address(noReturnToken), address(adapter), TREASURY, 100, 300);
        noReturnToken.mint(address(this), UNIT);
        noReturnToken.approve(address(noReturnStanding), UNIT);
        vm.prank(MERCHANT);
        uint256 planId = noReturnStanding.createPlan(0, UNIT, 60, MERCHANT);

        noReturnStanding.openMandate(planId, UNIT);
        noReturnStanding.cancel(1);
        noReturnStanding.withdrawMandate(1);
        assertEq(noReturnToken.balanceOf(address(this)), UNIT);
    }

    function test_FtsoAdapterRejectsBadConfigurationAndResults() public {
        vm.expectRevert(FtsoUsdToFxrpAdapter.InvalidFeed.selector);
        new FtsoUsdToFxrpAdapter(address(0), 6);

        vm.expectRevert(FtsoUsdToFxrpAdapter.InvalidFeed.selector);
        new FtsoUsdToFxrpAdapter(address(oracle), 19);

        (uint256 zeroAmount, uint256 updatedAt) = adapter.getFxrpForUsdMicro(0);
        assertEq(zeroAmount, 0);
        assertEq(updatedAt, block.timestamp);

        vm.expectRevert(FtsoUsdToFxrpAdapter.InvalidResult.selector);
        adapter.getFxrpForUsdMicro(UNIT);

        oracle.setMockRate(1e40, block.timestamp);
        vm.expectRevert(FtsoUsdToFxrpAdapter.InvalidResult.selector);
        adapter.getFxrpForUsdMicro(1);
    }
}

contract EdgeToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        if (allowance[from][msg.sender] < amount) return false;
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (balanceOf[from] < amount) revert();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract EdgeOracle {
    uint256 internal rate;
    uint64 internal at;

    function setMockRate(uint256 value, uint256 timestamp) external {
        rate = value;
        at = uint64(timestamp);
    }

    function getFeedByIdInWei(bytes21) external view returns (uint256, uint64) {
        return (rate, at);
    }
}

contract FalseReturnToken is EdgeToken {
    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        if (allowance[from][msg.sender] < amount) revert();
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (balanceOf[from] < amount) revert();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
