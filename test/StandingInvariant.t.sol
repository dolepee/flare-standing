// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {StandingMandates, IPriceAdapter} from "../src/StandingMandates.sol";

contract StandingInvariantTest is StdInvariant, Test {
    address internal constant MERCHANT = address(0x1111);
    address internal constant TREASURY = address(0x2222);

    InvariantToken internal token;
    StandingMandates internal standing;
    StandingHandler internal handler;

    function setUp() public {
        token = new InvariantToken();
        InvariantAdapter adapter = new InvariantAdapter();
        standing = new StandingMandates(address(token), address(adapter), TREASURY, 100, 300);

        vm.prank(MERCHANT);
        uint256 planId = standing.createPlan(0, 1_000_000, 60, MERCHANT);
        handler = new StandingHandler(token, standing, planId);
        targetContract(address(handler));
    }

    function invariant_TokenCustodyEqualsAllOutstandingAccounting() public view {
        uint256 outstandingMandates;
        uint256 count = standing.mandateCount();
        for (uint256 id = 1; id <= count; id++) {
            outstandingMandates += standing.mandate(id).remaining;
        }

        uint256 accounted =
            outstandingMandates + standing.merchantBalance(MERCHANT) + standing.protocolFeeBalance(TREASURY);
        assertEq(token.balanceOf(address(standing)), accounted);
        assertEq(standing.contractBalance(), accounted);
    }

    function invariant_MandateRemainingNeverExceedsRecordedDeposits() public view {
        uint256 count = standing.mandateCount();
        for (uint256 id = 1; id <= count; id++) {
            StandingMandates.Mandate memory mandateData = standing.mandate(id);
            assertLe(mandateData.remaining, mandateData.deposited);
        }
    }
}

contract StandingHandler is Test {
    InvariantToken internal immutable token;
    StandingMandates internal immutable standing;
    uint256 internal immutable planId;

    constructor(InvariantToken token_, StandingMandates standing_, uint256 planId_) {
        token = token_;
        standing = standing_;
        planId = planId_;
    }

    function open(uint96 rawAmount) external {
        bool chargeImmediately = rawAmount % 2 == 0;
        uint256 minimum = chargeImmediately ? 1_000_000 : 1;
        uint256 amount = bound(uint256(rawAmount), minimum, 10_000_000);
        token.mint(address(this), amount);
        token.approve(address(standing), amount);
        if (chargeImmediately) {
            standing.openMandateAndCharge(planId, amount, 1_000_000);
        } else {
            standing.openMandate(planId, amount);
        }
    }

    function topUp(uint256 seed, uint96 rawAmount) external {
        uint256 count = standing.mandateCount();
        if (count == 0) return;
        uint256 mandateId = (seed % count) + 1;
        StandingMandates.Mandate memory mandateData = standing.mandate(mandateId);
        if (mandateData.canceled) return;

        uint256 amount = bound(uint256(rawAmount), 1, 10_000_000);
        token.mint(address(this), amount);
        token.approve(address(standing), amount);
        standing.topUp(mandateId, amount);
    }

    function charge(uint256 seed) external {
        uint256 count = standing.mandateCount();
        if (count == 0) return;
        uint256 mandateId = (seed % count) + 1;
        StandingMandates.Mandate memory mandateData = standing.mandate(mandateId);
        if (mandateData.canceled) return;
        if (block.timestamp < mandateData.nextChargeAt) vm.warp(mandateData.nextChargeAt);
        standing.charge(mandateId);
    }

    function cancel(uint256 seed) external {
        uint256 count = standing.mandateCount();
        if (count == 0) return;
        uint256 mandateId = (seed % count) + 1;
        if (standing.mandate(mandateId).canceled) return;
        standing.cancel(mandateId);
    }

    function withdrawCanceled(uint256 seed) external {
        uint256 count = standing.mandateCount();
        if (count == 0) return;
        uint256 mandateId = (seed % count) + 1;
        StandingMandates.Mandate memory mandateData = standing.mandate(mandateId);
        if (!mandateData.canceled || mandateData.remaining == 0) return;
        standing.withdrawMandate(mandateId);
    }
}

contract InvariantToken {
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
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract InvariantAdapter is IPriceAdapter {
    function getFxrpForUsdMicro(uint256 usdMicro) external view returns (uint256, uint256) {
        return (usdMicro, block.timestamp);
    }
}
