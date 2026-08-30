// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title fwa.wei (onchain page)
/// @notice A permanently-deployed onchain HTML front end for the Fake World
///         Assets community hub. The hosted site is four documents pinned on
///         IPFS behind the ENS name fwa.eth; this is the same application as
///         one file in contract bytecode, so it survives the pin, the gateway
///         and the name.
///
///         IT IS PUBLISHED AS fwa.wei, NOT fwa.eth, and every occurrence of the
///         name in the page was rewritten to match. A page that calls itself by
///         a name it is not served under sends its own readers somewhere else,
///         and the two names do not resolve to the same thing.
/// @dev Architecture, following Poidh8244 and UniverseVersionV2: the HTML
///      payload is the runtime bytecode of a list of data contracts, deployed
///      separately and passed to the constructor. `html()` reassembles them
///      with EXTCODECOPY and proper ABI encoding, so any RPC client decodes it
///      directly. `request()` implements ERC-5219 for web3:// gateways
///      (ERC-4804), and `html()` alone is enough for an ERC-8244 gateway.
///
///      THE CHUNK LIST IS A DYNAMIC ARRAY, not a fixed set of immutable slots.
///      Poidh8244 took `address[5]` and then `address[16]`, which made the
///      constructor's arity rather than EIP-170 the thing that capped the page,
///      and the first of those ceilings was reached with 24 bytes to spare.
///      Storage costs an SLOAD per chunk on a call nobody pays gas for, and in
///      exchange the page can grow without editing this file.
///
///      EACH CHUNK'S FIRST BYTE IS STOP, so a chunk address can never be
///      mistaken for a callable contract; it is not part of the page and
///      reassembly skips it.
///
///      THE PAGE IS COMMITTED TO AT CONSTRUCTION. `pageHash` is checked against
///      the document the chunks actually reassemble to, in the same transaction
///      that stores them. A chunk in the wrong order, a chunk missing from the
///      end, or a chunk that belongs to a different build all produce a
///      different document and revert here — rather than deploying happily and
///      serving a page with a hole in it that no reader could tell from a whole
///      one. Duplicates are rejected separately, because two identical chunks
///      are always a mistake in the deploy script and not a page.
///
/// WHAT THE PAGE TALKS TO
///   The verified FWA core contract, the FWA token's buyback pipeline and the
///   separate retroactive buyback contract, by `eth_call` and `eth_getLogs`
///   against public Ethereum nodes the reader can override with `?rpc=`. There
///   is no backend, no API key and no indexer in the read path: the current
///   king, the mainchain impact metrics and the buyback feed are all derived
///   in the reader's own browser from public chain data, which is what makes
///   the view possible from a page that can never be updated.
///
///   The king's picture is the one thing that is not on chain. It is resolved
///   from the collection's own `tokenURI`, through whichever IPFS or Arweave
///   gateway answers first, and only for the single token currently on top.
///
/// WHAT THE PAGE DOES NOT DO
///   It sends no transaction and asks for no wallet. Every protocol action
///   lives on the official application, which the page links out to. This is
///   an information hub, and making it one that cannot be taken down is the
///   whole point of putting it here.
///
/// FOUR DOCUMENTS, ONE FILE
///   The hosted site is index.html, impact.html, buybacks.html and fwair.html,
///   which link to each other by filename. A gateway serves this contract's
///   single document from every path and never sees a fragment, so the four
///   became four routes selected by the URL fragment — `#/impact`,
///   `#/buybacks`, `#/fwair`, and `#/home` for the hub — with a same-page
///   anchor written after the route, as `#/home/collections`. Each route runs
///   its own page's script the first time it is shown, so opening the hub does
///   not start three sets of chain queries.
///
/// HOW TO READ THE DAPP
///   cast call <addr> "html()(string)" --rpc-url <rpc> > fwa.html
///   # then open fwa.html in any browser
///
/// HOW TO BROWSE THE DAPP
///   - ERC-8244: https://<addr>.w4eth.io/     (resolves any contract with html())
///   - ERC-4804: https://<addr>.1.w3link.io/  (via the ERC-5219 request() below)
///   - Or a browser with web3:// protocol support.
contract Fwa8244 {
    string public constant NAME = "fwa.wei";
    string public constant VERSION = "0.1";

    /// @notice The verified FWA core contract. Every number on the hub and on
    ///         the impact page is read from this address or from its logs.
    address public constant FWA = 0xB276F62DB0ce8CA2Ca5bc522695bE604521eAc1c;

    /// @notice The FWA token the protocol buys back.
    address public constant FWA_TOKEN = 0xa0Df17B5aC76ABaBA36E1450E2cbCd18A620C845;

    /// @notice The separate TokenWorks retroactive buyback contract, tracked
    ///         alongside the protocol pipeline on the buybacks route.
    address public constant RETRO_BUYBACK = 0xabc98D86eA62919399c4211251890308Ce37A6BF;

    /// @notice keccak256 of the page, committed to at construction.
    bytes32 public immutable PAGE_HASH;

    /// @notice The page's byte length, summed from the chunks at construction.
    /// @dev Held so `html()` allocates once instead of measuring first.
    uint256 public immutable PAGE_LENGTH;

    /// @dev The ordered chunk addresses. Written once, in the constructor.
    address[] private _chunks;

    /// @dev A missing, reordered or duplicated chunk would permanently serve
    ///      broken HTML.
    error InvalidData();

    /// @dev The chunks do not reassemble to the document being committed to.
    error PageHashMismatch(bytes32 expected, bytes32 actual);

    struct KeyValue {
        string key;
        string value;
    }

    // --------------------------------------------------------------- LINEAGE
    //
    // `html()` is immutable and stays that way. The successor below is a CLAIM
    // ABOUT LINEAGE, never a redirect: this contract serves its own chunks
    // forever, whatever is deployed later. Making `html()` forward to a
    // successor would have been the smaller change and it would have cost the
    // one property this design exists for — an address whose bytes cannot move
    // under an auditor, a bookmark, or a gateway cache that was told the answer
    // is immutable.
    //
    // A client wanting the newest build walks `successor` until it reaches
    // zero. A client wanting the bytes it audited stops where it is.

    /// @notice The account permitted to deploy this version's successor.
    /// @dev NOT immutable. A steward is a person or a multisig, and both of
    ///      those change, while the lineage is meant to outlive all of it.
    ///      What is not relaxed is anything a reader depends on: `PREVIOUS` and
    ///      `successor` are still write-once and still checked before they are
    ///      set, so the chain a reader walks cannot be restated by a steward,
    ///      new or old. This variable decides only WHO MAY APPEND.
    address public steward;

    /// @notice The account that has been offered the role, until it accepts.
    /// @dev Two steps, not one. A single-call transfer to a mistyped address
    ///      ends the lineage as surely as renouncing it, silently and with no
    ///      way back; requiring the recipient to answer proves the key exists
    ///      before the role moves. The deliberate ending has its own function.
    address public pendingSteward;

    /// @notice The version that deployed this one; zero for the first.
    address public immutable PREVIOUS;

    /// @notice The next version, once the steward has deployed it. Write-once:
    ///         a rewritable pointer is not lineage, it is a mutable redirect
    ///         wearing lineage's clothes.
    address public successor;

    /// @notice When `successor` was set, as a unix timestamp; zero until then.
    /// @dev THE ONE FACT ONLY THE CHAIN KNOWS. A reader following this pointer
    ///      cannot tell from the pointer alone whether it appeared a year ago
    ///      or in the block they are reading. With a clock they can require a
    ///      version to have stood unchallenged for a while, and it cannot be
    ///      backdated. `uint96` shares the slot, so it costs one `sstore`
    ///      either way.
    uint96 public succeededAt;

    error NotSteward();
    error NotPendingSteward();
    error AlreadySucceeded();
    error DeployFailed();
    error NotASuccessor();

    /// @notice Emitted once per version, by the version that created it.
    event Succeeded(address indexed successor, uint256 indexed generation);

    /// @notice Emitted when a transfer is offered, and when it is withdrawn
    ///         by offering it to the zero address.
    event StewardshipOffered(address indexed from, address indexed to);

    /// @notice Emitted when the role actually moves, including on renouncing.
    event StewardshipTransferred(address indexed from, address indexed to);

    /// @param initialSteward Account permitted to deploy the successor; zero
    ///                       freezes the lineage at this version from birth.
    /// @param previous       The version deploying this one; zero for the first.
    /// @param chunks         Ordered STOP-prefixed data contracts holding the page.
    /// @param pageHash       keccak256 of the document they must reassemble to.
    /// @dev `previous` cannot be misstated: any non-zero value must equal
    ///      `msg.sender`, and a successor is only ever created by `deployNext`,
    ///      so the deployer IS the predecessor at construction time. No version
    ///      NUMBER is stored — it is derived by walking, so there is no counter
    ///      to pass in wrongly, skip, or repeat. The chain is the record.
    constructor(address initialSteward, address previous, address[] memory chunks, bytes32 pageHash) {
        if (previous != address(0) && msg.sender != previous) revert InvalidData();
        steward = initialSteward;
        PREVIOUS = previous;

        uint256 n = chunks.length;
        // A page made of no chunks is not a page.
        if (n == 0) revert InvalidData();

        uint256 total;
        for (uint256 i; i != n; ++i) {
            // One byte is the STOP prefix, so a chunk that holds nothing but
            // its prefix carries no page and is a deploy that went wrong.
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

    /// @notice Offer the steward role to `to`; it moves when `to` accepts.
    /// @dev Offering the zero address withdraws a standing offer. It does NOT
    ///      renounce: giving up the role is a different intent and has its own
    ///      function, so neither can be reached by getting this one wrong.
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

    /// @notice Give up the role, freezing the lineage at whatever this version
    ///         has already appended. Irreversible: there is no way to name a
    ///         steward once there is none.
    /// @dev A standing offer is cleared in the same call, so an offer made
    ///      before the decision cannot be accepted after it.
    function renounceStewardship() external {
        address cur = steward;
        if (msg.sender != cur || cur == address(0)) revert NotSteward();
        steward = address(0);
        pendingSteward = address(0);
        emit StewardshipTransferred(cur, address(0));
    }

    /// @notice Deploy the next version, at an address known before it exists.
    /// @dev CREATE2 from THIS contract, so the successor's constructor sees
    ///      `msg.sender == address(this)` and its `previous` check passes only
    ///      for the real predecessor. That is what makes the backward pointer
    ///      unforgeable rather than merely recorded: nothing outside this
    ///      function can produce a contract naming this one as its parent.
    /// @param initcode Creation code for the successor, constructor args
    ///                 appended. Its `previous` argument must be this address.
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
        // Codeless deploy, or something that is not one of these naming this
        // contract as its predecessor. `staticcall` rather than the typed call
        // so a missing function is a revert here and not a decode panic: an
        // address with no code answers successfully with empty returndata.
        (bool ok, bytes memory ret) =
            next.staticcall(abi.encodeWithSelector(bytes4(keccak256("PREVIOUS()"))));
        if (!ok || ret.length != 32 || abi.decode(ret, (address)) != address(this)) {
            revert NotASuccessor();
        }
        // THE FORWARD HALF OF THE SAME CHECK. `latest()` walks by calling
        // `successor()` on each link, so a successor that does not answer it
        // breaks the walk for THIS contract and every predecessor. It must also
        // be zero: a version born already succeeded is not a new tip, and the
        // walk would step straight past it.
        (ok, ret) = next.staticcall(abi.encodeWithSelector(bytes4(keccak256("successor()"))));
        if (!ok || ret.length != 32 || abi.decode(ret, (address)) != address(0)) {
            revert NotASuccessor();
        }
        successor = next;
        succeededAt = uint96(block.timestamp);
        emit Succeeded(next, generation() + 1);
    }

    /// @notice How many versions deep this one is; the first is 1.
    /// @dev Derived by walking backwards rather than stored, so there is no
    ///      counter to pass in wrongly, skip, or repeat. Bounded, so a long
    ///      chain degrades to an underestimate instead of running out of gas.
    function generation() public view returns (uint256 n) {
        address cur = address(this);
        for (n = 1; n != 33; ++n) {
            address prev = Fwa8244(cur).PREVIOUS();
            if (prev == address(0)) return n;
            cur = prev;
        }
    }

    /// @notice The newest version reachable from here, walking `successor`.
    /// @dev Returns this contract when nothing has succeeded it, so a caller
    ///      never has to special-case the tip.
    function latest() external view returns (address tip) {
        tip = address(this);
        for (uint256 i; i != 32; ++i) {
            address next = Fwa8244(tip).successor();
            if (next == address(0)) return tip;
            tip = next;
        }
    }

    /// @notice How many data contracts the page is stored in.
    function chunkCount() external view returns (uint256) {
        return _chunks.length;
    }

    /// @notice One data contract from the ordered chunk list.
    /// @dev Chunk-level access lets a verifier check the page against the
    ///      runtime code at each address without pulling the whole document
    ///      through a single `eth_call`.
    function chunkAt(uint256 index) external view returns (address) {
        return _chunks[index];
    }

    /// @notice The page, as one string. This is the ERC-8244 entry point.
    function html() external view returns (string memory) {
        return _assemble(_chunks, PAGE_LENGTH);
    }

    /// @notice ERC-5219 request handler. Any path returns the page with
    ///         `Content-Type: text/html` and a permanent cache hint: the
    ///         response is byte-identical forever, since the bytecode is
    ///         immutable. Path and query are ignored — the dapp is a
    ///         single-page app served from every URL on this contract, and it
    ///         reads which of its four routes to show from the URL fragment,
    ///         which a gateway never sees.
    function request(string[] memory, /*resource*/ KeyValue[] memory /*params*/ )
        external
        view
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers)
    {
        statusCode = 200;
        body = _assemble(_chunks, PAGE_LENGTH);
        headers = new KeyValue[](2);
        headers[0] = KeyValue("Content-Type", "text/html");
        headers[1] = KeyValue("Cache-Control", "public, max-age=31536000, immutable");
    }

    /// @notice ERC-4804/5219 resolution mode: gateways should call request()
    ///         rather than auto-mode URL-to-function dispatch.
    function resolveMode() external pure returns (bytes32) {
        return "5219";
    }

    /// @dev Reassembles the page in one pass: each chunk is copied directly
    ///      after the previous one at the string body, so there is no
    ///      intermediate copy and no concatenation. The cursor advances by
    ///      construction, so the eighth chunk lands after the seventh for the
    ///      same reason the second lands after the first. Copying starts at
    ///      offset one because byte zero of every chunk is the STOP prefix.
    /// @param chunks The ordered chunk addresses, already in memory.
    /// @param total  Their payload lengths summed; the document's byte length.
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
