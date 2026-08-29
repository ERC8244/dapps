// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {Poidh8244} from "../src/Poidh8244.sol";

/// @notice The page the contract serves must be the page in the repo, byte for
///         byte, and the steward role must move only the way it says it does.
contract Poidh8244Test is Test {
    Poidh8244 page;
    bytes html;
    address[16] chunks;

    address steward = address(0xBEEF);
    address heir = address(0xCAFE);

    function setUp() public {
        html = bytes(vm.readFile("dapp/page.html"));
        address[16] memory d;
        // However many the chunker wrote, not however many are declared: the
        // slots past the page are left zero, which is what the page IS now.
        for (uint256 i; i != 16; ++i) {
            string memory f = string.concat("out/Poidh8244.chunk", vm.toString(i + 1), ".creation.txt");
            if (!vm.exists(f)) break;
            bytes memory initcode = vm.parseBytes(vm.readFile(f));
            address a;
            assembly ("memory-safe") {
                a := create(0, add(initcode, 0x20), mload(initcode))
            }
            require(a != address(0), "chunk deploy failed");
            d[i] = a;
        }
        require(d[0] != address(0), "no chunks found - run scripts/chunk.mjs");
        chunks = d;
        page = new Poidh8244(steward, address(0), d);
    }

    function testServesTheRepoPage() public view {
        assertEq(keccak256(bytes(page.html())), keccak256(html));
    }

    function testErc5219() public view {
        (uint16 code, string memory body, Poidh8244.KeyValue[] memory h) =
            page.request(new string[](0), new Poidh8244.KeyValue[](0));
        assertEq(code, 200);
        assertEq(keccak256(bytes(body)), keccak256(html));
        assertEq(h[0].value, "text/html");
        assertEq(page.resolveMode(), "5219");
    }

    function testLineageStartsAtOne() public view {
        assertEq(page.generation(), 1);
        assertEq(page.latest(), address(page));
        assertEq(page.successor(), address(0));
        assertEq(page.steward(), steward);
    }

    /// @dev A chunk that is empty or repeated would serve broken HTML forever.
    function testRejectsBadChunks() public {
        address[16] memory d;
        for (uint256 i; i != 16; ++i) d[i] = address(page);
        vm.expectRevert(Poidh8244.InvalidData.selector);
        new Poidh8244(steward, address(0), d);
    }

    /// @dev A page of no chunks is not a page.
    function testRejectsEmptyList() public {
        address[16] memory d;
        vm.expectRevert(Poidh8244.InvalidData.selector);
        new Poidh8244(steward, address(0), d);
    }

    /// @dev THE ONE THE WIDENED ARRAY ADDED. A zero between two chunks would
    ///      drop the middle of the page and still deploy, serving a document
    ///      with a hole in it that no reader could tell from a whole one.
    function testRejectsAHoleInTheList() public {
        address[16] memory d = chunks;
        d[1] = address(0);
        vm.expectRevert(Poidh8244.InvalidData.selector);
        new Poidh8244(steward, address(0), d);
    }

    /// @dev The same hole, arrived at from the far end.
    function testRejectsAChunkAfterTheEnd() public {
        address[16] memory d;
        d[0] = chunks[0];
        d[15] = chunks[1];
        vm.expectRevert(Poidh8244.InvalidData.selector);
        new Poidh8244(steward, address(0), d);
    }

    /// @dev One chunk is a legitimate page, and so is a short list.
    function testAcceptsFewerThanSixteen() public {
        address[16] memory d;
        d[0] = chunks[0];
        Poidh8244 one = new Poidh8244(steward, address(0), d);
        assertEq(one.html().length, chunks[0].code.length);
    }

    /// @dev The role moves in two steps, so a mistyped address cannot take it.
    function testStewardshipIsTwoStep() public {
        vm.prank(heir);
        vm.expectRevert(Poidh8244.NotSteward.selector);
        page.transferStewardship(heir);

        vm.prank(steward);
        page.transferStewardship(heir);
        assertEq(page.steward(), steward, "role moved before it was accepted");
        assertEq(page.pendingSteward(), heir);

        vm.prank(address(0xDEAD));
        vm.expectRevert(Poidh8244.NotPendingSteward.selector);
        page.acceptStewardship();

        vm.prank(heir);
        page.acceptStewardship();
        assertEq(page.steward(), heir);
        assertEq(page.pendingSteward(), address(0));

        vm.prank(steward);
        vm.expectRevert(Poidh8244.NotSteward.selector);
        page.transferStewardship(steward);
    }

    /// @dev Offering the zero address withdraws the offer; it does not renounce.
    function testOfferCanBeWithdrawn() public {
        vm.startPrank(steward);
        page.transferStewardship(heir);
        page.transferStewardship(address(0));
        vm.stopPrank();
        assertEq(page.steward(), steward);
        vm.prank(heir);
        vm.expectRevert(Poidh8244.NotPendingSteward.selector);
        page.acceptStewardship();
    }

    /// @dev Renouncing clears a standing offer in the same call, so an offer
    ///      made before the decision cannot be accepted after it.
    function testRenounceFreezesTheLineage() public {
        vm.startPrank(steward);
        page.transferStewardship(heir);
        page.renounceStewardship();
        vm.stopPrank();
        assertEq(page.steward(), address(0));
        assertEq(page.pendingSteward(), address(0));

        vm.prank(heir);
        vm.expectRevert(Poidh8244.NotPendingSteward.selector);
        page.acceptStewardship();

        vm.prank(steward);
        vm.expectRevert(Poidh8244.NotSteward.selector);
        page.deployNext(hex"00", bytes32(0));
    }

    /// @dev Only the current steward appends, and only once.
    function testDeployNext() public {
        address[16] memory d = chunks;
        bytes memory initcode =
            abi.encodePacked(type(Poidh8244).creationCode, abi.encode(steward, address(page), d));

        vm.prank(heir);
        vm.expectRevert(Poidh8244.NotSteward.selector);
        page.deployNext(initcode, bytes32(uint256(1)));

        vm.prank(steward);
        address next = page.deployNext(initcode, bytes32(uint256(1)));
        assertEq(page.successor(), next);
        assertEq(page.latest(), next);
        assertEq(Poidh8244(next).PREVIOUS(), address(page));
        assertEq(Poidh8244(next).generation(), 2);
        assertEq(uint256(page.succeededAt()), block.timestamp);

        vm.prank(steward);
        vm.expectRevert(Poidh8244.AlreadySucceeded.selector);
        page.deployNext(initcode, bytes32(uint256(2)));
    }

    /// @dev A successor that does not name this contract is refused, so the
    ///      write-once pointer cannot be burned on a stranger.
    function testRejectsForeignSuccessor() public {
        address[16] memory d = chunks;
        bytes memory initcode =
            abi.encodePacked(type(Poidh8244).creationCode, abi.encode(steward, address(0), d));
        vm.prank(steward);
        vm.expectRevert(Poidh8244.NotASuccessor.selector);
        page.deployNext(initcode, bytes32(uint256(3)));
    }
}
