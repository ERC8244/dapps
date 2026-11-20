// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test, Vm} from "forge-std/Test.sol";
import {TacitPayRegistry} from "../src/TacitPayRegistry.sol";

contract TacitPayRegistryTest is Test {
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event FlagsSet(uint256 previous, uint256 next);
    event Reset(bytes32 indexed service, uint256 indexed chainId, uint256 oldLength);
    event Added(bytes32 indexed service, uint256 indexed chainId, uint256 index, string url);
    event Removed(bytes32 indexed service, uint256 indexed chainId, uint256 index, string url);
    event Moved(bytes32 indexed service, uint256 indexed chainId, uint256 from, uint256 to);

    bytes32 constant RPC = "rpc";
    bytes32 constant MIRRORS = "mirrors";
    bytes32 constant WC = "wc";

    address admin = address(0xA11CE);
    address bob = address(0xB0B);
    address eve = address(0xE5E);

    TacitPayRegistry r;

    function _one(string memory a) internal pure returns (string[] memory l) {
        l = new string[](1);
        l[0] = a;
    }

    function _two(string memory a, string memory b) internal pure returns (string[] memory l) {
        l = new string[](2);
        l[0] = a;
        l[1] = b;
    }

    function _three(string memory a, string memory b, string memory c) internal pure returns (string[] memory l) {
        l = new string[](3);
        l[0] = a;
        l[1] = b;
        l[2] = c;
    }

    function _seeds() internal pure returns (TacitPayRegistry.Seed[] memory s) {
        s = new TacitPayRegistry.Seed[](3);
        s[0] = TacitPayRegistry.Seed(RPC, 1, _three("a", "b", "c"));
        s[1] = TacitPayRegistry.Seed(MIRRORS, 0, _one("m0"));
        s[2] = TacitPayRegistry.Seed(RPC, 0, _one("fallback"));
    }

    function setUp() public {
        r = new TacitPayRegistry(admin, _seeds(), 5);
    }

    function _eq(string[] memory a, string[] memory b) internal pure {
        assertEq(a.length, b.length, "length");
        for (uint256 i; i < a.length; ++i) {
            assertEq(a[i], b[i]);
        }
    }

    // ------------------------------------------------------------- selectors

    /// The page's reader is built for zEndpoints' ABI; these must not move.
    function testSelectorsMatchZEndpoints() public pure {
        assertEq(TacitPayRegistry.listsOf.selector, bytes4(0xc03c2d74));
        assertEq(TacitPayRegistry.listsOf.selector, bytes4(keccak256("listsOf(bytes32[],uint256[])")));
        assertEq(TacitPayRegistry.listOf.selector, bytes4(keccak256("listOf(bytes32,uint256)")));
        assertEq(TacitPayRegistry.listAt.selector, bytes4(0x292a5f4b));
        assertEq(TacitPayRegistry.add.selector, bytes4(0x63a418e3));
        assertEq(TacitPayRegistry.remove.selector, bytes4(0xaceba3fd));
        assertEq(TacitPayRegistry.move.selector, bytes4(0xfd530b5e));
        assertEq(TacitPayRegistry.read.selector, bytes4(keccak256("read(bytes32[],uint256[])")));
        assertEq(TacitPayRegistry.setFlags.selector, bytes4(keccak256("setFlags(uint256)")));
    }

    // ------------------------------------------------------------- constructor

    function testConstructorState() public view {
        assertEq(r.owner(), admin);
        assertEq(r.pendingOwner(), address(0));
        assertEq(r.flags(), 5);
        _eq(r.listAt(RPC, 1), _three("a", "b", "c"));
        _eq(r.listAt(MIRRORS, 0), _one("m0"));
        _eq(r.listAt(RPC, 0), _one("fallback"));
        assertTrue(r.known(RPC, 1));
        assertTrue(r.known(MIRRORS, 0));
        assertTrue(r.known(RPC, 0));
        assertFalse(r.known(WC, 0));
        (bytes32[] memory s, uint256[] memory c) = r.keys();
        assertEq(s.length, 3);
        assertEq(s[0], RPC);
        assertEq(c[0], 1);
        assertEq(s[1], MIRRORS);
        assertEq(c[1], 0);
        assertEq(s[2], RPC);
        assertEq(c[2], 0);
    }

    function testConstructorEvents() public {
        TacitPayRegistry.Seed[] memory s = new TacitPayRegistry.Seed[](2);
        s[0] = TacitPayRegistry.Seed(RPC, 1, _two("x", "y"));
        s[1] = TacitPayRegistry.Seed(WC, 0, _one("wss://w"));
        vm.expectEmit(true, true, true, true);
        emit OwnershipTransferred(address(0), bob);
        vm.expectEmit(true, true, true, true);
        emit Added(RPC, 1, 0, "x");
        vm.expectEmit(true, true, true, true);
        emit Added(RPC, 1, 1, "y");
        vm.expectEmit(true, true, true, true);
        emit Added(WC, 0, 0, "wss://w");
        vm.expectEmit(true, true, true, true);
        emit FlagsSet(0, 64);
        TacitPayRegistry q = new TacitPayRegistry(bob, s, 64);
        assertEq(q.owner(), bob);
        assertEq(q.flags(), 64);
    }

    function testConstructorEmpty() public {
        TacitPayRegistry q = new TacitPayRegistry(bob, new TacitPayRegistry.Seed[](0), 0);
        (bytes32[] memory s,) = q.keys();
        assertEq(s.length, 0);
        assertEq(q.flags(), 0);
        assertEq(q.listOf(RPC, 1).length, 0);
    }

    /// A seed with no urls writes nothing and notes no key, as in zEndpoints.
    function testConstructorEmptySeedNotesNothing() public {
        TacitPayRegistry.Seed[] memory s = new TacitPayRegistry.Seed[](1);
        s[0] = TacitPayRegistry.Seed(RPC, 1, new string[](0));
        TacitPayRegistry q = new TacitPayRegistry(bob, s, 0);
        assertFalse(q.known(RPC, 1));
    }

    // ------------------------------------------------------------- reads

    function testListOfFallback() public {
        _eq(r.listOf(RPC, 1), _three("a", "b", "c"));
        _eq(r.listOf(RPC, 8453), _one("fallback")); // no list of its own
        _eq(r.listOf(RPC, 0), _one("fallback"));
        _eq(r.listOf(MIRRORS, 1), _one("m0"));
        assertEq(r.listOf(WC, 1).length, 0); // nothing anywhere
        // An emptied chain list inherits.
        vm.prank(admin);
        r.set(RPC, 1, new string[](0));
        _eq(r.listOf(RPC, 1), _one("fallback"));
        assertEq(r.listAt(RPC, 1).length, 0);
        assertTrue(r.known(RPC, 1));
    }

    function testListsOf() public view {
        bytes32[] memory s = new bytes32[](4);
        uint256[] memory c = new uint256[](4);
        (s[0], c[0]) = (RPC, 1);
        (s[1], c[1]) = (RPC, 10);
        (s[2], c[2]) = (MIRRORS, 0);
        (s[3], c[3]) = (WC, 0);
        string[][] memory out = r.listsOf(s, c);
        assertEq(out.length, 4);
        _eq(out[0], _three("a", "b", "c"));
        _eq(out[1], _one("fallback"));
        _eq(out[2], _one("m0"));
        assertEq(out[3].length, 0);
        assertEq(r.listsOf(new bytes32[](0), new uint256[](0)).length, 0);
    }

    function testListsOfLengthMismatch() public {
        vm.expectRevert(TacitPayRegistry.LengthMismatch.selector);
        r.listsOf(new bytes32[](2), new uint256[](1));
        vm.expectRevert(TacitPayRegistry.LengthMismatch.selector);
        r.listsOf(new bytes32[](0), new uint256[](1));
    }

    function testRead() public {
        bytes32[] memory s = new bytes32[](2);
        uint256[] memory c = new uint256[](2);
        (s[0], c[0]) = (RPC, 4663);
        (s[1], c[1]) = (MIRRORS, 0);
        (uint256 f, string[][] memory out) = r.read(s, c);
        assertEq(f, 5);
        _eq(out[0], _one("fallback"));
        _eq(out[1], _one("m0"));
        // The same lists as listsOf, through the same encoding.
        assertEq(abi.encode(out), abi.encode(r.listsOf(s, c)));
        vm.prank(admin);
        r.setFlags(127);
        (f,) = r.read(new bytes32[](0), new uint256[](0));
        assertEq(f, 127);
    }

    function testReadLengthMismatch() public {
        vm.expectRevert(TacitPayRegistry.LengthMismatch.selector);
        r.read(new bytes32[](1), new uint256[](2));
    }

    function testCountGetListAt() public {
        assertEq(r.count(RPC, 1), 3);
        assertEq(r.count(RPC, 8453), 0); // no fallback
        assertEq(r.listAt(RPC, 8453).length, 0);
        assertEq(r.get(RPC, 1, 0), "a");
        assertEq(r.get(RPC, 1, 2), "c");
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.get(RPC, 1, 3);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.get(RPC, 8453, 0); // get does not fall back either
    }

    // ------------------------------------------------------------- add

    function testAdd() public {
        vm.expectEmit(true, true, true, true);
        emit Added(WC, 0, 0, "wss://relay");
        vm.prank(admin);
        r.add(WC, 0, "wss://relay");
        _eq(r.listAt(WC, 0), _one("wss://relay"));
        assertTrue(r.known(WC, 0));
        (bytes32[] memory s, uint256[] memory c) = r.keys();
        assertEq(s.length, 4);
        assertEq(s[3], WC);
        assertEq(c[3], 0);

        vm.expectEmit(true, true, true, true);
        emit Added(RPC, 1, 3, "d");
        vm.prank(admin);
        r.add(RPC, 1, "d");
        assertEq(r.get(RPC, 1, 3), "d");
        (s,) = r.keys();
        assertEq(s.length, 4); // an existing key is not noted twice
    }

    function testAddNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.add(RPC, 1, "x");
    }

    // ------------------------------------------------------------- remove

    function testRemovePreservesOrder() public {
        vm.expectEmit(true, true, true, true);
        emit Removed(RPC, 1, 0, "a");
        vm.prank(admin);
        r.remove(RPC, 1, 0);
        _eq(r.listAt(RPC, 1), _two("b", "c"));

        vm.prank(admin);
        r.add(RPC, 1, "d");
        vm.expectEmit(true, true, true, true);
        emit Removed(RPC, 1, 1, "c");
        vm.prank(admin);
        r.remove(RPC, 1, 1);
        _eq(r.listAt(RPC, 1), _two("b", "d"));

        vm.startPrank(admin);
        r.remove(RPC, 1, 1);
        r.remove(RPC, 1, 0);
        vm.stopPrank();
        assertEq(r.count(RPC, 1), 0);
        _eq(r.listOf(RPC, 1), _one("fallback"));
    }

    function testRemoveBadIndex() public {
        vm.startPrank(admin);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.remove(RPC, 1, 3);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.remove(WC, 0, 0);
        vm.stopPrank();
    }

    function testRemoveNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.remove(RPC, 1, 0);
    }

    // ------------------------------------------------------------- pop

    function testPop() public {
        vm.expectEmit(true, true, true, true);
        emit Removed(RPC, 1, 2, "c");
        vm.prank(admin);
        r.pop(RPC, 1);
        _eq(r.listAt(RPC, 1), _two("a", "b"));
        vm.startPrank(admin);
        r.pop(MIRRORS, 0);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.pop(MIRRORS, 0);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.pop(WC, 0);
        vm.stopPrank();
    }

    function testPopNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.pop(RPC, 1);
    }

    // ------------------------------------------------------------- move

    function testMoveDown() public {
        vm.expectEmit(true, true, true, true);
        emit Moved(RPC, 1, 0, 2);
        vm.prank(admin);
        r.move(RPC, 1, 0, 2);
        _eq(r.listAt(RPC, 1), _three("b", "c", "a"));
    }

    function testMoveUp() public {
        vm.expectEmit(true, true, true, true);
        emit Moved(RPC, 1, 2, 0);
        vm.prank(admin);
        r.move(RPC, 1, 2, 0);
        _eq(r.listAt(RPC, 1), _three("c", "a", "b"));
        vm.prank(admin);
        r.move(RPC, 1, 1, 2);
        _eq(r.listAt(RPC, 1), _three("c", "b", "a"));
    }

    function testMoveSamePositionIsSilent() public {
        vm.recordLogs();
        vm.prank(admin);
        r.move(RPC, 1, 1, 1);
        assertEq(vm.getRecordedLogs().length, 0);
        _eq(r.listAt(RPC, 1), _three("a", "b", "c"));
    }

    function testMoveBadIndex() public {
        vm.startPrank(admin);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.move(RPC, 1, 3, 0);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.move(RPC, 1, 0, 3);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.move(RPC, 1, 3, 3);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.move(WC, 0, 0, 0);
        vm.stopPrank();
    }

    function testMoveNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.move(RPC, 1, 0, 1);
    }

    // ------------------------------------------------------------- setAt

    function testSetAt() public {
        vm.expectEmit(true, true, true, true);
        emit Removed(RPC, 1, 1, "b");
        vm.expectEmit(true, true, true, true);
        emit Added(RPC, 1, 1, "B");
        vm.prank(admin);
        r.setAt(RPC, 1, 1, "B");
        _eq(r.listAt(RPC, 1), _three("a", "B", "c"));
    }

    function testSetAtBadIndex() public {
        vm.startPrank(admin);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.setAt(RPC, 1, 3, "x");
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.setAt(WC, 0, 0, "x");
        vm.stopPrank();
    }

    function testSetAtNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.setAt(RPC, 1, 0, "x");
    }

    // ------------------------------------------------------------- set

    function testSetEmitsResetBeforeReplacement() public {
        vm.expectEmit(true, true, true, true);
        emit Reset(RPC, 1, 3);
        vm.expectEmit(true, true, true, true);
        emit Added(RPC, 1, 0, "x");
        vm.expectEmit(true, true, true, true);
        emit Added(RPC, 1, 1, "y");
        vm.prank(admin);
        r.set(RPC, 1, _two("x", "y"));
        _eq(r.listAt(RPC, 1), _two("x", "y"));

        // The exact log order: Reset first, then the Added events, nothing else.
        vm.recordLogs();
        vm.prank(admin);
        r.set(RPC, 1, _one("z"));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        assertEq(logs[0].topics[0], Reset.selector);
        assertEq(abi.decode(logs[0].data, (uint256)), 2);
        assertEq(logs[1].topics[0], Added.selector);
        _eq(r.listAt(RPC, 1), _one("z"));
    }

    function testSetEmptyClearsAndNotesNewKey() public {
        vm.expectEmit(true, true, true, true);
        emit Reset(WC, 7, 0);
        vm.prank(admin);
        r.set(WC, 7, new string[](0));
        assertTrue(r.known(WC, 7)); // set notes the key even when empty
        assertEq(r.count(WC, 7), 0);
        (bytes32[] memory s, uint256[] memory c) = r.keys();
        assertEq(s[s.length - 1], WC);
        assertEq(c[c.length - 1], 7);

        vm.prank(admin);
        r.set(MIRRORS, 0, new string[](0));
        assertEq(r.listOf(MIRRORS, 0).length, 0);
        (s,) = r.keys();
        assertEq(s.length, 4); // MIRRORS was already known
    }

    function testSetNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.set(RPC, 1, new string[](0));
    }

    // ------------------------------------------------------------- flags

    function testSetFlags() public {
        vm.expectEmit(true, true, true, true);
        emit FlagsSet(5, 1 << 6);
        vm.prank(admin);
        r.setFlags(1 << 6);
        assertEq(r.flags(), 1 << 6);
        vm.expectEmit(true, true, true, true);
        emit FlagsSet(1 << 6, type(uint256).max);
        vm.prank(admin);
        r.setFlags(type(uint256).max);
        assertEq(r.flags(), type(uint256).max);
        vm.prank(admin);
        r.setFlags(0);
        assertEq(r.flags(), 0);
    }

    function testSetFlagsNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.setFlags(1);
    }

    function testFuzzSetFlags(uint256 a, uint256 b) public {
        vm.startPrank(admin);
        r.setFlags(a);
        vm.expectEmit(true, true, true, true);
        emit FlagsSet(a, b);
        r.setFlags(b);
        vm.stopPrank();
        assertEq(r.flags(), b);
    }

    // ------------------------------------------------------------- ownership

    function testOwnershipHandover() public {
        vm.expectEmit(true, true, true, true);
        emit OwnershipTransferStarted(admin, bob);
        vm.prank(admin);
        r.transferOwnership(bob);
        assertEq(r.pendingOwner(), bob);
        assertEq(r.owner(), admin); // nothing changes until accepted

        // The owner still curates while the offer is open.
        vm.prank(admin);
        r.setFlags(1);
        // The offeree cannot curate yet.
        vm.prank(bob);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.setFlags(2);
        // Nobody else can accept.
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.acceptOwnership();
        vm.prank(admin);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.acceptOwnership();

        vm.expectEmit(true, true, true, true);
        emit OwnershipTransferred(admin, bob);
        vm.prank(bob);
        r.acceptOwnership();
        assertEq(r.owner(), bob);
        assertEq(r.pendingOwner(), address(0));

        // The old owner loses every right.
        vm.startPrank(admin);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.add(RPC, 1, "x");
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.setFlags(0);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.transferOwnership(admin);
        vm.stopPrank();

        // The new one has them.
        vm.startPrank(bob);
        r.add(RPC, 1, "x");
        r.setFlags(3);
        vm.stopPrank();
        assertEq(r.flags(), 3);

        // A second accept does nothing (the offer is spent).
        vm.prank(bob);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.acceptOwnership();
    }

    function testWithdrawOffer() public {
        vm.prank(admin);
        r.transferOwnership(bob);
        vm.expectEmit(true, true, true, true);
        emit OwnershipTransferStarted(admin, address(0));
        vm.prank(admin);
        r.transferOwnership(address(0));
        assertEq(r.pendingOwner(), address(0));
        vm.prank(bob);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.acceptOwnership();
        assertEq(r.owner(), admin);
    }

    function testReOfferReplacesPending() public {
        vm.startPrank(admin);
        r.transferOwnership(bob);
        r.transferOwnership(eve);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.acceptOwnership();
        vm.prank(eve);
        r.acceptOwnership();
        assertEq(r.owner(), eve);
    }

    function testTransferOwnershipNotOwner() public {
        vm.prank(eve);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.transferOwnership(eve);
    }

    function testNoRenounce() public {
        vm.prank(admin);
        (bool ok,) = address(r).call(abi.encodeWithSignature("renounceOwnership()"));
        assertFalse(ok);
        assertEq(r.owner(), admin);
    }

    // ------------------------------------------------------------- fuzz against a reference model

    function _fill(uint256 n) internal returns (string[] memory m) {
        m = new string[](n);
        string[] memory next = new string[](n);
        for (uint256 i; i < n; ++i) {
            next[i] = vm.toString(i);
            m[i] = next[i];
        }
        vm.prank(admin);
        r.set(WC, 9, next);
    }

    function testFuzzRemove(uint8 n, uint256 i) public {
        n = uint8(bound(n, 1, 24));
        string[] memory m = _fill(n);
        i = bound(i, 0, n - 1);
        vm.prank(admin);
        r.remove(WC, 9, i);
        string[] memory want = new string[](n - 1);
        for (uint256 k; k < n - 1; ++k) {
            want[k] = m[k < i ? k : k + 1];
        }
        _eq(r.listAt(WC, 9), want);
    }

    function testFuzzMove(uint8 n, uint256 from, uint256 to) public {
        n = uint8(bound(n, 1, 24));
        string[] memory m = _fill(n);
        from = bound(from, 0, n - 1);
        to = bound(to, 0, n - 1);
        vm.prank(admin);
        r.move(WC, 9, from, to);
        // Reference: take the entry out, then insert it at `to`.
        string[] memory rest = new string[](n - 1);
        for (uint256 k; k < n - 1; ++k) {
            rest[k] = m[k < from ? k : k + 1];
        }
        string[] memory want = new string[](n);
        for (uint256 k; k < n; ++k) {
            want[k] = k < to ? rest[k] : k == to ? m[from] : rest[k - 1];
        }
        _eq(r.listAt(WC, 9), want);
    }

    function testFuzzOutOfRange(uint8 n, uint256 i) public {
        n = uint8(bound(n, 0, 8));
        _fill(n);
        i = bound(i, n, type(uint256).max);
        vm.startPrank(admin);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.remove(WC, 9, i);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.setAt(WC, 9, i, "x");
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.move(WC, 9, i, 0);
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.move(WC, 9, 0, i);
        vm.stopPrank();
        vm.expectRevert(TacitPayRegistry.BadIndex.selector);
        r.get(WC, 9, i);
    }

    function testFuzzNotOwner(address who) public {
        vm.assume(who != admin);
        vm.startPrank(who);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.add(RPC, 1, "x");
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.set(RPC, 1, new string[](0));
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.setFlags(1);
        vm.expectRevert(TacitPayRegistry.NotOwner.selector);
        r.transferOwnership(who);
        vm.stopPrank();
    }

    function testAListStopsAtItsCap() public {
        bytes32 svc = bytes32("bundler");
        for (uint256 i; i < r.MAX_LIST(); ++i) {
            vm.prank(admin);
            r.add(svc, 7, "https://x.example");
        }
        assertEq(r.count(svc, 7), r.MAX_LIST());
        vm.prank(admin);
        vm.expectRevert(TacitPayRegistry.ListFull.selector);
        r.add(svc, 7, "https://one-too-many.example");
    }
}

