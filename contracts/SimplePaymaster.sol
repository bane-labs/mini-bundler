// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/core/BasePaymaster.sol";

/**
 * @title SimplePaymaster
 * @notice A simple paymaster that accepts all UserOps for testing.
 *
 * Flow:
 *   1. UserOp.paymasterAndData = address(paymaster) ++ validationGas ++ postOpGas
 *   2. EntryPoint calls validatePaymasterUserOp → always returns success
 *   3. postOp is a no-op (empty context)
 */
contract SimplePaymaster is BasePaymaster {
    uint256 public constant SIG_VALIDATION_SUCCESS = 0;

    event Deposited(address indexed sender, uint256 amount);

    constructor(
        IEntryPoint _entryPoint
    ) BasePaymaster(_entryPoint) {}

    /// @dev Override to skip ERC-165 check (NeoX EntryPoint v0.7 doesn't support it)
    function _validateEntryPointInterface(IEntryPoint) internal pure override {}

    /// @inheritdoc BasePaymaster
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 /*maxCost*/
    ) internal override returns (bytes memory context, uint256 validationData) {
        // Accept all UserOps - no signature verification
        bytes calldata pmData = userOp.paymasterAndData;
        
        // Minimum: 20 bytes for paymaster address
        if (pmData.length < 20) {
            return ("", 1); // SIG_VALIDATION_FAILED
        }

        return ("", SIG_VALIDATION_SUCCESS);
    }

    /// @inheritdoc BasePaymaster
    function _postOp(
        PostOpMode,
        bytes calldata,
        uint256,
        uint256
    ) internal override {
        // No-op: we don't need to track anything after execution.
    }

    /// @notice Deposit ETH into EntryPoint to cover gas costs.
    function depositEth() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Convenience: owner can deposit directly by sending ETH.
    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }
}
