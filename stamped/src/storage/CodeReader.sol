// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title Immutable Bytecode Reader
 * @author acgk.eth
 * @notice Reconstructs application data from ordered, STOP-prefixed bytecode-storage contracts.
 * @dev Reads skip runtime byte zero so callers receive only the original payloads.
 * @dev Requiring STOP also rejects EIP-7702 delegation designators and unrelated runtime contracts.
 */
library CodeReader {
    /// @notice A pointer has no code or is not a canonical STOP-prefixed storage contract.
    error InvalidPointer(address pointer);

    /**
     * @notice Reconstructs one artifact from an ordered storage-pointer array.
     * @param pointers Storage array containing chunk addresses in canonical byte order.
     * @return data Exact concatenation of every payload without the leading STOP bytes.
     * @dev Calculates the complete size before allocating once, then copies each immutable payload with EXTCODECOPY.
     */
    function readAll(address[] storage pointers) internal view returns (bytes memory data) {
        uint256 count = pointers.length;
        uint256 totalSize;

        for (uint256 i; i < count; ++i) {
            address pointer = pointers[i];
            uint256 codeSize = pointer.code.length;
            if (codeSize == 0) revert InvalidPointer(pointer);
            uint256 firstByte;
            assembly ("memory-safe") {
                extcodecopy(pointer, 0, 0, 1)
                firstByte := byte(0, mload(0))
            }
            // CodeStore pointers are STOP-prefixed. This also rejects mutable EIP-7702
            // delegation designators, whose first byte is 0xef.
            if (firstByte != 0) revert InvalidPointer(pointer);
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
