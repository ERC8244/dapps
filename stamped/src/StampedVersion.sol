// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { IStampedVersion } from "./interfaces/IStampedVersion.sol";
import { CodeReader } from "./storage/CodeReader.sol";

/**
 * @title Immutable Stamped Application Version
 * @author acgk.eth
 * @notice Reconstructs one permanent compressed Stamped frontend and combined Mini App resource pack.
 * @notice Release content cannot be edited after deployment.
 * @dev Constructor validation binds ordered chunk pointers to caller-supplied Keccak-256 content hashes.
 * @dev The resource pack must ABI-decode as a manifest plus four non-empty image byte arrays.
 */
contract StampedVersion is IStampedVersion {
    using CodeReader for address[];

    /// @notice A release must have a non-empty identifier.
    error EmptyVersion();
    /// @notice The release identifier is too long or contains an unsupported character.
    error InvalidVersion();
    /// @notice A required content category or image asset is empty.
    error EmptyContent();
    /// @notice Reconstructed content does not match the publisher's expected commitment.
    error ContentHashMismatch(bytes32 expected, bytes32 actual);

    string private _version;
    address[] private _htmlPointers;
    address[] private _resourcePointers;

    /// @inheritdoc IStampedVersion
    bytes32 public override htmlHash;
    /// @inheritdoc IStampedVersion
    bytes32 public override resourcesHash;
    /// @inheritdoc IStampedVersion
    bytes32 public override manifestHash;
    /// @inheritdoc IStampedVersion
    bytes32 public override assetsHash;
    /// @inheritdoc IStampedVersion
    uint256 public override deployedAt;

    /**
     * @notice Creates one immutable, self-contained Stamped application release.
     * @param version_ Human-readable release identifier, limited to 32 safe ASCII characters.
     * @param htmlPointers_ Ordered bytecode-storage addresses containing deterministic gzip HTML bytes.
     * @param resourcePointers_ Ordered bytecode-storage addresses containing manifest and image bytes.
     * @param htmlHash_ Expected hash of the fully reconstructed gzip bytes.
     * @param resourcesHash_ Expected hash of the reconstructed combined resource pack.
     * @param manifestHash_ Expected hash of the fully reconstructed manifest bytes.
     * @param assetsHash_ Expected hash of the fully reconstructed asset-pack bytes.
     * @dev Reverts before deployment if any pointer is invalid, content is empty or malformed, or a hash differs.
     */
    constructor(
        string memory version_,
        address[] memory htmlPointers_,
        address[] memory resourcePointers_,
        bytes32 htmlHash_,
        bytes32 resourcesHash_,
        bytes32 manifestHash_,
        bytes32 assetsHash_
    ) {
        bytes memory versionBytes = bytes(version_);
        if (versionBytes.length == 0) revert EmptyVersion();
        if (versionBytes.length > 32) revert InvalidVersion();
        for (uint256 i; i < versionBytes.length; ++i) {
            bytes1 char = versionBytes[i];
            bool allowed = (char >= 0x30 && char <= 0x39) || (char >= 0x41 && char <= 0x5a)
                || (char >= 0x61 && char <= 0x7a) || char == 0x2d || char == 0x2e || char == 0x5f;
            if (!allowed) revert InvalidVersion();
        }
        if (htmlPointers_.length == 0 || resourcePointers_.length == 0) {
            revert EmptyContent();
        }

        _version = version_;
        _htmlPointers = htmlPointers_;
        _resourcePointers = resourcePointers_;

        bytes memory reconstructedHtml = _htmlPointers.readAll();
        bytes memory reconstructedResources = _resourcePointers.readAll();
        if (reconstructedHtml.length == 0 || reconstructedResources.length == 0) {
            revert EmptyContent();
        }
        (bytes memory manifest, bytes memory icon, bytes memory splash, bytes memory social, bytes memory embed) =
            abi.decode(reconstructedResources, (bytes, bytes, bytes, bytes, bytes));
        if (manifest.length == 0 || icon.length == 0 || splash.length == 0 || social.length == 0 || embed.length == 0) {
            revert EmptyContent();
        }

        bytes32 reconstructedHtmlHash = keccak256(reconstructedHtml);
        if (reconstructedHtmlHash != htmlHash_) revert ContentHashMismatch(htmlHash_, reconstructedHtmlHash);

        bytes32 reconstructedResourcesHash = keccak256(reconstructedResources);
        if (reconstructedResourcesHash != resourcesHash_) {
            revert ContentHashMismatch(resourcesHash_, reconstructedResourcesHash);
        }

        bytes32 reconstructedManifestHash = keccak256(manifest);
        if (reconstructedManifestHash != manifestHash_) {
            revert ContentHashMismatch(manifestHash_, reconstructedManifestHash);
        }

        bytes32 reconstructedAssetsHash = keccak256(abi.encode(icon, splash, social, embed));
        if (reconstructedAssetsHash != assetsHash_) revert ContentHashMismatch(assetsHash_, reconstructedAssetsHash);

        htmlHash = htmlHash_;
        resourcesHash = resourcesHash_;
        manifestHash = manifestHash_;
        assetsHash = assetsHash_;
        deployedAt = block.timestamp;
    }

    /// @inheritdoc IStampedVersion
    function version() external view override returns (string memory) {
        return _version;
    }

    /// @inheritdoc IStampedVersion
    function html() external view override returns (string memory) {
        return string(_htmlPointers.readAll());
    }

    /// @inheritdoc IStampedVersion
    function farcasterManifest() external view override returns (string memory) {
        (bytes memory manifest,,,,) = abi.decode(_resourcePointers.readAll(), (bytes, bytes, bytes, bytes, bytes));
        return string(manifest);
    }

    /// @inheritdoc IStampedVersion
    function assetPack() external view override returns (bytes memory) {
        (, bytes memory icon, bytes memory splash, bytes memory social, bytes memory embed) =
            abi.decode(_resourcePointers.readAll(), (bytes, bytes, bytes, bytes, bytes));
        return abi.encode(icon, splash, social, embed);
    }

    /**
     * @notice Returns the number of storage contracts backing the HTML application.
     * @return Number of ordered HTML chunks.
     */
    function htmlChunkCount() external view returns (uint256) {
        return _htmlPointers.length;
    }

    /**
     * @notice Returns one HTML bytecode-storage address.
     * @param index Zero-based position in the ordered HTML chunk list.
     * @return Address of the storage contract at `index`.
     */
    function htmlPointer(uint256 index) external view returns (address) {
        return _htmlPointers[index];
    }

    /**
     * @notice Returns the number of storage contracts backing all Mini App resources.
     * @return Number of ordered resource chunks.
     */
    function resourceChunkCount() external view returns (uint256) {
        return _resourcePointers.length;
    }

    /**
     * @notice Returns one combined-resource bytecode-storage address.
     * @param index Zero-based position in the ordered resource chunk list.
     * @return Address of the storage contract at `index`.
     */
    function resourcePointer(uint256 index) external view returns (address) {
        return _resourcePointers[index];
    }
}
