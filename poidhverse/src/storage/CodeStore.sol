// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title Immutable Bytecode Store
 * @author acgk.eth
 * @notice Deploys arbitrary application bytes as immutable contract runtime bytecode.
 * @notice Returns a storage-contract address that can be read with `CodeReader` and `EXTCODECOPY`.
 * @dev Runtime byte zero is STOP so accidental calls are harmless, and the stored payload begins at offset one.
 * @dev Uses a compact 10-byte initcode stub that returns `STOP || data` directly, avoiding Solidity constructor ABI overhead.
 * @dev Payload size is capped so the STOP-prefixed runtime remains within the EVM contract code-size limit.
 */
library CodeStore {
    uint256 internal constant MAX_DATA_SIZE = 24_575;

    error DataTooLarge(uint256 supplied, uint256 maximum);
    error DeploymentFailed();

    /**
     * @notice Deploys one immutable byte payload and returns its storage-contract address.
     * @param data Arbitrary bytes to store in runtime bytecode.
     * @return pointer Address of the deployed STOP-prefixed bytecode-storage contract.
     * @dev Reverts when the payload exceeds `MAX_DATA_SIZE` or the created runtime length is unexpected.
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

            // Runtime byte zero is STOP. Copy the payload immediately after it.
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

/**
 * @title Immutable Bytecode Storage Container
 * @author acgk.eth
 * @notice Holds one immutable application-data chunk directly in contract runtime bytecode.
 * @dev The constructor returns `STOP || data` as runtime code and the contract exposes no callable functions.
 */
contract CodeStoreContainer {
    /**
     * @notice Creates a runtime-code container for one immutable byte payload.
     * @param data Arbitrary bytes that become the container's permanent runtime payload.
     */
    constructor(bytes memory data) {
        bytes memory runtime = bytes.concat(hex"00", data);
        assembly ("memory-safe") {
            return(add(runtime, 0x20), mload(runtime))
        }
    }
}
