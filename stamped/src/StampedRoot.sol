// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { StampedVersion } from "./StampedVersion.sol";

/**
 * @title Stamped Release Root
 * @author acgk.eth
 * @notice Deploys and records the canonical, append-only history of immutable Stamped frontend releases.
 * @notice Only the immutable publisher may publish, and no recorded release can be changed or removed.
 * @dev Acting as the version factory guarantees every admitted app ran the canonical `StampedVersion` constructor.
 * @dev The resolver reads hash snapshots from this root rather than trusting a version contract at request time.
 */
contract StampedRoot {
    /**
     * @notice Metadata committed for one immutable application generation.
     * @param app Address of the `StampedVersion` deployed by this root.
     * @param versionHash Keccak-256 hash of the human-readable release identifier.
     * @param htmlHash Keccak-256 hash of the reconstructed single-file application.
     * @param resourcesHash Keccak-256 hash of the combined manifest-and-image resource pack.
     * @param manifestHash Keccak-256 hash of the reconstructed Farcaster manifest.
     * @param assetsHash Keccak-256 hash of the ABI-encoded image asset pack.
     * @param deployedAt Timestamp at which the version was deployed by this root.
     * @param publishedAt Timestamp at which the generation was appended.
     */
    struct Release {
        address app;
        bytes32 versionHash;
        bytes32 htmlHash;
        bytes32 resourcesHash;
        bytes32 manifestHash;
        bytes32 assetsHash;
        uint256 deployedAt;
        uint256 publishedAt;
    }

    /// @notice The caller is not the root's immutable publisher.
    error Unauthorized(address caller);
    /// @notice A zero address cannot control release publication.
    error InvalidPublisher();
    /// @notice The deployed application does not have the canonical version runtime code.
    error InvalidApp(address app);

    /**
     * @notice Emitted after one immutable frontend generation is deployed and appended.
     * @param generation Monotonically increasing release number.
     * @param app Address of the newly deployed `StampedVersion`.
     * @param versionHash Hash of the release identifier.
     * @param htmlHash Hash of the single-file application.
     * @param resourcesHash Hash of the combined manifest-and-image resource pack.
     * @param manifestHash Hash of the Farcaster manifest.
     * @param assetsHash Hash of the ABI-encoded asset pack.
     * @param deployedAt Version deployment timestamp.
     * @param publishedAt Root publication timestamp.
     */
    event ReleasePublished(
        uint256 indexed generation,
        address indexed app,
        bytes32 versionHash,
        bytes32 htmlHash,
        bytes32 resourcesHash,
        bytes32 manifestHash,
        bytes32 assetsHash,
        uint256 deployedAt,
        uint256 publishedAt
    );

    /// @notice Address permanently authorized to publish new frontend generations.
    address public immutable publisher;
    /// @notice Expected runtime code hash for every version created by this root.
    bytes32 public immutable versionCodeHash;
    /// @notice Most recently published version address, whether or not the resolver has activated it.
    address public latest;
    /// @notice Number of releases published through this root.
    uint256 public generation;

    mapping(uint256 => Release) private _releases;
    /// @notice Returns whether an application address was deployed and published by this root.
    mapping(address => bool) public isPublished;

    /**
     * @notice Creates an empty Stamped release registry controlled by one immutable publisher.
     * @param publisher_ Address authorized to publish future frontend generations.
     * @dev The canonical `StampedVersion` runtime hash is fixed at deployment for explicit release attestation.
     */
    constructor(address publisher_) {
        if (publisher_ == address(0)) revert InvalidPublisher();
        publisher = publisher_;
        versionCodeHash = keccak256(type(StampedVersion).runtimeCode);
    }

    /**
     * @notice Deploys and publishes a new immutable Stamped frontend generation.
     * @notice Publication cannot be undone. Review all artifact hashes before calling this function.
     * @param version_ Short release identifier containing only letters, digits, period, dash, or underscore.
     * @param htmlPointers Ordered bytecode-storage addresses containing deterministic gzip HTML bytes.
     * @param resourcePointers Ordered bytecode-storage addresses containing manifest and image resources.
     * @param htmlHash Expected hash of the reconstructed gzip bytes.
     * @param resourcesHash Expected hash of the combined resource pack.
     * @param manifestHash Expected hash of the reconstructed manifest bytes.
     * @param assetsHash Expected hash of the reconstructed asset-pack bytes.
     * @return newGeneration The monotonically increasing generation assigned to this release.
     * @return app Address of the immutable `StampedVersion` created by this root.
     * @dev `StampedVersion` reconstructs, decodes, and hashes all supplied content before this call can succeed.
     */
    function publish(
        string memory version_,
        address[] memory htmlPointers,
        address[] memory resourcePointers,
        bytes32 htmlHash,
        bytes32 resourcesHash,
        bytes32 manifestHash,
        bytes32 assetsHash
    ) external returns (uint256 newGeneration, address app) {
        if (msg.sender != publisher) revert Unauthorized(msg.sender);

        StampedVersion versionContract = new StampedVersion(
            version_, htmlPointers, resourcePointers, htmlHash, resourcesHash, manifestHash, assetsHash
        );
        app = address(versionContract);
        if (app.codehash != versionCodeHash) revert InvalidApp(app);

        newGeneration = generation + 1;
        bytes32 versionHash = keccak256(bytes(version_));
        uint256 timestamp = block.timestamp;
        _releases[newGeneration] = Release({
            app: app,
            versionHash: versionHash,
            htmlHash: htmlHash,
            resourcesHash: resourcesHash,
            manifestHash: manifestHash,
            assetsHash: assetsHash,
            deployedAt: timestamp,
            publishedAt: timestamp
        });
        generation = newGeneration;
        latest = app;
        isPublished[app] = true;

        emit ReleasePublished(
            newGeneration, app, versionHash, htmlHash, resourcesHash, manifestHash, assetsHash, timestamp, timestamp
        );
    }

    /**
     * @notice Returns the immutable release snapshot recorded for a generation.
     * @param generation_ Generation number to query.
     * @return The recorded metadata; an unpublished generation returns a zero-valued struct.
     */
    function release(uint256 generation_) external view returns (Release memory) {
        return _releases[generation_];
    }
}
