// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {StandingMandates, IERC20} from "../src/StandingMandates.sol";

contract DeployStanding is Script {
    error InvalidDeploymentDependency(string dependency);

    function validateDeploymentInputs(
        address fxrpToken,
        address priceAdapter,
        address treasury,
        uint16 feeBps,
        uint256 maxPriceAge
    ) public view {
        if (block.chainid != 114) revert InvalidDeploymentDependency("chainId");
        if (fxrpToken.code.length == 0) revert InvalidDeploymentDependency("fxrp.code");
        if (priceAdapter.code.length == 0) revert InvalidDeploymentDependency("priceAdapter.code");
        if (treasury == address(0)) revert InvalidDeploymentDependency("treasury");
        if (feeBps > 10_000) revert InvalidDeploymentDependency("feeBps");
        if (maxPriceAge == 0) revert InvalidDeploymentDependency("maxPriceAge");

        try IERC20(fxrpToken).decimals() returns (uint8 decimals) {
            if (decimals != 6) revert InvalidDeploymentDependency("fxrp.decimals");
        } catch {
            revert InvalidDeploymentDependency("fxrp.decimals");
        }
    }

    function run(address fxrpToken, address priceAdapter, address treasury, uint16 feeBps, uint256 maxPriceAge)
        external
        returns (StandingMandates deployed)
    {
        validateDeploymentInputs(fxrpToken, priceAdapter, treasury, feeBps, maxPriceAge);
        vm.startBroadcast();
        deployed = new StandingMandates(fxrpToken, priceAdapter, treasury, feeBps, maxPriceAge);
        vm.stopBroadcast();
    }
}
