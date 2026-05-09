// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArbitrageExecutor} from "../src/ArbitrageExecutor.sol";

contract DeployArbitrageExecutor is Script {
    function run() external {
        // Read constructor args from env
        address vault      = vm.envAddress("BALANCER_VAULT");
        address weth       = vm.envAddress("WETH_ADDRESS");
        address usdc       = vm.envAddress("USDC_ADDRESS");
        address v2Router   = vm.envAddress("V2_ROUTER");
        address v3Router   = vm.envAddress("V3_ROUTER");
        address v3Quoter   = vm.envAddress("V3_QUOTER");

        vm.startBroadcast();
        ArbitrageExecutor executor = new ArbitrageExecutor(
            vault, weth, usdc, v2Router, v3Router, v3Quoter
        );
        vm.stopBroadcast();

        console.log("ArbitrageExecutor deployed at:", address(executor));
        console.log("Owner:", executor.owner());
    }
}