/// Random curation ops on two keys, mirrored in plain arrays.
contract RegistryHandler is Test {
    TacitPayRegistry public r;
    address public admin;
    bytes32[2] public svc = [bytes32("rpc"), bytes32("bundler")];
    mapping(uint256 => string[]) internal model;
    uint256 public nonce;

    constructor(TacitPayRegistry r_, address admin_) {
        r = r_;
        admin = admin_;
    }

    function modelOf(uint256 k) external view returns (string[] memory) {
        return model[k];
    }

    function add(uint256 k) external {
        k %= 2;
        string memory u = vm.toString(++nonce);
        vm.prank(admin);
        r.add(svc[k], 1, u);
        model[k].push(u);
    }

    function remove(uint256 k, uint256 i) external {
        k %= 2;
        uint256 n = model[k].length;
        if (n == 0) return;
        i %= n;
        vm.prank(admin);
        r.remove(svc[k], 1, i);
        for (uint256 j = i; j + 1 < n; ++j) {
            model[k][j] = model[k][j + 1];
        }
        model[k].pop();
    }

    function pop(uint256 k) external {
        k %= 2;
        if (model[k].length == 0) return;
        vm.prank(admin);
        r.pop(svc[k], 1);
        model[k].pop();
    }

    function move(uint256 k, uint256 from, uint256 to) external {
        k %= 2;
        uint256 n = model[k].length;
        if (n == 0) return;
        from %= n;
        to %= n;
        vm.prank(admin);
        r.move(svc[k], 1, from, to);
        string memory v = model[k][from];
        if (from < to) {
            for (uint256 j = from; j < to; ++j) model[k][j] = model[k][j + 1];
        } else {
            for (uint256 j = from; j > to; --j) model[k][j] = model[k][j - 1];
        }
        model[k][to] = v;
    }

    function setAt(uint256 k, uint256 i) external {
        k %= 2;
        uint256 n = model[k].length;
        if (n == 0) return;
        i %= n;
        string memory u = vm.toString(++nonce);
        vm.prank(admin);
        r.setAt(svc[k], 1, i, u);
        model[k][i] = u;
    }

    function set(uint256 k, uint8 n) external {
        k %= 2;
        n %= 5;
        string[] memory next = new string[](n);
        for (uint256 j; j < n; ++j) next[j] = vm.toString(++nonce);
        vm.prank(admin);
        r.set(svc[k], 1, next);
        delete model[k];
        for (uint256 j; j < n; ++j) model[k].push(next[j]);
    }
}

contract TacitPayRegistryInvariantTest is Test {
    TacitPayRegistry r;
    RegistryHandler h;

    function setUp() public {
        address admin = address(0xA11CE);
        r = new TacitPayRegistry(admin, new TacitPayRegistry.Seed[](0), 0);
        h = new RegistryHandler(r, admin);
        targetContract(address(h));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    function invariantMatchesModel() public view {
        for (uint256 k; k < 2; ++k) {
            string[] memory got = r.listAt(h.svc(k), 1);
            string[] memory want = h.modelOf(k);
            assertEq(got.length, want.length);
            assertEq(r.count(h.svc(k), 1), want.length);
            for (uint256 i; i < got.length; ++i) {
                assertEq(got[i], want[i]);
            }
        }
        // Keys are only ever the two touched, each once.
        (bytes32[] memory s, uint256[] memory c) = r.keys();
        assertLe(s.length, 2);
        assertEq(s.length, c.length);
        if (s.length == 2) assertTrue(s[0] != s[1]);
        for (uint256 i; i < s.length; ++i) {
            assertTrue(r.known(s[i], c[i]));
            assertEq(c[i], 1);
        }
    }

}
