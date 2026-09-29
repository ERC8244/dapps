// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title Immutable Bytecode Store
 * @author acgk.eth
 * @notice Deploys arbitrary application bytes as immutable contract runtime code.
 * @dev Runtime byte zero is STOP, making accidental calls harmless; the payload begins at byte offset one.
 * @dev The 24,575-byte payload limit keeps the STOP-prefixed runtime within EIP-170's 24,576-byte limit.
 */
library CodeStore {
    /// @dev Maximum payload length after reserving one runtime byte for STOP.
    uint256 internal constant MAX_DATA_SIZE = 24_575;

    /// @notice The supplied payload cannot fit in one EIP-170-sized storage contract.
    error DataTooLarge(uint256 supplied, uint256 maximum);
    /// @notice CREATE failed or returned a contract with an unexpected runtime length.
    error DeploymentFailed();

    /**
     * @notice Deploys one immutable payload and returns its storage-contract address.
     * @param data Arbitrary bytes to store in runtime bytecode.
     * @return pointer Address of the deployed STOP-prefixed storage contract.
     * @dev Uses compact initcode that returns `STOP || data` directly without Solidity constructor ABI overhead.
     */
    function write(bytes memory data) internal returns (address pointer) {
        if (data.length > MAX_DATA_SIZE) revert DataTooLarge(data.length, MAX_DATA_SIZE);

        uint256 runtimeSize = data.length + 1;
        bytes memory initcode = new bytes(runtimeSize + 10);
        assembly ("memory-safe") {
            let start := add(initcode, 0x20)
            // PUSH2 runtimeSize; DUP1; PUSH1 0x0a; PUSH0; CODECOPY; PUSH0; RETURN
            mstore8(start, 0x61)
            mstore8(add(start, 1), shr(8, runtimeSize))
            mstore8(add(start, 2), and(runtimeSize, 0xff))
            mstore8(add(start, 3), 0x80)
            mstore8(add(start, 4), 0x60)
            mstore8(add(start, 5), 0x0a)
            mstore8(add(start, 6), 0x5f)
            mstore8(add(start, 7), 0x39)
            mstore8(add(start, 8), 0x5f)
            mstore8(add(start, 9), 0xf3)

            mstore8(add(start, 10), 0x00)
            let source := add(data, 0x20)
            let destination := add(start, 11)
            for { let offset := 0 } lt(offset, mload(data)) { offset := add(offset, 0x20) } {
                mstore(add(destination, offset), mload(add(source, offset)))
            }

            pointer := create(0, start, mload(initcode))
        }
        if (pointer.code.length != data.length + 1) revert DeploymentFailed();
    }
}
