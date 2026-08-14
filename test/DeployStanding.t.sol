// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DeployStanding} from "../script/DeployStanding.s.sol";

contract DeployStandingTest is Test {
    DeployStanding internal deployer;
    SixDecimalToken internal token;
    AdapterCode internal adapter;

    function setUp() public {
        vm.chainId(114);
        deployer = new DeployStanding();
        token = new SixDecimalToken();
        adapter = new AdapterCode();
    }

    function test_ValidCoston2DependenciesPassPreflight() public view {
        deployer.validateDeploymentInputs(address(token), address(adapter), address(0xBEEF), 100, 300);
    }

    function test_PreflightRejectsWrongChainAndMissingCode() public {
        vm.chainId(14);
        vm.expectRevert(abi.encodeWithSelector(DeployStanding.InvalidDeploymentDependency.selector, "chainId"));
        deployer.validateDeploymentInputs(address(token), address(adapter), address(0xBEEF), 100, 300);

        vm.chainId(114);
        vm.expectRevert(abi.encodeWithSelector(DeployStanding.InvalidDeploymentDependency.selector, "fxrp.code"));
        deployer.validateDeploymentInputs(address(0xCAFE), address(adapter), address(0xBEEF), 100, 300);

        vm.expectRevert(
            abi.encodeWithSelector(DeployStanding.InvalidDeploymentDependency.selector, "priceAdapter.code")
        );
        deployer.validateDeploymentInputs(address(token), address(0xCAFE), address(0xBEEF), 100, 300);
    }

    function test_PreflightRejectsWrongTokenDecimals() public {
        EighteenDecimalToken wrongToken = new EighteenDecimalToken();
        vm.expectRevert(abi.encodeWithSelector(DeployStanding.InvalidDeploymentDependency.selector, "fxrp.decimals"));
        deployer.validateDeploymentInputs(address(wrongToken), address(adapter), address(0xBEEF), 100, 300);
    }
}

contract SixDecimalToken {
    function decimals() external pure returns (uint8) {
        return 6;
    }
}

contract EighteenDecimalToken {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

contract AdapterCode {}
