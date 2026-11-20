// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {TacitArtifacts} from "../src/TacitArtifacts.sol";

/// Against a fork of Base Sepolia, where the pieces live: FORK_URL=https://base-sepolia-rpc.publicnode.com forge test --mc TacitArtifactsTest
contract TacitArtifactsTest is Test {
    TacitArtifacts idx;

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("https://base-sepolia-rpc.publicnode.com")));
        idx = new TacitArtifacts();
    }

    function testSmallFilesCheckOnchain() public view {
        TacitArtifacts.File[] memory f = idx.files();
        assertTrue(idx.check(f[2].manifest), "verifying key");
        assertTrue(idx.check(f[3].manifest), "pin record");
    }

    function testManifestsMatchTheIndex() public view {
        TacitArtifacts.File[] memory f = idx.files();
        uint256[5] memory pieces = [uint256(1163), 201, 1, 1, 29];
        for (uint256 i; i < f.length; ++i) {
            (bytes32 h, uint64 size, address[] memory p) = idx.manifest(f[i].manifest);
            assertEq(h, f[i].sha256, f[i].name);
            assertEq(size, f[i].size, f[i].name);
            assertEq(p.length, pieces[i], f[i].name);
        }
    }

    function testAPieceIsTheFilesBytes() public view {
        TacitArtifacts.File[] memory f = idx.files();
        bytes memory first = idx.piece(f[0].manifest, 0);
        assertEq(first.length, 24575);
        // A zkey starts with its magic "zkey" and version 1.
        assertEq(bytes4(first[0]) | (bytes4(first[1]) >> 8) | (bytes4(first[2]) >> 16) | (bytes4(first[3]) >> 24), bytes4("zkey"));
        (, , address[] memory p) = idx.manifest(f[0].manifest);
        bytes memory last = idx.piece(f[0].manifest, p.length - 1);
        assertEq(24575 * (p.length - 1) + last.length, f[0].size);
    }

    function testNotAManifest() public {
        vm.expectRevert(bytes("not a manifest"));
        idx.manifest(address(idx));
    }
}
