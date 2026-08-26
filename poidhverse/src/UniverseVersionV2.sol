// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IUniverseVersion} from "./UniverseVersion.sol";
import {CodeReader} from "./storage/CodeReader.sol";

/**
 * @title Immutable POIDH Universe Contract-First Application Version
 * @author acgk.eth
 * @notice Reconstructs one permanent, self-contained POIDH Universe frontend from immutable bytecode chunks.
 * @notice Bounty content is read directly from POIDH contracts at runtime; this release stores no bounty snapshot.
 * @dev Implements the original release interface so it can be published through the already-deployed root and resolver.
 * @dev The legacy snapshot functions return empty bytes and their canonical Keccak-256 hash without storing data chunks.
 */
contract UniverseVersionV2 is IUniverseVersion {
    using CodeReader for address[];

    error EmptyVersion();
    error EmptyContent();
    error ContentHashMismatch(bytes32 expected, bytes32 actual);

    string private _version;
    address[] private _htmlPointers;

    bytes32 public immutable override htmlHash;
    bytes32 public constant override snapshotHash = keccak256("");
    uint256 public immutable override deployedAt;

    /**
     * @notice Creates an immutable contract-first application release.
     * @param version_ Human-readable semantic version assigned to the release.
     * @param htmlPointers_ Ordered bytecode-storage addresses containing the canonical HTML bytes.
     * @param htmlHash_ Expected Keccak-256 hash of the fully reconstructed HTML document.
     * @dev Reconstructs the document during deployment and reverts unless it exactly matches `htmlHash_`.
     */
    constructor(string memory version_, address[] memory htmlPointers_, bytes32 htmlHash_) {
        if (bytes(version_).length == 0) revert EmptyVersion();
        if (htmlPointers_.length == 0) revert EmptyContent();

        _version = version_;
        _htmlPointers = htmlPointers_;

        bytes32 reconstructedHtmlHash = keccak256(_htmlPointers.readAll());
        if (reconstructedHtmlHash != htmlHash_) {
            revert ContentHashMismatch(htmlHash_, reconstructedHtmlHash);
        }

        htmlHash = htmlHash_;
        deployedAt = block.timestamp;
    }

    /// @inheritdoc IUniverseVersion
    function version() external view override returns (string memory) {
        return _version;
    }

    /// @inheritdoc IUniverseVersion
    function html() external view override returns (string memory) {
        return string(_htmlPointers.readAll());
    }

    /**
     * @inheritdoc IUniverseVersion
     * @dev Retained solely for compatibility with the immutable v0.1 root and resolver interface.
     */
    function snapshot() external pure override returns (bytes memory) {
        return bytes("");
    }

    /**
     * @notice Returns the number of bytecode-storage contracts used by the canonical HTML document.
     * @return The HTML chunk count.
     */
    function htmlChunkCount() external view returns (uint256) {
        return _htmlPointers.length;
    }

    /**
     * @notice Returns one immutable bytecode-storage address from the ordered HTML chunk list.
     * @param index Zero-based index in the HTML pointer array.
     * @return The storage contract address at `index`.
     * @dev Pointer-level access supports chunk verification without requesting the complete HTML through one RPC call.
     */
    function htmlPointer(uint256 index) external view returns (address) {
        return _htmlPointers[index];
    }
}
