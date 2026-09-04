// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title Stamped Immutable Release Interface
 * @notice Exposes the content and commitments belonging to one Stamped frontend generation.
 * @dev Implementations are expected to return permanent content whose hashes match the public commitment getters.
 */
interface IStampedVersion {
    /// @notice Returns the human-readable release identifier.
    function version() external view returns (string memory);
    /// @notice Returns the deterministic gzip representation of the complete self-contained HTML application.
    function html() external view returns (string memory);
    /// @notice Returns the Farcaster Mini App manifest JSON.
    function farcasterManifest() external view returns (string memory);
    /// @notice Returns ABI-encoded icon, splash, social-image, and 3:2 feed-embed bytes.
    function assetPack() external view returns (bytes memory);
    /// @notice Returns the Keccak-256 commitment to `html()` bytes.
    function htmlHash() external view returns (bytes32);
    /// @notice Returns the Keccak-256 commitment to the combined manifest-and-image resource pack.
    function resourcesHash() external view returns (bytes32);
    /// @notice Returns the Keccak-256 commitment to `farcasterManifest()` bytes.
    function manifestHash() external view returns (bytes32);
    /// @notice Returns the Keccak-256 commitment to `assetPack()` bytes.
    function assetsHash() external view returns (bytes32);
    /// @notice Returns the timestamp at which this immutable release was deployed.
    function deployedAt() external view returns (uint256);
}
