// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CodeReader} from "./storage/CodeReader.sol";

/**
 * @title POIDH Universe Version Interface
 * @author acgk.eth
 * @notice Defines the immutable content and release metadata exposed by every POIDH Universe application version.
 * @dev Implementations return the exact reconstructed HTML and snapshot bytes committed during deployment.
 */
interface IUniverseVersion {
    /// @notice Returns the human-readable semantic version assigned to this release.
    /// @return The release version string.
    function version() external view returns (string memory);

    /// @notice Reconstructs and returns the canonical self-contained application document.
    /// @return The exact HTML, CSS, JavaScript, and embedded asset document for this release.
    function html() external view returns (string memory);

    /// @notice Reconstructs and returns the immutable fallback-data snapshot.
    /// @return The exact snapshot bytes bundled with this release.
    function snapshot() external view returns (bytes memory);

    /// @notice Returns the Keccak-256 commitment to the canonical HTML bytes.
    /// @return The HTML content hash verified during construction.
    function htmlHash() external view returns (bytes32);

    /// @notice Returns the Keccak-256 commitment to the fallback snapshot bytes.
    /// @return The snapshot content hash verified during construction.
    function snapshotHash() external view returns (bytes32);

    /// @notice Returns the timestamp at which this immutable version was deployed.
    /// @return The deployment block timestamp.
    function deployedAt() external view returns (uint256);
}

/**
 * @title Immutable POIDH Universe Application Version
 * @author acgk.eth
 * @notice Reconstructs one permanent POIDH Universe frontend and its real-data fallback snapshot.
 * @notice Each deployed version remains independently retrievable even after newer generations are published.
 * @dev Application and snapshot bytes are read from ordered STOP-prefixed bytecode-storage contracts.
 * @dev The constructor reconstructs both artifacts and rejects deployment unless their hashes match the build inputs.
 */
contract UniverseVersion is IUniverseVersion {
    using CodeReader for address[];

    error EmptyVersion();
    error EmptyContent();
    error ContentHashMismatch(bytes32 expected, bytes32 actual);

    string private _version;
    address[] private _htmlPointers;
    address[] private _snapshotPointers;

    bytes32 public immutable override htmlHash;
    bytes32 public immutable override snapshotHash;
    uint256 public immutable override deployedAt;

    /**
     * @notice Creates an immutable application release from deployed bytecode-storage chunks.
     * @param version_ Human-readable semantic version assigned to the release.
     * @param htmlPointers_ Ordered addresses containing the canonical HTML bytes.
     * @param snapshotPointers_ Ordered addresses containing the fallback snapshot bytes.
     * @param htmlHash_ Expected Keccak-256 hash of the fully reconstructed HTML document.
     * @param snapshotHash_ Expected Keccak-256 hash of the fully reconstructed snapshot.
     * @dev Reconstructs and validates both artifacts before committing the release metadata.
     */
    constructor(
        string memory version_,
        address[] memory htmlPointers_,
        address[] memory snapshotPointers_,
        bytes32 htmlHash_,
        bytes32 snapshotHash_
    ) {
        if (bytes(version_).length == 0) revert EmptyVersion();
        if (htmlPointers_.length == 0 || snapshotPointers_.length == 0) revert EmptyContent();

        _version = version_;
        _htmlPointers = htmlPointers_;
        _snapshotPointers = snapshotPointers_;

        bytes32 reconstructedHtmlHash = keccak256(_htmlPointers.readAll());
        if (reconstructedHtmlHash != htmlHash_) {
            revert ContentHashMismatch(htmlHash_, reconstructedHtmlHash);
        }

        bytes32 reconstructedSnapshotHash = keccak256(_snapshotPointers.readAll());
        if (reconstructedSnapshotHash != snapshotHash_) {
            revert ContentHashMismatch(snapshotHash_, reconstructedSnapshotHash);
        }

        htmlHash = htmlHash_;
        snapshotHash = snapshotHash_;
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

    /// @inheritdoc IUniverseVersion
    function snapshot() external view override returns (bytes memory) {
        return _snapshotPointers.readAll();
    }

    /**
     * @notice Returns the number of storage contracts used to reconstruct the canonical HTML document.
     * @return The HTML chunk count.
     */
    function htmlChunkCount() external view returns (uint256) {
        return _htmlPointers.length;
    }

    /**
     * @notice Returns the number of storage contracts used to reconstruct the fallback snapshot.
     * @return The snapshot chunk count.
     */
    function snapshotChunkCount() external view returns (uint256) {
        return _snapshotPointers.length;
    }

    /**
     * @notice Returns one bytecode-storage address from the ordered HTML chunk list.
     * @param index Zero-based index in the HTML pointer array.
     * @return The storage contract address at `index`.
     * @dev Pointer-level access supports chunk verification without requesting the complete HTML through one RPC call.
     */
    function htmlPointer(uint256 index) external view returns (address) {
        return _htmlPointers[index];
    }

    /**
     * @notice Returns one bytecode-storage address from the ordered snapshot chunk list.
     * @param index Zero-based index in the snapshot pointer array.
     * @return The storage contract address at `index`.
     * @dev Pointer-level access supports chunk verification without requesting the complete snapshot through one RPC call.
     */
    function snapshotPointer(uint256 index) external view returns (address) {
        return _snapshotPointers[index];
    }
}
