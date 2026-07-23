// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../contracts/SimplePaymaster.sol";

contract DeployPaymaster is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address entryPoint = vm.envAddress("ENTRYPOINT");

        vm.startBroadcast(privateKey);
        SimplePaymaster paymaster = new SimplePaymaster(IEntryPoint(entryPoint));
        vm.stopBroadcast();

        console.log("SimplePaymaster deployed at:", address(paymaster));
        console.log("EntryPoint:", entryPoint);
    }
}
