// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CodeStore} from "../src/storage/CodeStore.sol";
import {UniverseVersionV2} from "../src/UniverseVersionV2.sol";

interface VmFiles {
    function readFileBinary(string calldata path) external view returns (bytes memory data);
}

contract Poidhverse8244Test {
    error AssertionFailed(string message);

    VmFiles private constant vm = VmFiles(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant CHUNK_SIZE = 24_575;
    bytes32 private constant EXPECTED_HTML_HASH = 0x9c9ac545ee71c01d9de3c0c822097856dfd915e48b9ed4f55b79dd69fa539235;

    function testServesTheRepoPage() public {
        bytes memory html = vm.readFileBinary("dapp/page.html");
        address[] memory pointers = _writeChunks(html);
        UniverseVersionV2 page = new UniverseVersionV2("0.2.2", pointers, EXPECTED_HTML_HASH);

        _assertEq(html.length, 296_949, "unexpected release byte length");
        _assertEq(keccak256(html), EXPECTED_HTML_HASH, "unexpected release hash");
        _assertEq(keccak256(bytes(page.html())), EXPECTED_HTML_HASH, "html() changed release bytes");
        _assertEq(page.htmlChunkCount(), 13, "unexpected chunk count");
        _assertEq(keccak256(page.snapshot()), keccak256(""), "v0.2 must not store a snapshot");
    }

    function testRejectsWrongCommitment() public {
        bytes memory html = vm.readFileBinary("dapp/page.html");
        address[] memory pointers = _writeChunks(html);

        try new UniverseVersionV2("0.2.2", pointers, bytes32(0)) {
            revert AssertionFailed("wrong commitment was accepted");
        } catch (bytes memory reason) {
            // The revert payload is known to contain a four-byte custom-error selector.
            // forge-lint: disable-next-line(unsafe-typecast)
            _assertSelector(
                bytes4(reason), UniverseVersionV2.ContentHashMismatch.selector, "unexpected constructor failure"
            );
        }
    }

    function _writeChunks(bytes memory content) private returns (address[] memory pointers) {
        uint256 count = (content.length + CHUNK_SIZE - 1) / CHUNK_SIZE;
        pointers = new address[](count);
        for (uint256 index; index < count; ++index) {
            uint256 start = index * CHUNK_SIZE;
            uint256 remaining = content.length - start;
            uint256 length = remaining < CHUNK_SIZE ? remaining : CHUNK_SIZE;
            bytes memory chunk = new bytes(length);
            for (uint256 offset; offset < length; ++offset) {
                chunk[offset] = content[start + offset];
            }
            pointers[index] = CodeStore.write(chunk);
        }
    }

    function _assertEq(uint256 left, uint256 right, string memory message) private pure {
        if (left != right) revert AssertionFailed(message);
    }

    function _assertEq(bytes32 left, bytes32 right, string memory message) private pure {
        if (left != right) revert AssertionFailed(message);
    }

    function _assertSelector(bytes4 left, bytes4 right, string memory message) private pure {
        if (left != right) revert AssertionFailed(message);
    }
}
