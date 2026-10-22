// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "forge-std/Test.sol";
import {zSwap} from "../src/zSwap.sol";
import {zSwapLink} from "../src/zSwapLink.sol";

/// @notice The page the contract serves must be the page in the repo, byte for
///         byte, the constructor must refuse a chunk list that cannot be that
///         page, and a successor can only be added the way the lineage says.
contract zSwap8244Test is Test {
    uint256 constant CHUNKS = 28;
    address dao = address(0xDA0);

    bytes html;
    address[CHUNKS] chunks;
    zSwap page;

    function setUp() public {
        html = bytes(vm.readFile("dapp/page.html"));
        for (uint256 i; i != CHUNKS; ++i) {
            string memory f = string.concat("out/zSwap.chunk", vm.toString(i + 1), ".creation.txt");
            require(vm.exists(f), "no chunks found - run scripts/chunk.mjs zswap");
            chunks[i] = _deploy(vm.parseBytes(vm.readFile(f)));
        }
        page = new zSwap(dao, address(0), chunks);
    }

    function _deploy(bytes memory initcode) internal returns (address a) {
        assembly { a := create(0, add(initcode, 0x20), mload(initcode)) }
        require(a != address(0), "chunk deploy failed");
    }

    function testServesTheRepoPage() public view {
        assertEq(bytes(page.html()).length, html.length);
        assertEq(keccak256(bytes(page.html())), keccak256(html));
    }

    function testRequestServesTheSamePage() public view {
        (uint16 status, string memory body, zSwap.KeyValue[] memory headers) =
            page.request(new string[](0), new zSwap.KeyValue[](0));
        assertEq(status, 200);
        assertEq(keccak256(bytes(body)), keccak256(html));
        assertEq(headers[0].value, "text/html");
        assertEq(page.resolveMode(), bytes32("5219"));
    }

    function testRejectsAnEmptyChunk() public {
        address[CHUNKS] memory bad = chunks;
        bad[7] = address(0xBAD);
        vm.expectRevert(zSwap.InvalidData.selector);
        new zSwap(dao, address(0), bad);
    }

    function testRejectsARepeatedChunk() public {
        address[CHUNKS] memory bad = chunks;
        bad[27] = bad[0];
        vm.expectRevert(zSwap.InvalidData.selector);
        new zSwap(dao, address(0), bad);
    }

    function testOnlyThePredecessorCanNameItself() public {
        vm.expectRevert(zSwap.InvalidData.selector);
        new zSwap(dao, address(page), chunks);
    }

    function testOnlyTheDaoAddsASuccessorAndOnlyOnce() public {
        bytes memory init = abi.encodePacked(type(zSwap).creationCode, abi.encode(dao, address(page), chunks));
        vm.expectRevert(zSwap.NotDAO.selector);
        page.deployNext(init, bytes32(0));

        vm.prank(dao);
        address next = page.deployNext(init, bytes32(0));
        assertEq(page.successor(), next);
        assertEq(page.latest(), next);
        assertEq(zSwap(next).PREVIOUS(), address(page));
        assertEq(zSwap(next).generation(), 2);
        assertEq(keccak256(bytes(zSwap(next).html())), keccak256(html));

        vm.prank(dao);
        vm.expectRevert(zSwap.AlreadySucceeded.selector);
        page.deployNext(init, bytes32(uint256(1)));
    }

    /// The lineage successor deployed on mainnet is a zSwapLink: it relays html()
    /// and request() to an already-deployed page and keeps the lineage rules.
    function testALinkSuccessorServesThePage() public {
        bytes memory init = abi.encodePacked(type(zSwapLink).creationCode, abi.encode(dao, address(page), address(page)));
        vm.prank(dao);
        address next = page.deployNext(init, bytes32(0));
        assertEq(page.latest(), next);
        assertEq(zSwapLink(next).PREVIOUS(), address(page));
        assertEq(keccak256(bytes(zSwap(next).html())), keccak256(html));
        assertEq(zSwap(next).resolveMode(), bytes32("5219"));
    }
}
