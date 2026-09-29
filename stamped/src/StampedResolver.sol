// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { IDecentralizedApp } from "./interfaces/IDecentralizedApp.sol";
import { IStampedVersion } from "./interfaces/IStampedVersion.sol";
import { StampedRoot } from "./StampedRoot.sol";

/**
 * @title Stamped Release Resolver
 * @author acgk.eth
 * @notice Serves the reviewed Stamped frontend through one stable ERC-4804/ERC-5219-compatible address.
 * @notice The first release activates immediately; every later release requires a three-day public review delay.
 * @dev Staging and activation are permissionless so serving availability never depends on a privileged operator.
 * @dev Response content is rehashed against the root snapshot before it is returned.
 */
contract StampedResolver is IStampedVersion, IDecentralizedApp {
    /// @notice Review period required before any generation after generation one can become active.
    uint64 public constant DELAY = 3 days;

    /// @notice The supplied root is not a deployed Stamped root with a non-zero publisher.
    error InvalidRoot(address root);
    /// @notice The root has no usable published release.
    error NoPublishedRelease();
    /// @notice No release has been activated for serving.
    error NoActiveRelease();
    /// @notice The root has no generation newer than the active generation.
    error NoNewGeneration(uint256 generation);
    /// @notice No release is currently waiting for activation.
    error NoCandidate();
    /// @notice A newer root generation replaced the staged candidate before activation.
    error SupersededCandidate(uint256 candidateGeneration, uint256 latestGeneration);
    /// @notice The candidate's public review period has not elapsed.
    error DelayActive(uint256 readyAt);
    /// @notice Returned version content differs from the immutable root snapshot.
    error ContentHashMismatch(bytes32 expected, bytes32 actual);

    /**
     * @notice Emitted when a published generation begins its public review delay.
     * @param generation Root generation staged for review.
     * @param app Immutable version contract associated with that generation.
     * @param readyAt Earliest timestamp at which the candidate can be activated.
     */
    event ReleaseStaged(uint256 indexed generation, address indexed app, uint256 readyAt);
    /**
     * @notice Emitted when a reviewed generation becomes the release served by this resolver.
     * @param generation Root generation that became active.
     * @param app Immutable version contract now served by stable routes.
     */
    event ReleaseActivated(uint256 indexed generation, address indexed app);

    /// @notice Append-only release registry and canonical version factory used by this resolver.
    StampedRoot public immutable root;
    /// @notice Version contract currently served by this resolver.
    address public current;
    /// @notice Root generation currently served by this resolver.
    uint256 public currentGeneration;
    /// @notice Newest generation currently staged for review, or zero when none is staged.
    uint256 public candidateGeneration;
    /// @notice Earliest activation timestamp for the staged candidate, or zero when none is staged.
    uint256 public candidateReadyAt;

    /**
     * @notice Creates a stable resolver for one Stamped release root.
     * @param root_ Address of the deployed append-only `StampedRoot` registry.
     * @dev Deployment tooling must still verify the exact root bytecode and address; interface checks alone are not identity.
     */
    constructor(address root_) {
        if (root_.code.length == 0) revert InvalidRoot(root_);
        try StampedRoot(root_).publisher() returns (address publisher_) {
            if (publisher_ == address(0)) revert InvalidRoot(root_);
        } catch {
            revert InvalidRoot(root_);
        }
        root = StampedRoot(root_);
    }

    /**
     * @notice Advertises ERC-5219 routing to ERC-4804 gateways through ERC-6944.
     * @return Exact short ASCII mode identifier `5219`, right-padded to 32 bytes.
     * @dev Gateways use this signal to call `request` for decentralized application resources.
     */
    function resolveMode() external pure returns (bytes32) {
        // ERC-6944 requires this exact short ASCII value, right-padded to bytes32.
        // forge-lint: disable-next-line(unsafe-typecast)
        return bytes32("5219");
    }

    /**
     * @notice Stages the newest published root generation for activation.
     * @notice Calling this for generation one activates it immediately; all future generations start a three-day delay.
     * @return generation_ Root generation staged or immediately activated.
     * @dev Permissionless and idempotent for an already staged latest generation, so third parties cannot reset its timer.
     */
    function stageLatest() external returns (uint256 generation_) {
        generation_ = root.generation();
        if (generation_ == 0) revert NoPublishedRelease();
        if (generation_ <= currentGeneration) revert NoNewGeneration(generation_);
        if (generation_ == candidateGeneration) return generation_;

        StampedRoot.Release memory release_ = root.release(generation_);
        if (release_.app.code.length == 0) revert NoPublishedRelease();

        if (currentGeneration == 0 && generation_ == 1) {
            _activate(generation_, release_.app);
            return generation_;
        }

        candidateGeneration = generation_;
        candidateReadyAt = block.timestamp + DELAY;
        emit ReleaseStaged(generation_, release_.app, candidateReadyAt);
    }

    /**
     * @notice Activates the staged generation after its public review period.
     * @return app Immutable version contract that became active.
     * @dev Requires the candidate to remain the root's latest generation, preventing activation of superseded content.
     */
    function activate() external returns (address app) {
        uint256 generation_ = candidateGeneration;
        if (generation_ == 0) revert NoCandidate();
        uint256 latestGeneration = root.generation();
        if (generation_ != latestGeneration) revert SupersededCandidate(generation_, latestGeneration);
        uint256 readyAt = candidateReadyAt;
        // A validator's seconds-scale latitude is immaterial to a three-day public review period.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < readyAt) revert DelayActive(readyAt);

        app = root.release(generation_).app;
        if (app.code.length == 0) revert NoPublishedRelease();
        _activate(generation_, app);
    }

    /// @inheritdoc IStampedVersion
    function version() external view override returns (string memory) {
        StampedRoot.Release memory release_ = _activeRelease();
        return _version(release_);
    }

    /// @inheritdoc IStampedVersion
    function html() external view override returns (string memory) {
        StampedRoot.Release memory release_ = _activeRelease();
        return _html(release_);
    }

    /// @inheritdoc IStampedVersion
    function farcasterManifest() external view override returns (string memory) {
        StampedRoot.Release memory release_ = _activeRelease();
        return _manifest(release_);
    }

    /// @inheritdoc IStampedVersion
    function assetPack() external view override returns (bytes memory) {
        StampedRoot.Release memory release_ = _activeRelease();
        return _assets(release_);
    }

    /// @inheritdoc IStampedVersion
    function htmlHash() external view override returns (bytes32) {
        return _activeRelease().htmlHash;
    }

    /// @inheritdoc IStampedVersion
    function resourcesHash() external view override returns (bytes32) {
        return _activeRelease().resourcesHash;
    }

    /// @inheritdoc IStampedVersion
    function manifestHash() external view override returns (bytes32) {
        return _activeRelease().manifestHash;
    }

    /// @inheritdoc IStampedVersion
    function assetsHash() external view override returns (bytes32) {
        return _activeRelease().assetsHash;
    }

    /// @inheritdoc IStampedVersion
    function deployedAt() external view override returns (uint256) {
        return _activeRelease().deployedAt;
    }

    /**
     * @inheritdoc IDecentralizedApp
     * @dev Supports the app shell, Farcaster manifest, release commitment, and four image asset routes.
     */
    function request(string[] memory resource, KeyValue[] memory)
        external
        view
        override
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers)
    {
        StampedRoot.Release memory release_ = _activeRelease();
        if (_isHtml(resource)) return (200, _html(release_), _htmlHeaders());

        if (resource.length == 2 && _same(resource[0], ".well-known") && _same(resource[1], "farcaster.json")) {
            return (200, _manifest(release_), _headers("application/json; charset=utf-8"));
        }

        if (resource.length == 1 && _same(resource[0], "release.json")) {
            body = string.concat(
                '{"version":"',
                _version(release_),
                '","generation":',
                _uintString(currentGeneration),
                ',"htmlHash":"',
                _hex(release_.htmlHash),
                '","manifestHash":"',
                _hex(release_.manifestHash),
                '","resourcesHash":"',
                _hex(release_.resourcesHash),
                '","assetsHash":"',
                _hex(release_.assetsHash),
                '"}'
            );
            return (200, body, _headers("application/json; charset=utf-8"));
        }

        if (resource.length == 1 && _isAsset(resource[0])) {
            (bytes memory icon, bytes memory splash, bytes memory social, bytes memory embed) =
                abi.decode(_assets(release_), (bytes, bytes, bytes, bytes));
            if (_same(resource[0], "icon-onchain.png")) return (200, string(icon), _headers("image/png"));
            if (_same(resource[0], "splash-onchain.png")) return (200, string(splash), _headers("image/png"));
            if (_same(resource[0], "embed-onchain.png")) return (200, string(embed), _headers("image/png"));
            return (200, string(social), _headers("image/png"));
        }

        return (404, "Not found", _headers("text/plain; charset=utf-8"));
    }

    /**
     * @notice Returns the immutable version currently served by all stable resolver routes.
     * @return Active version address, or the zero address before the first activation.
     */
    function latest() external view returns (address) {
        return current;
    }

    /**
     * @dev Makes a published version active and clears all candidate state.
     * @param generation_ Root generation associated with `app`.
     * @param app Immutable version contract to serve.
     */
    function _activate(uint256 generation_, address app) private {
        current = app;
        currentGeneration = generation_;
        candidateGeneration = 0;
        candidateReadyAt = 0;
        emit ReleaseActivated(generation_, app);
    }

    /// @dev Returns the active version and rejects reads before first activation.
    function _current() private view returns (address app) {
        app = current;
        if (app == address(0)) revert NoActiveRelease();
    }

    /// @dev Loads the active root snapshot and verifies its app matches resolver state.
    function _activeRelease() private view returns (StampedRoot.Release memory release_) {
        address app = _current();
        release_ = root.release(currentGeneration);
        if (release_.app != app) revert NoActiveRelease();
    }

    /// @dev Reads the release identifier and checks it against the root's immutable hash snapshot.
    function _version(StampedRoot.Release memory release_) private view returns (string memory value) {
        value = IStampedVersion(release_.app).version();
        _check(release_.versionHash, keccak256(bytes(value)));
    }

    /// @dev Reconstructs the HTML application and checks it against the root snapshot.
    function _html(StampedRoot.Release memory release_) private view returns (string memory value) {
        value = IStampedVersion(release_.app).html();
        _check(release_.htmlHash, keccak256(bytes(value)));
    }

    /// @dev Reconstructs the Farcaster manifest and checks it against the root snapshot.
    function _manifest(StampedRoot.Release memory release_) private view returns (string memory value) {
        value = IStampedVersion(release_.app).farcasterManifest();
        _check(release_.manifestHash, keccak256(bytes(value)));
    }

    /// @dev Reconstructs the encoded image pack and checks it against the root snapshot.
    function _assets(StampedRoot.Release memory release_) private view returns (bytes memory value) {
        value = IStampedVersion(release_.app).assetPack();
        _check(release_.assetsHash, keccak256(value));
    }

    /// @dev Enforces exact equality between an onchain snapshot and reconstructed bytes.
    function _check(bytes32 expected, bytes32 actual) private pure {
        if (expected != actual) revert ContentHashMismatch(expected, actual);
    }

    /// @dev Recognizes the root path, an empty segment, and `index.html` as app-shell requests.
    function _isHtml(string[] memory resource) private pure returns (bool) {
        return resource.length == 0
            || (resource.length == 1 && (bytes(resource[0]).length == 0 || _same(resource[0], "index.html")));
    }

    /// @dev Compares short route strings by Keccak-256 hash.
    function _same(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// @dev Returns whether a resource name maps to one of the four committed image assets.
    function _isAsset(string memory resource) private pure returns (bool) {
        return _same(resource, "icon-onchain.png") || _same(resource, "splash-onchain.png")
            || _same(resource, "og-onchain.png") || _same(resource, "embed-onchain.png");
    }

    /// @dev Builds deterministic content-type and one-minute public-cache response headers.
    function _headers(string memory contentType) private pure returns (KeyValue[] memory headers) {
        headers = new KeyValue[](2);
        headers[0] = KeyValue({ key: "Content-Type", value: contentType });
        headers[1] = KeyValue({ key: "Cache-Control", value: "public, max-age=60" });
    }

    /**
     * @dev Marks the app shell as deterministic gzip per ERC-7618 while retaining the normal HTML media type.
     */
    function _htmlHeaders() private pure returns (KeyValue[] memory headers) {
        headers = new KeyValue[](4);
        headers[0] = KeyValue({ key: "Content-Type", value: "text/html; charset=utf-8" });
        headers[1] = KeyValue({ key: "Content-Encoding", value: "gzip" });
        headers[2] = KeyValue({ key: "Vary", value: "Accept-Encoding" });
        headers[3] = KeyValue({ key: "Cache-Control", value: "public, max-age=60" });
    }

    /// @dev Encodes an unsigned integer as minimal base-10 ASCII for `release.json`.
    function _uintString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        uint256 cursor = value;
        while (cursor != 0) {
            ++digits;
            cursor /= 10;
        }
        bytes memory output = new bytes(digits);
        while (value != 0) {
            // The remainder is always 0...9, so adding ASCII zero cannot overflow uint8.
            // forge-lint: disable-next-line(unsafe-typecast)
            output[--digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(output);
    }

    /// @dev Encodes a bytes32 commitment as a 0x-prefixed, lower-case hexadecimal string.
    function _hex(bytes32 value) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory output = new bytes(66);
        output[0] = "0";
        output[1] = "x";
        for (uint256 i; i < 32; ++i) {
            uint8 byteValue = uint8(value[i]);
            output[2 + i * 2] = alphabet[byteValue >> 4];
            output[3 + i * 2] = alphabet[byteValue & 0x0f];
        }
        return string(output);
    }
}
