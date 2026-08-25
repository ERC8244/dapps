// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title Immutable Bytecode Reader
 * @author acgk.eth
 * @notice Reads application data stored in STOP-prefixed contract runtime bytecode.
 * @notice Reconstructs ordered chunk arrays into their original contiguous byte representation.
 * @dev Every valid storage contract contains one leading STOP byte followed by its immutable payload.
 * @dev Reads skip byte zero so callers receive only the original stored content.
 */
library CodeReader {
    error InvalidPointer(address pointer);

    /**
     * @notice Reads the immutable payload stored at one bytecode-storage address.
     * @param pointer Address of the STOP-prefixed storage contract.
     * @return data The stored payload without its leading STOP byte.
     */
    function read(address pointer) internal view returns (bytes memory data) {
        uint256 codeSize = pointer.code.length;
        if (codeSize == 0) revert InvalidPointer(pointer);

        uint256 dataSize = codeSize - 1;
        data = new bytes(dataSize);
        assembly ("memory-safe") {
            extcodecopy(pointer, add(data, 0x20), 1, dataSize)
        }
    }

    /**
     * @notice Reconstructs one artifact from an ordered list of bytecode-storage addresses.
     * @param pointers Storage array containing the chunk addresses in canonical byte order.
     * @return data The exact concatenation of every stored payload without the leading STOP bytes.
     * @dev Sizes are summed before one allocation; this avoids repeated memory growth while preserving exact chunk order.
     * @dev Reverts when any pointer has no runtime code so incomplete content cannot be returned silently.
     */
    function readAll(address[] storage pointers) internal view returns (bytes memory data) {
        uint256 count = pointers.length;
        uint256 totalSize;

        for (uint256 i; i < count; ++i) {
            uint256 codeSize = pointers[i].code.length;
            if (codeSize == 0) revert InvalidPointer(pointers[i]);
            totalSize += codeSize - 1;
        }

        data = new bytes(totalSize);
        uint256 cursor;
        for (uint256 i; i < count; ++i) {
            address pointer = pointers[i];
            uint256 dataSize = pointer.code.length - 1;
            assembly ("memory-safe") {
                extcodecopy(pointer, add(add(data, 0x20), cursor), 1, dataSize)
            }
            cursor += dataSize;
        }
    }
}
