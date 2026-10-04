// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {TacitPay8244} from "../src/TacitPay8244.sol";

/// @notice The page the contract serves must be the page in the repo, byte for
///         byte, the constructor must refuse every chunk list that is not that
///         page, and the steward role must move only the way it says it does.
/// @dev A version contract that is only as much as `deployNext` asks of one.
contract MinimalSuccessor {
    address public immutable PREVIOUS;
    address public successor;
    constructor(address prev) { PREVIOUS = prev; }
}

/// @dev A successor whose constructor, once made steward, appends another successor to the same predecessor.
contract ReentrantSuccessor {
    address public immutable PREVIOUS;
    address public successor;
    constructor(address prev, bytes memory innerInit, bytes32 innerSalt) {
        PREVIOUS = prev;
        TacitPay8244(prev).acceptStewardship();
        TacitPay8244(prev).deployNext(innerInit, innerSalt);
    }
}

contract TacitPay8244Test is Test {
    /// @dev The page's length, as manifest.json pins it.
    uint256 constant PAGE_BYTES = 348263;

    TacitPay8244 page;
    bytes html;
    bytes32 pageHash;
    address[] chunks;

    address steward = address(0xBEEF);
    address heir = address(0xCAFE);

    function setUp() public {
        html = bytes(vm.readFile("dapp/page.html"));
        pageHash = keccak256(html);
        // However many the chunker wrote, not a number declared here: the page
        // decides the count, which is the reason the list is dynamic.
        for (uint256 i; ; ++i) {
            string memory f = string.concat("out/TacitPay8244.chunk", vm.toString(i + 1), ".creation.txt");
            if (!vm.exists(f)) break;
            chunks.push(_deploy(vm.parseBytes(vm.readFile(f))));
        }
        require(chunks.length != 0, "no chunks found - run scripts/chunk.mjs tacit-pay");
        page = new TacitPay8244(steward, address(0), chunks, pageHash);
    }

    function testServesTheRepoPage() public view {
        assertEq(keccak256(bytes(page.html())), pageHash);
        assertEq(page.PAGE_HASH(), pageHash);
        assertEq(page.PAGE_LENGTH(), html.length);
        assertEq(page.chunkCount(), chunks.length);
        assertEq(page.chunkAt(0), chunks[0]);
    }

    /// @dev The one number the manifest pins that the chain can also be asked
    ///      for. If these disagree the repo has moved and nobody said so.
    function testPageIsTheManifestLength() public view {
        assertEq(html.length, PAGE_BYTES);
    }

    /// @dev What the page talks to and what it will accept, readable from the contract that serves it.
    function testNamesThePoolAndThePins() public view {
        assertEq(page.POOL(), 0x000000c2A20657CE25f2Ba99737933D031AFBEE9);
        assertEq(page.ROUTER(), 0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5);
        assertEq(page.VERIFIER(), 0x000000b1c0e84CEc8AdF8278B90c4d6400DfB153);
        assertEq(page.PROVING_KEY_SHA256(), 0x40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b);
        assertEq(page.WITNESS_PROGRAM_SHA256(), 0x02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1);
        assertEq(page.NAME(), "anon.wei");
    }

    function testErc5219() public view {
        (uint16 code, string memory body, TacitPay8244.KeyValue[] memory h) =
            page.request(new string[](0), new TacitPay8244.KeyValue[](0));
        assertEq(code, 200);
        assertEq(keccak256(bytes(body)), pageHash);
        assertEq(h[0].value, "text/html");
        assertEq(page.resolveMode(), "5219");
    }

    function testLineageStartsAtOne() public view {
        assertEq(page.generation(), 1);
        assertEq(page.latest(), address(page));
        assertEq(page.successor(), address(0));
        assertEq(page.steward(), steward);
    }

    /// @dev A page committed to but not delivered is the failure this exists to
    ///      make impossible: it would deploy happily and serve the wrong bytes
    ///      forever.
    function testRejectsWrongCommitment() public {
        vm.expectRevert(
            abi.encodeWithSelector(TacitPay8244.PageHashMismatch.selector, bytes32(0), pageHash)
        );
        new TacitPay8244(steward, address(0), chunks, bytes32(0));
    }

    /// @dev Reordering is the mistake a length check cannot see: the same
    ///      chunks in the wrong order still sum to the same number of bytes.
    function testRejectsReorderedChunks() public {
        vm.assume(chunks.length > 1);
        address[] memory swapped = chunks;
        (swapped[0], swapped[1]) = (swapped[1], swapped[0]);
        vm.expectPartialRevert(TacitPay8244.PageHashMismatch.selector);
        new TacitPay8244(steward, address(0), swapped, pageHash);
    }

    /// @dev Empty, codeless and repeated chunks are rejected before the hash is
    ///      ever computed, because each of them is a broken deploy script and
    ///      not a page.
    function testRejectsBadChunks() public {
        address[] memory none = new address[](0);
        vm.expectRevert(TacitPay8244.InvalidData.selector);
        new TacitPay8244(steward, address(0), none, pageHash);

        address[] memory codeless = new address[](1);
        codeless[0] = address(0xDEAD);
        vm.expectRevert(TacitPay8244.InvalidData.selector);
        new TacitPay8244(steward, address(0), codeless, pageHash);

        address[] memory repeated = new address[](chunks.length + 1);
        for (uint256 i; i != chunks.length; ++i) repeated[i] = chunks[i];
        repeated[chunks.length] = chunks[0];
        vm.expectRevert(TacitPay8244.InvalidData.selector);
        new TacitPay8244(steward, address(0), repeated, pageHash);
    }

    /// @dev A chunk holding nothing but its STOP prefix carries no page.
    function testRejectsPrefixOnlyChunk() public {
        address[] memory withEmpty = new address[](chunks.length + 1);
        for (uint256 i; i != chunks.length; ++i) withEmpty[i] = chunks[i];
        // PUSH2 0x0001 DUP1 PUSH1 0x0a PUSH0 CODECOPY PUSH0 RETURN | STOP
        withEmpty[chunks.length] = _deploy(hex"61000180600a5f395ff300");
        vm.expectRevert(TacitPay8244.InvalidData.selector);
        new TacitPay8244(steward, address(0), withEmpty, pageHash);
    }

    /// @dev A predecessor that did not deploy this contract cannot be claimed:
    ///      any non-zero `previous` must be the caller, and only `deployNext`
    ///      ever calls as one.
    function testRejectsForgedPredecessor() public {
        vm.expectRevert(TacitPay8244.InvalidData.selector);
        new TacitPay8244(steward, address(page), chunks, pageHash);
    }

    function testStewardshipMovesInTwoSteps() public {
        vm.prank(steward);
        page.transferStewardship(heir);
        assertEq(page.steward(), steward);
        assertEq(page.pendingSteward(), heir);

        vm.expectRevert(TacitPay8244.NotPendingSteward.selector);
        page.acceptStewardship();

        vm.prank(heir);
        page.acceptStewardship();
        assertEq(page.steward(), heir);
        assertEq(page.pendingSteward(), address(0));
    }

    function testRenouncingClearsAStandingOffer() public {
        vm.prank(steward);
        page.transferStewardship(heir);
        vm.prank(steward);
        page.renounceStewardship();
        assertEq(page.steward(), address(0));
        assertEq(page.pendingSteward(), address(0));

        vm.prank(heir);
        vm.expectRevert(TacitPay8244.NotPendingSteward.selector);
        page.acceptStewardship();
    }

    function testOnlyStewardAppends() public {
        vm.expectRevert(TacitPay8244.NotSteward.selector);
        page.deployNext(hex"00", bytes32(0));
    }

    /// @dev The successor serves its own chunks; the predecessor keeps serving
    ///      its own. The pointer says where the newer build is, it does not
    ///      change what this address returns.
    function testSuccessorIsAppendedOnce() public {
        bytes memory initcode = abi.encodePacked(
            type(TacitPay8244).creationCode, abi.encode(steward, address(page), chunks, pageHash)
        );
        vm.prank(steward);
        address next = page.deployNext(initcode, bytes32(uint256(1)));

        assertEq(page.successor(), next);
        assertEq(page.succeededAt(), block.timestamp);
        assertEq(page.latest(), next);
        assertEq(page.generation(), 1);
        assertEq(TacitPay8244(next).generation(), 2);
        assertEq(TacitPay8244(next).PREVIOUS(), address(page));
        assertEq(keccak256(bytes(page.html())), pageHash);

        vm.prank(steward);
        vm.expectRevert(TacitPay8244.AlreadySucceeded.selector);
        page.deployNext(initcode, bytes32(uint256(2)));
    }

    /// @dev CREATE2 from the predecessor is what makes the backward pointer
    ///      unforgeable, so anything that is not one of these must not be
    ///      accepted as a successor.
    function testRejectsANonSuccessor() public {
        vm.prank(steward);
        vm.expectRevert(TacitPay8244.NotASuccessor.selector);
        // Deploys a contract with no PREVIOUS(): STOP as the whole runtime.
        page.deployNext(hex"600180600a5f395ff300", bytes32(uint256(3)));
    }

    /// @dev A successor that is pre-offered the steward role could append a second successor from its own constructor;
    ///      only one successor is ever recorded.
    function testASuccessorCannotAppendAnotherFromItsConstructor() public {
        bytes memory inner = abi.encodePacked(type(MinimalSuccessor).creationCode, abi.encode(address(page)));
        bytes memory outer = abi.encodePacked(type(ReentrantSuccessor).creationCode, abi.encode(address(page), inner, bytes32(uint256(2))));
        address outerAddr = vm.computeCreate2Address(bytes32(uint256(1)), keccak256(outer), address(page));
        vm.prank(steward);
        page.transferStewardship(outerAddr);
        vm.prank(steward);
        vm.expectRevert(TacitPay8244.AlreadySucceeded.selector);
        page.deployNext(outer, bytes32(uint256(1)));
        assertEq(page.successor(), address(0));
    }

    /// @dev A name can be pointed at a successor, so the page is not cached for a year.
    function testTheCacheHintIsShort() public view {
        (uint16 status, , TacitPay8244.KeyValue[] memory headers) = page.request(new string[](0), new TacitPay8244.KeyValue[](0));
        assertEq(status, 200);
        assertEq(headers[1].key, "Cache-Control");
        assertEq(headers[1].value, "public, max-age=300");
    }

    function _deploy(bytes memory initcode) private returns (address a) {
        assembly ("memory-safe") {
            a := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(a != address(0), "deploy failed");
    }
}
