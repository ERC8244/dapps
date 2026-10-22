// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title anon.wei: tacit pay (onchain page)
/// @notice A permanently-deployed onchain HTML front end for private ETH payments on Ethereum, Base and Robinhood
///         Chain: shield ETH from any wallet into a private balance (your own, or anyone's from their address
///         alone), pay privately, withdraw any part, and take a payment by link. Every proof is made in the
///         reader's browser; every balance is rebuilt from the reader's key and the chain. Published as
///         anon.wei.
/// @dev Architecture, following Fwa8244: the HTML payload is the runtime bytecode of a list of data contracts,
///      deployed separately and passed to the constructor. `html()` reassembles them with EXTCODECOPY and proper
///      ABI encoding, so any RPC client decodes it directly. `request()` implements ERC-5219 for web3:// gateways
///      (ERC-4804), and `html()` alone is enough for an ERC-8244 gateway.
///
///      EACH CHUNK'S FIRST BYTE IS STOP, so calling a chunk does nothing; it is not part of the page and reassembly
///      skips it. What a chunk holds is pinned by the page hash below, and a third party can check each chunk's
///      codehash against `00 || the page's slice`.
///
///      THE PAGE IS COMMITTED TO AT CONSTRUCTION. `pageHash` is checked against the document the chunks actually
///      reassemble to, in the same transaction that stores them. A chunk in the wrong order, a chunk missing from
///      the end, or a chunk from a different build produces a different document and reverts here. Duplicates are
///      rejected separately, because two identical chunks are always a mistake in the deploy script.
///
/// WHAT THE PAGE TALKS TO
///   The shielded pool, its router, its Groth16 verifier and its zap, deployed at the same addresses on all three
///   chains (the constants below), by `eth_call`, `eth_getLogs` and transactions the reader's own wallet signs. To
///   shield or withdraw as a token it also uses zRouter (the swap aggregator) with routes found by its onchain
///   quoter zQuoter, the token list at token.list.wei, and Permit2, all read and called at their public addresses.
///   Chain state comes from public nodes the reader can replace, or from the reader's wallet.
///
///   A relay per chain sends spends for a fee, so the spender's account never appears on chain, and serves an
///   index of pool events that makes the first read fast. The page never needs it: every spend can be sent from
///   the reader's wallet instead, and the index is checked against the pool (a page of it counts only when the
///   tree it builds is one the pool has held) before the chain logs fill in the rest.
///
///   The proving key of the pool's circuit (28.5 MB, from a 176-contribution ceremony sealed by a Bitcoin block)
///   and the circuit's witness program (4.9 MB) are too large to store here. The page fetches them once from
///   whichever mirror answers (tacit.finance, then IPFS gateways, then a copy stored as contract code on Base
///   Sepolia), accepts them only if their SHA-256 equals the pins below, and keeps them in the browser. A reader can
///   also load the two files from disk.
///
/// WHAT THE PAGE DOES NOT DO
///   It never sends a key anywhere: the Tacit key is derived in the tab from the wallet's signature over a fixed
///   message (the same in every Tacit app) and is never stored. It fetches no code: the prover, its field
///   arithmetic (WebAssembly the page writes itself), Poseidon (constants derived in the page), the curves and
///   the hashes are all in the document. A proof the wallet sends is checked against the pool's verifier through the wallet's node first;
///   one the relay sends is checked by the relay.
///
/// HOW TO READ THE DAPP
///   cast call <addr> "html()(string)" --rpc-url <rpc> \
///     | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")))' > tacit-pay.html
///   # then open tacit-pay.html in any browser (cast prints the string JSON-quoted; the one-liner unquotes it)
///
/// HOW TO BROWSE THE DAPP
///   - ERC-8244: https://<addr>.w4eth.io/     (resolves any contract with html())
///   - ERC-4804: https://<addr>.1.w3link.io/  (via the ERC-5219 request() below)
///   - Or a browser with web3:// protocol support.
contract TacitPay8244 {
    string public constant NAME = "anon.wei";
    string public constant VERSION = "2";

    /// @notice The shielded ETH pool the page pays through, the same address on Ethereum, Base and Robinhood Chain.
    address public constant POOL = 0x000000c2A20657CE25f2Ba99737933D031AFBEE9;

    /// @notice The pool's router: deposit addresses that anyone can pay and anyone can sweep into the pool.
    address public constant ROUTER = 0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5;

    /// @notice The pool's Groth16 verifier, which the page checks each proof against before the wallet sends it (a relayed proof is checked by the relay).
    address public constant VERIFIER = 0x000000b1c0e84CEc8AdF8278B90c4d6400DfB153;

    /// @notice The zap that shields a token in one transaction: it takes the token from the caller, swaps it through
    ///         zRouter for exactly the deposit's ETH and deposits it with the caller's proof. Same address on all three
    ///         chains.
    address public constant ZAP = 0x0000008EbBF2323f95c4fBc18254f3D65C53998c;

    /// @notice SHA-256 of transact_final.zkey, the proving key the page will use.
    bytes32 public constant PROVING_KEY_SHA256 = 0x40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b;

    /// @notice SHA-256 of transact.wasm, the circuit's witness program the page will run.
    bytes32 public constant WITNESS_PROGRAM_SHA256 = 0x02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1;

    /// @notice keccak256 of the page, committed to at construction.
    bytes32 public immutable PAGE_HASH;

    /// @notice The page's byte length, summed from the chunks at construction.
    /// @dev Held so `html()` allocates once instead of measuring first.
    uint256 public immutable PAGE_LENGTH;

    /// @dev The ordered chunk addresses. Written once, in the constructor.
    address[] private _chunks;

    /// @dev A missing, reordered or duplicated chunk would permanently serve broken HTML.
    error InvalidData();

    /// @dev The chunks do not reassemble to the document being committed to.
    error PageHashMismatch(bytes32 expected, bytes32 actual);

    struct KeyValue {
        string key;
        string value;
    }

    // --------------------------------------------------------------- LINEAGE
    //
    // `html()` is immutable and stays that way. The successor below is a CLAIM ABOUT LINEAGE, never a redirect:
    // this contract serves its own chunks forever, whatever is deployed later. A client wanting the newest build
    // walks `successor` until it reaches zero; a client wanting the bytes it audited stops where it is.

    /// @notice The account permitted to deploy this version's successor.
    /// @dev Not immutable: a steward is a person or a multisig, and both change. `PREVIOUS` and `successor` are
    ///      write-once and checked before they are set, so the chain a reader walks cannot be restated by a
    ///      steward, new or old. This variable decides only who may append.
    address public steward;

    /// @notice The account that has been offered the role, until it accepts.
    address public pendingSteward;

    /// @notice The version that deployed this one; zero for the first.
    address public immutable PREVIOUS;

    /// @notice The next version, once the steward has deployed it. Write-once.
    address public successor;

    /// @notice When `successor` was set, as a unix timestamp; zero until then.
    uint96 public succeededAt;

    error NotSteward();
    error NotPendingSteward();
    error AlreadySucceeded();
    error DeployFailed();
    error NotASuccessor();

    /// @notice Emitted once per version, by the version that created it.
    event Succeeded(address indexed successor, uint256 indexed generation);

    /// @notice Emitted when a transfer is offered, and when it is withdrawn by offering it to the zero address.
    event StewardshipOffered(address indexed from, address indexed to);

    /// @notice Emitted when the role actually moves, including on renouncing.
    event StewardshipTransferred(address indexed from, address indexed to);

    /// @param initialSteward Account permitted to deploy the successor; zero freezes the lineage at this version.
    /// @param previous       The version deploying this one; zero for the first.
    /// @param chunks         Ordered STOP-prefixed data contracts holding the page.
    /// @param pageHash       keccak256 of the document they must reassemble to.
    /// @dev Any non-zero `previous` must equal `msg.sender`, and a successor is only ever created by `deployNext`,
    ///      so the deployer is the predecessor at construction time.
    constructor(address initialSteward, address previous, address[] memory chunks, bytes32 pageHash) {
        if (previous != address(0) && msg.sender != previous) revert InvalidData();
        steward = initialSteward;
        PREVIOUS = previous;

        uint256 n = chunks.length;
        if (n == 0) revert InvalidData();

        uint256 total;
        for (uint256 i; i != n; ++i) {
            // One byte is the STOP prefix, so a chunk holding nothing but its prefix carries no page.
            uint256 size = chunks[i].code.length;
            if (size < 2) revert InvalidData();
            for (uint256 j = i + 1; j != n; ++j) {
                if (chunks[i] == chunks[j]) revert InvalidData();
            }
            total += size - 1;
        }

        bytes32 actual = keccak256(bytes(_assemble(chunks, total)));
        if (actual != pageHash) revert PageHashMismatch(pageHash, actual);

        _chunks = chunks;
        PAGE_HASH = pageHash;
        PAGE_LENGTH = total;
        emit StewardshipTransferred(address(0), initialSteward);
    }

    /// @notice Offer the steward role to `to`; it moves when `to` accepts. Offering the zero address withdraws a
    ///         standing offer; it does not renounce.
    function transferStewardship(address to) external {
        address cur = steward;
        if (msg.sender != cur || cur == address(0)) revert NotSteward();
        pendingSteward = to;
        emit StewardshipOffered(cur, to);
    }

    /// @notice Accept an offered steward role.
    function acceptStewardship() external {
        address to = pendingSteward;
        if (msg.sender != to || to == address(0)) revert NotPendingSteward();
        address from = steward;
        steward = to;
        pendingSteward = address(0);
        emit StewardshipTransferred(from, to);
    }

    /// @notice Give up the role, freezing the lineage at whatever this version has already appended. Irreversible.
    function renounceStewardship() external {
        address cur = steward;
        if (msg.sender != cur || cur == address(0)) revert NotSteward();
        steward = address(0);
        pendingSteward = address(0);
        emit StewardshipTransferred(cur, address(0));
    }

    /// @notice Deploy the next version, at an address known before it exists.
    /// @dev CREATE2 from this contract, so the successor's constructor sees `msg.sender == address(this)` and its
    ///      `previous` check passes only for the real predecessor.
    /// @param initcode Creation code for the successor, constructor args appended; its `previous` is this address.
    /// @param salt     CREATE2 salt, so the address is checkable beforehand.
    function deployNext(bytes calldata initcode, bytes32 salt) external returns (address next) {
        if (msg.sender != steward || steward == address(0)) revert NotSteward();
        if (successor != address(0)) revert AlreadySucceeded();
        assembly ("memory-safe") {
            let p := mload(0x40)
            calldatacopy(p, initcode.offset, initcode.length)
            next := create2(0, p, initcode.length, salt)
        }
        if (next == address(0)) revert DeployFailed();
        // Something that is not one of these naming this contract as its predecessor is refused; `staticcall` so
        // a missing function is a revert here and not a decode panic.
        (bool ok, bytes memory ret) = next.staticcall(abi.encodeWithSelector(bytes4(keccak256("PREVIOUS()"))));
        if (!ok || ret.length != 32 || abi.decode(ret, (address)) != address(this)) revert NotASuccessor();
        // `latest()` walks by calling `successor()` on each link, so a successor must answer it, with zero.
        (ok, ret) = next.staticcall(abi.encodeWithSelector(bytes4(keccak256("successor()"))));
        if (!ok || ret.length != 32 || abi.decode(ret, (address)) != address(0)) revert NotASuccessor();
        // The successor's constructor ran code of its own, which could have appended another: only one is ever recorded.
        if (successor != address(0)) revert AlreadySucceeded();
        successor = next;
        succeededAt = uint96(block.timestamp);
        emit Succeeded(next, generation() + 1);
    }

    /// @notice How many versions deep this one is; the first is 1. Bounded, so a long chain underestimates.
    function generation() public view returns (uint256 n) {
        address cur = address(this);
        for (n = 1; n != 33; ++n) {
            address prev = TacitPay8244(cur).PREVIOUS();
            if (prev == address(0)) return n;
            cur = prev;
        }
    }

    /// @notice The newest version reachable from here, walking `successor`; this contract when none follows it.
    function latest() external view returns (address tip) {
        tip = address(this);
        for (uint256 i; i != 32; ++i) {
            address next = TacitPay8244(tip).successor();
            if (next == address(0)) return tip;
            tip = next;
        }
    }

    /// @notice How many data contracts the page is stored in.
    function chunkCount() external view returns (uint256) {
        return _chunks.length;
    }

    /// @notice One data contract from the ordered chunk list.
    function chunkAt(uint256 index) external view returns (address) {
        return _chunks[index];
    }

    /// @notice The page, as one string. This is the ERC-8244 entry point.
    function html() external view returns (string memory) {
        return _assemble(_chunks, PAGE_LENGTH);
    }

    /// @notice ERC-5219 request handler. Any path returns the page with `Content-Type: text/html` and a short cache
    ///         hint: this contract's page never changes, but a name that points at it can be pointed at a successor,
    ///         and a year-long hint would keep showing the old page. Path and query are ignored; the page reads what
    ///         to show (a payment link, a tab, a chain) from the URL fragment, which a gateway never sees.
    function request(string[] memory, /*resource*/ KeyValue[] memory /*params*/ )
        external
        view
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers)
    {
        statusCode = 200;
        body = _assemble(_chunks, PAGE_LENGTH);
        headers = new KeyValue[](2);
        headers[0] = KeyValue("Content-Type", "text/html");
        headers[1] = KeyValue("Cache-Control", "public, max-age=300");
    }

    /// @notice ERC-4804/5219 resolution mode: gateways call request() rather than auto-mode dispatch.
    function resolveMode() external pure returns (bytes32) {
        return "5219";
    }

    /// @dev Reassembles the page in one pass, each chunk copied directly after the previous one at the string
    ///      body, starting at offset one because byte zero of every chunk is the STOP prefix.
    function _assemble(address[] memory chunks, uint256 total) private view returns (string memory s) {
        assembly ("memory-safe") {
            s := mload(0x40)
            mstore(s, total)
            let at := add(s, 0x20)
            let n := mload(chunks)
            let item := add(chunks, 0x20)
            for { let i := 0 } lt(i, n) { i := add(i, 1) } {
                let a := mload(add(item, shl(5, i)))
                let size := sub(extcodesize(a), 1)
                extcodecopy(a, at, 1, size)
                at := add(at, size)
            }
            mstore(0x40, add(add(s, 0x20), and(add(total, 0x1f), not(0x1f))))
        }
    }
}
