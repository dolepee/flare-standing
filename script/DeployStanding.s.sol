// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {StandingMandates} from "../src/StandingMandates.sol";

contract DeployStanding is Script {
    function run(address fxrpToken, address priceAdapter, address treasury, uint16 feeBps, uint256 maxPriceAge)
        external
        returns (StandingMandates deployed)
    {
        vm.startBroadcast();
        deployed = new StandingMandates(fxrpToken, priceAdapter, treasury, feeBps, maxPriceAge);
        vm.stopBroadcast();
    }
}
