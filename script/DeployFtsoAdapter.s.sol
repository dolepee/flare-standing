// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {FtsoUsdToFxrpAdapter} from "../src/FtsoPriceAdapter.sol";

contract DeployFtsoAdapter is Script {
    function run(address ftsoV2Address, uint8 fxrpDecimals) external returns (FtsoUsdToFxrpAdapter deployed) {
        vm.startBroadcast();
        deployed = new FtsoUsdToFxrpAdapter(ftsoV2Address, fxrpDecimals);
        vm.stopBroadcast();
    }
}
