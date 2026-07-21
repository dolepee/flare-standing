// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {StandingMandates} from "../src/StandingMandates.sol";

contract ChargeKeeper is Script {
    /// @notice Run a permissionless charge attempt for the given mandate id.
    /// @dev Useful as a first-pass keeper helper for local/mainnet test harnesses.
    function run(address standingAddress, uint256 mandateId) external {
        vm.startBroadcast();

        StandingMandates standing = StandingMandates(standingAddress);
        standing.charge(mandateId);

        vm.stopBroadcast();
    }

    /// @notice Run multiple charge attempts in one call for local test automation.
    function runBatch(address standingAddress, uint256[] memory mandateIds) external {
        vm.startBroadcast();
        StandingMandates standing = StandingMandates(standingAddress);

        for (uint256 i = 0; i < mandateIds.length; i++) {
            standing.charge(mandateIds[i]);
        }

        vm.stopBroadcast();
    }
}
