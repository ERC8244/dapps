// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { IDecentralizedApp } from "../src/interfaces/IDecentralizedApp.sol";
import { StampedGatewayAdapter } from "../src/StampedGatewayAdapter.sol";
import { StampedResolver } from "../src/StampedResolver.sol";
import { StampedRoot } from "../src/StampedRoot.sol";
import { StampedVersion } from "../src/StampedVersion.sol";
import { CodeStore } from "../src/storage/CodeStore.sol";
import { TestBase } from "./TestBase.sol";

contract ChangedVersion {
    function html() external pure returns (string memory) {
        return "changed after review";
    }
}

contract StampedOnchainTest is TestBase {
    uint256 private constant CHUNK_SIZE = 24_575;
    string private constant MANIFEST =
        '{"miniapp":{"version":"1","name":"Stamped","requiredCapabilities":["wallet.getEthereumProvider"]}}';
    bytes private constant ICON = hex"89504e470d0a1a0a";
    bytes private constant SPLASH = hex"89504e470d0a1a0a01";
    bytes private constant SOCIAL = hex"89504e470d0a1a0a02";
    bytes private constant EMBED = hex"89504e470d0a1a0a03";

    function test_ReconstructsCanonicalReleaseBytes() external {
        bytes memory html = vm.readFileBinary("dapp/page.html.gz");
        StampedVersion app = _deploy("0.1.0", html, bytes(MANIFEST));

        assertEq(app.htmlHash(), keccak256(html));
        assertEq(app.resourcesHash(), keccak256(abi.encode(bytes(MANIFEST), ICON, SPLASH, SOCIAL, EMBED)));
        assertEq(app.manifestHash(), keccak256(bytes(MANIFEST)));
        assertEq(app.assetsHash(), keccak256(abi.encode(ICON, SPLASH, SOCIAL, EMBED)));
        assertEq(keccak256(bytes(app.html())), keccak256(html));
        assertEq(app.farcasterManifest(), MANIFEST);
        assertTrue(app.htmlChunkCount() > 1);
        assertEq(app.resourceChunkCount(), 1);
    }

    function test_RootAndResolverExposeErc5219Resources() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedResolver resolver = new StampedResolver(address(root));
        StampedVersion app = _publish(root, "0.1.0", bytes("<html>Stamped</html>"), bytes(MANIFEST));

        assertEq(root.generation(), 1);
        assertEq(resolver.stageLatest(), 1);
        assertEq(resolver.current(), address(app));
        // ERC-6944 defines this exact safe short-string conversion.
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(resolver.resolveMode(), bytes32("5219"));

        IDecentralizedApp.KeyValue[] memory params = new IDecentralizedApp.KeyValue[](0);
        string[] memory resource = new string[](0);
        (uint16 status, string memory body, IDecentralizedApp.KeyValue[] memory headers) =
            resolver.request(resource, params);
        assertEq(uint256(status), 200);
        assertEq(body, "<html>Stamped</html>");
        assertEq(headers[0].value, "text/html; charset=utf-8");
        assertEq(headers[1].key, "Content-Encoding");
        assertEq(headers[1].value, "gzip");

        resource = new string[](2);
        resource[0] = ".well-known";
        resource[1] = "farcaster.json";
        (status, body,) = resolver.request(resource, params);
        assertEq(uint256(status), 200);
        assertEq(body, MANIFEST);

        resource = new string[](1);
        resource[0] = "release.json";
        (status, body,) = resolver.request(resource, params);
        assertEq(uint256(status), 200);
        assertTrue(bytes(body).length > 150);

        resource[0] = "icon-onchain.png";
        (status, body, headers) = resolver.request(resource, params);
        assertEq(uint256(status), 200);
        assertEq(keccak256(bytes(body)), keccak256(ICON));
        assertEq(headers[0].value, "image/png");

        resource[0] = "embed-onchain.png";
        (status, body,) = resolver.request(resource, params);
        assertEq(uint256(status), 200);
        assertEq(keccak256(bytes(body)), keccak256(EMBED));
    }

    function test_GatewayAdapterServesCrawlerMetadataAndRawGzipRoute() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedResolver resolver = new StampedResolver(address(root));
        bytes memory compressedHtml = hex"1f8b0800000000000203";
        _publish(root, "0.1.0", compressedHtml, bytes(MANIFEST));
        resolver.stageLatest();
        StampedGatewayAdapter adapter = new StampedGatewayAdapter(address(resolver));

        IDecentralizedApp.KeyValue[] memory params = new IDecentralizedApp.KeyValue[](0);
        string[] memory resource = new string[](0);
        (uint16 status, string memory body, IDecentralizedApp.KeyValue[] memory headers) =
            adapter.request(resource, params);
        assertEq(uint256(status), 200);
        assertEq(uint256(headers.length), 2);
        assertEq(headers[0].value, "text/html; charset=utf-8");
        assertTrue(_contains(body, "name=\"fc:miniapp\""));
        assertTrue(_contains(body, "embed-onchain.png"));
        assertTrue(_contains(body, "Get stamped"));
        assertTrue(_contains(body, "og-onchain.png"));
        assertTrue(_contains(body, "DecompressionStream('gzip')"));

        resource = new string[](1);
        resource[0] = "app.gz";
        (status, body, headers) = adapter.request(resource, params);
        assertEq(uint256(status), 200);
        assertEq(keccak256(bytes(body)), keccak256(compressedHtml));
        assertEq(uint256(headers.length), 2);
        assertEq(headers[0].value, "application/gzip");

        resource = new string[](2);
        resource[0] = ".well-known";
        resource[1] = "farcaster.json";
        (status, body,) = adapter.request(resource, params);
        assertEq(uint256(status), 200);
        assertTrue(_contains(body, '"imageUrl":"https://stamped.wei.limo/embed-onchain.png"'));
        assertTrue(_contains(body, '"buttonTitle":"Get stamped"'));
        assertTrue(_contains(body, '"requiredCapabilities":["wallet.getEthereumProvider"]'));
    }

    function test_GatewayAdapterFollowsOnlyTheReviewedActiveRelease() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedResolver resolver = new StampedResolver(address(root));
        bytes memory firstHtml = bytes("first-gzip");
        bytes memory secondHtml = bytes("second-gzip");
        _publish(root, "0.1.0", firstHtml, bytes(MANIFEST));
        resolver.stageLatest();
        StampedGatewayAdapter adapter = new StampedGatewayAdapter(address(resolver));

        _publish(root, "0.2.0", secondHtml, bytes(MANIFEST));
        resolver.stageLatest();
        assertEq(_adapterCompressedHtml(adapter), string(firstHtml));

        vm.warp(resolver.candidateReadyAt());
        resolver.activate();
        assertEq(_adapterCompressedHtml(adapter), string(secondHtml));
    }

    function test_LaterReleaseRequiresThreeDayReview() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedResolver resolver = new StampedResolver(address(root));
        StampedVersion first = _publish(root, "0.1.0", bytes("first"), bytes(MANIFEST));
        resolver.stageLatest();
        StampedVersion second = _publish(root, "0.2.0", bytes("second"), bytes(MANIFEST));
        resolver.stageLatest();
        uint256 readyAt = resolver.candidateReadyAt();
        assertEq(resolver.stageLatest(), 2);
        assertEq(resolver.candidateReadyAt(), readyAt);

        assertEq(resolver.current(), address(first));
        (bool activatedEarly,) = address(resolver).call(abi.encodeCall(StampedResolver.activate, ()));
        assertTrue(!activatedEarly);

        vm.warp(block.timestamp + 3 days);
        assertEq(resolver.activate(), address(second));
        assertEq(resolver.currentGeneration(), 2);
    }

    function test_FirstStageCannotBootstrapALaterGeneration() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedResolver resolver = new StampedResolver(address(root));
        _publish(root, "0.1.0", bytes("first"), bytes(MANIFEST));
        StampedVersion second = _publish(root, "0.2.0", bytes("second"), bytes(MANIFEST));
        resolver.stageLatest();

        assertEq(resolver.current(), address(0));
        assertEq(resolver.candidateGeneration(), 2);
        (bool activatedEarly,) = address(resolver).call(abi.encodeCall(StampedResolver.activate, ()));
        assertTrue(!activatedEarly);

        vm.warp(block.timestamp + 3 days);
        assertEq(resolver.activate(), address(second));
        assertEq(resolver.currentGeneration(), 2);
    }

    function test_SupersededCandidateCannotActivate() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedResolver resolver = new StampedResolver(address(root));
        StampedVersion first = _publish(root, "0.1.0", bytes("first"), bytes(MANIFEST));
        resolver.stageLatest();
        _publish(root, "0.2.0", bytes("superseded"), bytes(MANIFEST));
        resolver.stageLatest();
        vm.warp(block.timestamp + 3 days);
        StampedVersion corrective = _publish(root, "0.3.0", bytes("corrective"), bytes(MANIFEST));

        (bool activatedSuperseded,) = address(resolver).call(abi.encodeCall(StampedResolver.activate, ()));
        assertTrue(!activatedSuperseded);
        assertEq(resolver.current(), address(first));

        resolver.stageLatest();
        assertEq(resolver.candidateGeneration(), 3);
        vm.warp(resolver.candidateReadyAt());
        assertEq(resolver.activate(), address(corrective));
    }

    function test_RootBuildsCanonicalVersion() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedVersion app = _publish(root, "0.1.0", bytes("html"), bytes(MANIFEST));
        StampedRoot.Release memory release_ = root.release(1);

        assertEq(release_.app, address(app));
        assertEq(address(app).codehash, root.versionCodeHash());
        assertTrue(root.isPublished(address(app)));
    }

    function test_ResolverRejectsContentChangedAfterPublication() external {
        StampedRoot root = new StampedRoot(address(this));
        StampedResolver resolver = new StampedResolver(address(root));
        StampedVersion app = _publish(root, "0.1.0", bytes("reviewed"), bytes(MANIFEST));

        resolver.stageLatest();
        bytes32 reviewedHash = resolver.htmlHash();
        ChangedVersion changed = new ChangedVersion();
        vm.etch(address(app), address(changed).code);

        (bool served,) = address(resolver).staticcall(abi.encodeCall(StampedResolver.html, ()));
        assertTrue(!served);
        assertEq(resolver.htmlHash(), reviewedHash);
    }

    function test_RejectsDelegationDesignatorPointer() external {
        address delegatedPointer = address(0xD311);
        vm.etch(delegatedPointer, hex"ef01001111111111111111111111111111111111111111");

        address[] memory htmlPointers = new address[](1);
        htmlPointers[0] = delegatedPointer;
        bytes memory assets = abi.encode(ICON, SPLASH, SOCIAL, EMBED);
        bytes memory resources = abi.encode(bytes(MANIFEST), ICON, SPLASH, SOCIAL, EMBED);
        address[] memory resourcePointers = _store(resources);

        try new StampedVersion(
            "0.1.0",
            htmlPointers,
            resourcePointers,
            keccak256(hex"01001111111111111111111111111111111111111111"),
            keccak256(resources),
            keccak256(bytes(MANIFEST)),
            keccak256(assets)
        ) returns (
            StampedVersion
        ) {
            assertTrue(false);
        } catch { }
    }

    function test_RejectsZeroLengthContent() external {
        address[] memory htmlPointers = new address[](1);
        htmlPointers[0] = CodeStore.write(bytes(""));
        bytes memory assets = abi.encode(ICON, SPLASH, SOCIAL, EMBED);
        bytes memory resources = abi.encode(bytes(MANIFEST), ICON, SPLASH, SOCIAL, EMBED);
        address[] memory resourcePointers = _store(resources);

        try new StampedVersion(
            "0.1.0",
            htmlPointers,
            resourcePointers,
            keccak256(bytes("")),
            keccak256(resources),
            keccak256(bytes(MANIFEST)),
            keccak256(assets)
        ) returns (
            StampedVersion
        ) {
            assertTrue(false);
        } catch { }
    }

    function test_RejectsMalformedAssetPack() external {
        bytes memory html = bytes("html");
        bytes memory manifest = bytes(MANIFEST);
        bytes memory malformedResources = bytes("not abi encoded resources");

        try new StampedVersion(
            "0.1.0",
            _store(html),
            _store(malformedResources),
            keccak256(html),
            keccak256(malformedResources),
            keccak256(manifest),
            keccak256(abi.encode(ICON, SPLASH, SOCIAL, EMBED))
        ) returns (
            StampedVersion
        ) {
            assertTrue(false);
        } catch { }
    }

    function _publish(StampedRoot root, string memory version, bytes memory html, bytes memory manifest)
        private
        returns (StampedVersion app)
    {
        address[] memory htmlPointers = _store(html);
        bytes memory assets = abi.encode(ICON, SPLASH, SOCIAL, EMBED);
        bytes memory resources = abi.encode(manifest, ICON, SPLASH, SOCIAL, EMBED);
        address[] memory resourcePointers = _store(resources);
        (, address appAddress) = root.publish(
            version,
            htmlPointers,
            resourcePointers,
            keccak256(html),
            keccak256(resources),
            keccak256(manifest),
            keccak256(assets)
        );
        app = StampedVersion(appAddress);
    }

    function _deploy(string memory version, bytes memory html, bytes memory manifest)
        private
        returns (StampedVersion app)
    {
        address[] memory htmlPointers = _store(html);
        bytes memory assets = abi.encode(ICON, SPLASH, SOCIAL, EMBED);
        bytes memory resources = abi.encode(manifest, ICON, SPLASH, SOCIAL, EMBED);
        address[] memory resourcePointers = _store(resources);
        app = new StampedVersion(
            version,
            htmlPointers,
            resourcePointers,
            keccak256(html),
            keccak256(resources),
            keccak256(manifest),
            keccak256(assets)
        );
    }

    function _store(bytes memory data) private returns (address[] memory pointers) {
        uint256 count = (data.length + CHUNK_SIZE - 1) / CHUNK_SIZE;
        if (count == 0) count = 1;
        pointers = new address[](count);

        for (uint256 index; index < count; ++index) {
            uint256 start = index * CHUNK_SIZE;
            uint256 length = data.length > start ? data.length - start : 0;
            if (length > CHUNK_SIZE) length = CHUNK_SIZE;
            bytes memory chunk = new bytes(length);
            for (uint256 i; i < length; ++i) {
                chunk[i] = data[start + i];
            }
            pointers[index] = CodeStore.write(chunk);
        }
    }

    function _adapterCompressedHtml(StampedGatewayAdapter adapter) private view returns (string memory body) {
        string[] memory resource = new string[](1);
        resource[0] = "app.gz";
        IDecentralizedApp.KeyValue[] memory params = new IDecentralizedApp.KeyValue[](0);
        (, body,) = adapter.request(resource, params);
    }

    function _contains(string memory value, string memory needle) private pure returns (bool) {
        bytes memory source = bytes(value);
        bytes memory sought = bytes(needle);
        if (sought.length == 0 || sought.length > source.length) return false;
        for (uint256 start; start <= source.length - sought.length; ++start) {
            bool matches = true;
            for (uint256 index; index < sought.length; ++index) {
                if (source[start + index] != sought[index]) {
                    matches = false;
                    break;
                }
            }
            if (matches) return true;
        }
        return false;
    }
}
