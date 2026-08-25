// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title POIDH (onchain page)
/// @notice A permanently-deployed onchain HTML front end for the POIDH bounty
///         market at 0xE731dFadBFf20542E10D09D26Fc71445C70d4232 on Ethereum
///         mainnet, and its claim NFT at
///         0x9c5F45D5e1382e4058D334d93C6c01442012a4D9.
/// @dev Architecture, following zSwap and Firstfruits8244: the HTML payload is
///      the runtime bytecode of five data contracts, deployed separately and
///      passed to the constructor. `html()` reassembles them with EXTCODECOPY
///      and proper ABI encoding (offset + length + padded data), so any RPC
///      client decodes it directly. `request()` implements ERC-5219 for
///      web3:// gateways (ERC-4804), and `html()` alone is enough for an
///      ERC-8244 gateway.
///
///      FIVE CHUNKS, FOR A ~105 KB PAGE. EIP-170 caps each chunk at 24,576
///      bytes, not the page, so five hold 122,880. The count is fixed in the
///      constructor arity and the deployed page is immutable, so it is chosen
///      once: the page as written fills about six sevenths of them, and the rest
///      is the room it may grow into before the count - and therefore the
///      address - has to change. Every chunk must be non-empty and distinct,
///      so the count cannot be padded past what the page fills.
///
/// WHAT THE PAGE TALKS TO
///   PoidhV3, its claim NFT and Multicall3, by `eth_call` through the reader's
///   own wallet or a read node they name. There is no backend, no indexer and
///   no event log in the read path: the bounty list, each bounty's funders,
///   its claims and its ballot are all read from contract state, which is what
///   makes the view possible from a page that can never be updated.
///
///   THE HOSTED UI READS ITS LIST FROM AN API. This one does not, and two
///   getters had to be worked around to manage it. `getBounties(offset)`
///   always counts down from the newest ten, so its `offset` cannot walk
///   backwards through a longer list; the page reads `bounties(id)` by index
///   instead and pages by id. `getClaimsByBountyId` has the same shape, so a
///   bounty's claim ids are found by probing `bountyClaims(id, i)` until the
///   array getter reverts - which is also how the page finds what an account
///   has posted and claimed, through `userBounties` and `userClaims`. Every
///   probe rides in one Multicall3 `aggregate3` with `allowFailure` set, so
///   the revert that marks the end of an array costs nothing and returns as a
///   null rather than as a failed request.
///
///   THE HALF OF A BOUNTY THAT CANNOT CHANGE - issuer, title, description,
///   creation time - is cached in the reader's own browser after the first
///   read, so a later visit re-reads only what moves: the pot, the claimer,
///   the ballot. It is an index held by the reader, built from the chain, and
///   it is checked rather than trusted.
///
///   Claim pictures are the one thing that is not on chain. A claim's
///   `tokenURI` points at metadata on a host the claimant chose, so the page
///   fetches nothing until the reader asks for that specific picture by
///   pressing a button, and it follows only `https://` and `ipfs://`.
///
/// WHAT THE PAGE CAN DO
///   Post a solo or an open bounty, fund an open one, take a stake back out,
///   cancel, claim a refund from a cancelled one, post a claim with its
///   picture, accept a claim, put one to a vote, vote, resolve the vote, and
///   pull what the contract owes you. The gating mirrors PoidhV3's own
///   requires, including the one that surprises people: once an open bounty
///   has had any funder other than its issuer, the issuer can no longer accept
///   a claim alone - it has to go to a weighted vote of the funders.
///
/// HOW TO READ THE DAPP
///   cast call <addr> "html()(string)" --rpc-url <rpc> > poidh.html
///   # then open poidh.html in any browser
///
/// HOW TO BROWSE THE DAPP
///   - ERC-8244: https://<addr>.w4eth.io/     (resolves any contract with html())
///   - ERC-4804: https://<addr>.1.w3link.io/  (via the ERC-5219 request() below)
///   - Or a browser with web3:// protocol support.
contract Poidh8244 {
    string public constant NAME = "POIDH";
    string public constant VERSION = "0.1";

    /// @notice The bounty market this page is a front end for.
    address public constant POIDH = 0xE731dFadBFf20542E10D09D26Fc71445C70d4232;

    /// @notice The claim NFT PoidhV3 mints into escrow, and the source of the
    ///         `tokenURI` behind every claim picture.
    address public constant CLAIM_NFT = 0x9c5F45D5e1382e4058D334d93C6c01442012a4D9;

    address public immutable DATA1;
    address public immutable DATA2;
    address public immutable DATA3;
    address public immutable DATA4;
    address public immutable DATA5;

    /// @dev A missing or duplicated chunk would permanently serve broken HTML.
    error InvalidData();

    struct KeyValue {
        string key;
        string value;
    }

    // --------------------------------------------------------------- LINEAGE
    //
    // `html()` is immutable and stays that way. The successor below is a CLAIM
    // ABOUT LINEAGE, never a redirect: this contract serves its own five chunks
    // forever, whatever is deployed later. Making `html()` forward to a
    // successor would have been the smaller change and it would have cost the
    // one property this design exists for - an address whose bytes cannot move
    // under an auditor, a bookmark, or a gateway cache that was told the answer
    // is immutable.
    //
    // A client wanting the newest build walks `successor` until it reaches
    // zero. A client wanting the bytes it audited stops where it is. The served
    // page is one of those clients: it calls `latest()` on its own address,
    // taken from the gateway hostname, and if the tip is not itself it puts a
    // "newer" link in the footer. It SAYS, it does not send.

    /// @notice The account permitted to deploy this version's successor.
    /// @dev NOT immutable, unlike the versions this is modelled on. A steward
    ///      is a person or a multisig, and both of those change - keys are
    ///      rotated, a signer set is migrated, a project hands the role on -
    ///      while the lineage is meant to outlive all of that. Freezing the
    ///      role into the bytecode meant that any such change ended the chain:
    ///      the only way to move it was to deploy a fresh root, which is
    ///      precisely the discontinuity the backward pointer exists to prevent.
    ///
    ///      What is NOT relaxed is anything a reader depends on. `PREVIOUS` and
    ///      `successor` are still write-once and still checked before they are
    ///      set, so the chain a reader walks cannot be restated by a steward,
    ///      new or old. This variable decides only WHO MAY APPEND, and it can
    ///      never be used to alter what has already been appended.
    address public steward;

    /// @notice The account that has been offered the role, until it accepts.
    /// @dev Two steps, not one. A single-call transfer to a mistyped or
    ///      unreachable address ends the lineage as surely as renouncing it,
    ///      silently and with no way back; requiring the recipient to answer
    ///      proves the key exists and can transact before the role moves. The
    ///      deliberate ending has its own function, which says what it does.
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
    ///      or in the block they are reading, so a stolen key could name a
    ///      successor at noon and every predecessor would carry readers there
    ///      before anyone looked at it. With a clock, readers can require a
    ///      version to have stood unchallenged for a while, and it cannot be
    ///      backdated - `block.timestamp` is written here, by this contract, in
    ///      the same transaction that sets the pointer. `uint96` shares the
    ///      slot, so recording it costs one `sstore` either way.
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
    /// @dev `previous` cannot be misstated: any non-zero value must equal
    ///      `msg.sender`, and a successor is only ever created by `deployNext`,
    ///      so the deployer IS the predecessor at construction time. No version
    ///      NUMBER is stored - it is derived by walking, so there is no counter
    ///      to pass in wrongly, skip, or repeat. The chain is the record.
    constructor(address initialSteward, address previous, address[5] memory d) {
        if (previous != address(0) && msg.sender != previous) revert InvalidData();
        steward = initialSteward;
        PREVIOUS = previous;
        for (uint256 i; i != 5; ++i) {
            if (d[i].code.length == 0) revert InvalidData();
            for (uint256 j = i + 1; j != 5; ++j) {
                if (d[i] == d[j]) revert InvalidData();
            }
        }
        DATA1 = d[0];
        DATA2 = d[1];
        DATA3 = d[2];
        DATA4 = d[3];
        DATA5 = d[4];
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
        // breaks the walk for THIS contract and every predecessor - the same
        // permanent failure as a codeless deploy, arrived at from the other
        // side. It must also be zero: a version born already succeeded is not
        // a new tip, and the walk would step straight past it.
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
    ///      counter to pass in wrongly, skip, or repeat. The chain is the
    ///      record. Bounded, so a long chain degrades to an underestimate
    ///      instead of running out of gas.
    function generation() public view returns (uint256 n) {
        address cur = address(this);
        for (n = 1; n != 33; ++n) {
            address prev = Poidh8244(cur).PREVIOUS();
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
            address next = Poidh8244(tip).successor();
            if (next == address(0)) return tip;
            tip = next;
        }
    }

    /// @notice The page, as one string. This is the ERC-8244 entry point.
    function html() external view returns (string memory) {
        return _html();
    }

    /// @notice ERC-5219 request handler. Any path returns the page with
    ///         `Content-Type: text/html` and a permanent cache hint: the
    ///         response is byte-identical forever, since the bytecode is
    ///         immutable. Path and query are ignored - the dapp is a
    ///         single-page app served from every URL on this contract, and it
    ///         reads which bounty to show from the URL fragment, which a
    ///         gateway never sees.
    function request(string[] memory, /*resource*/ KeyValue[] memory /*params*/ )
        external
        view
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers)
    {
        statusCode = 200;
        body = _html();
        headers = new KeyValue[](2);
        headers[0] = KeyValue("Content-Type", "text/html");
        headers[1] = KeyValue("Cache-Control", "public, max-age=31536000, immutable");
    }

    /// @notice ERC-4804/5219 resolution mode: gateways should call request()
    ///         rather than auto-mode URL-to-function dispatch.
    function resolveMode() external pure returns (bytes32) {
        return "5219";
    }

    /// @dev Reassembles the page from all five chunks in one pass: each chunk
    ///      is copied directly after the previous one at the string body, so
    ///      there is no intermediate copy and no concatenation. The cursor
    ///      advances by construction, so the fifth chunk lands after the fourth
    ///      for the same reason the second lands after the first.
    function _html() private view returns (string memory s) {
        address[5] memory d = [DATA1, DATA2, DATA3, DATA4, DATA5];
        assembly ("memory-safe") {
            s := mload(0x40)
            let body := add(s, 0x20)
            let at := body
            for { let i := 0 } lt(i, 5) { i := add(i, 1) } {
                let a := mload(add(d, shl(5, i)))
                let n := extcodesize(a)
                extcodecopy(a, at, 0, n)
                at := add(at, n)
            }
            let total := sub(at, body)
            mstore(s, total)
            let padded := and(add(total, 0x1f), not(0x1f))
            mstore(0x40, add(body, padded))
        }
    }
}
