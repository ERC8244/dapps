// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title TacitPayRegistry
/// @notice The off-chain endpoints and feature switches the tacit pay page reads, curated on chain so none of them is
///         fixed into the page's bytes.
///
/// WHY THIS EXISTS
///   The page is immutable, but a few services around it are not: read nodes, a bundler, the relay host, caches of
///   deposit history, mirrors of proving files, the WalletConnect relay. Baked into the page, each would be stuck
///   there until a new version is deployed. Here each is a list read from chain once per session, merged AHEAD of the
///   values the page was built with, which it falls back to when this contract cannot be read.
///
///   The read interface is zEndpoints' (same selectors, same chain-0 fallback), so the page's reader code is the same
///   for both. On top of it sits one word of flags, read in the same call through `read`.
///
/// KEYS
///   A list is named by `(service, chainId)`: `service` is a short ASCII name left-aligned in a bytes32, `chainId` the
///   chain the endpoint SERVES. Chain 0 is the fallback, read when a chain has no list of its own, and the home of
///   services that belong to no chain. The services the page reads:
///     "rpc"        1   Ethereum read nodes
///     "logs"       1   nodes that serve wide eth_getLogs ranges
///     "keepers"    1   the relay host
///     "bundler"    1   ERC-4337 bundler JSON-RPC URLs
///     "leaves"     1   Tornado deposit-history chunk caches
///     "mirrors"    0   Tacit proving-key mirrors
///     "tmirrors"   0   Tornado prover wasm, whole-file URLs
///     "forwarders" 1   private-route forwarders
///     "wc"         0   the WalletConnect relay, wss://
///     "wcpid"      0   the WalletConnect project id (a string, not a URL)
///
/// FLAGS
///   Kill switches the PAGE interprets; this contract enforces nothing about them. A set bit only ever turns a
///   feature OFF, so the worst a flag can do is take a feature away:
///     bit 0   the Tornado Cash split on deposit
///     bit 1   gasless (paymaster and bundler) note withdrawals
///     bit 2   making notes from the private balance
///     bit 3   reserved (relays from the open RelayRegistry, for a later page)
///     bit 4   swap-in into whole notes (a token paid in through the split zap)
///     bit 5   swap-out from whole notes (a note taken out as a token by its own account)
///     bit 6   the one-transaction split forwarder (the page falls back to separate transactions)
///   Bits 7 and up mean nothing to the page today.
///
/// TRUST
///   Nothing here names an address that receives funds, a hash, calldata or text to sign: only strings and the flags.
///   The page treats every entry as untrusted input, checks its shape per service, and skips what it cannot use:
///     - A read node can misstate what it is asked. It never sees a key, and the calldata the page builds targets
///       addresses in the page's own bytes.
///     - A logs node or a deposit-history cache can hide history. Neither can forge it: what they return is checked
///       against the pool's on-chain root.
///     - Mirrors are checked by a SHA-256 pinned in the page, so a bad one costs a retry, never a wrong file.
///     - The relay host, bundlers and forwarders carry operations whose recipients and fees are fixed by a proof or a
///       signature the page made; a hostile one can refuse or delay, and sees what it carries.
///     - The WalletConnect relay carries end-to-end encrypted messages. It can drop them, not read them.
///   So curating this is a liveness and privacy decision, never a custody one.
contract TacitPayRegistry {
    /// @notice Curation. Moves by the two-step handoff below.
    address public owner;

    /// @notice The address offered ownership that has not yet accepted it.
    address public pendingOwner;

    /// @notice The kill switches above. Read through `read` with the lists.
    uint256 public flags;

    /// @notice One list, as the constructor takes it.
    struct Seed {
        bytes32 service;
        uint256 chainId;
        string[] urls;
    }

    /// @dev service => chainId => entries, in preference order: the page tries position 0 first and fails over down
    ///      the list.
    mapping(bytes32 service => mapping(uint256 chainId => string[])) internal _lists;

    /// @notice Whether `(service, chainId)` has ever been written. `keys` enumerates exactly these.
    mapping(bytes32 service => mapping(uint256 chainId => bool)) public known;

    bytes32[] internal _services;
    uint256[] internal _chains;

    error NotOwner();
    error BadIndex();
    error LengthMismatch();
    error ListFull();

    /// @notice The most entries one list holds: the page reads at most 64 per list and 16 lists in one call, and a reply past
    ///         its bounds would make it set the whole registry aside (its switches included), so a list stays well under.
    uint256 public constant MAX_LIST = 32;

    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event FlagsSet(uint256 previous, uint256 next);

    /// @dev Emitted by `set` BEFORE the replacement, with the length that was discarded, so an indexer rebuilding a
    ///      list from logs drops the tail it would otherwise keep.
    event Reset(bytes32 indexed service, uint256 indexed chainId, uint256 oldLength);
    event Added(bytes32 indexed service, uint256 indexed chainId, uint256 index, string url);
    event Removed(bytes32 indexed service, uint256 indexed chainId, uint256 index, string url);
    event Moved(bytes32 indexed service, uint256 indexed chainId, uint256 from, uint256 to);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier inRange(bytes32 service, uint256 chainId, uint256 i) {
        if (i >= _lists[service][chainId].length) revert BadIndex();
        _;
    }

    /// @param admin Who may curate from here.
    /// @param seeds The lists this contract is born holding. The page keeps its own values behind them, so an empty
    ///              list degrades to exactly the page that cannot read this contract.
    /// @param initialFlags The flags it is born holding.
    constructor(address admin, Seed[] memory seeds, uint256 initialFlags) {
        owner = admin;
        emit OwnershipTransferred(address(0), admin);
        for (uint256 i; i != seeds.length; ++i) {
            for (uint256 j; j != seeds[i].urls.length; ++j) {
                _push(seeds[i].service, seeds[i].chainId, seeds[i].urls[j]);
            }
        }
        flags = initialFlags;
        emit FlagsSet(0, initialFlags);
    }

    // ------------------------------------------------------------- READS

    /// @notice The list for `service` on `chainId`: the chain's own if it has entries, otherwise the fallback at
    ///         chain 0.
    /// @dev An EMPTY chain list inherits rather than hides: the page keeps its built-in values behind any list anyway.
    function listOf(bytes32 service, uint256 chainId) public view returns (string[] memory) {
        string[] storage own = _lists[service][chainId];
        return own.length != 0 ? own : _lists[service][0];
    }

    /// @notice Several lists in one call, each resolved as `listOf`.
    function listsOf(bytes32[] calldata services, uint256[] calldata chainIds)
        public
        view
        returns (string[][] memory out)
    {
        if (services.length != chainIds.length) revert LengthMismatch();
        out = new string[][](services.length);
        for (uint256 i; i != services.length; ++i) {
            out[i] = listOf(services[i], chainIds[i]);
        }
    }

    /// @notice The flags and several lists in one call: what the page reads once per session.
    function read(bytes32[] calldata services, uint256[] calldata chainIds)
        public
        view
        returns (uint256 flags_, string[][] memory lists)
    {
        return (flags, listsOf(services, chainIds));
    }

    /// @notice The list stored under exactly `(service, chainId)`, with no fallback. What the curation ops index
    ///         into.
    function listAt(bytes32 service, uint256 chainId) public view returns (string[] memory) {
        return _lists[service][chainId];
    }

    /// @notice How many entries `(service, chainId)` holds, with no fallback.
    function count(bytes32 service, uint256 chainId) public view returns (uint256) {
        return _lists[service][chainId].length;
    }

    /// @notice One entry by position.
    function get(bytes32 service, uint256 chainId, uint256 i)
        public
        view
        inRange(service, chainId, i)
        returns (string memory)
    {
        return _lists[service][chainId][i];
    }

    /// @notice Every `(service, chainId)` ever written, in first-write order, so a reader can audit the whole
    ///         curation without replaying logs. A list since emptied stays listed, with a count of zero.
    function keys() public view returns (bytes32[] memory services, uint256[] memory chainIds) {
        return (_services, _chains);
    }

    // -------------------------------------------------------- GOVERNANCE
    //
    // Each op is scoped to one list: the smallest write that does the job, with `set` as the escape hatch. Changes
    // take effect on a page's next read, never mid-session.

    /// @notice Append an entry at the end of a list's failover order.
    function add(bytes32 service, uint256 chainId, string calldata url) public onlyOwner {
        _push(service, chainId, url);
    }

    /// @notice Drop an entry, PRESERVING ORDER: the tail shifts down, because order is the curation and a
    ///         swap-and-pop would promote whatever sat last.
    function remove(bytes32 service, uint256 chainId, uint256 i)
        public
        onlyOwner
        inRange(service, chainId, i)
    {
        string[] storage l = _lists[service][chainId];
        emit Removed(service, chainId, i, l[i]);
        uint256 last = l.length - 1;
        for (uint256 j = i; j < last; ++j) {
            l[j] = l[j + 1];
        }
        l.pop();
    }

    /// @notice Drop a list's last entry: the way an `add` is undone.
    function pop(bytes32 service, uint256 chainId) public onlyOwner {
        string[] storage l = _lists[service][chainId];
        if (l.length == 0) revert BadIndex();
        emit Removed(service, chainId, l.length - 1, l[l.length - 1]);
        l.pop();
    }

    /// @notice Move an entry to another position, shifting what lies between.
    function move(bytes32 service, uint256 chainId, uint256 from, uint256 to)
        public
        onlyOwner
        inRange(service, chainId, from)
        inRange(service, chainId, to)
    {
        if (from == to) return;
        string[] storage l = _lists[service][chainId];
        string memory v = l[from];
        if (from < to) {
            for (uint256 j = from; j < to; ++j) {
                l[j] = l[j + 1];
            }
        } else {
            for (uint256 j = from; j > to; --j) {
                l[j] = l[j - 1];
            }
        }
        l[to] = v;
        emit Moved(service, chainId, from, to);
    }

    /// @notice Replace one entry in place, keeping its position.
    function setAt(bytes32 service, uint256 chainId, uint256 i, string calldata url)
        public
        onlyOwner
        inRange(service, chainId, i)
    {
        string[] storage l = _lists[service][chainId];
        emit Removed(service, chainId, i, l[i]);
        l[i] = url;
        emit Added(service, chainId, i, url);
    }

    /// @notice Replace a whole list. An empty `next` clears it, which returns the chain to the fallback.
    function set(bytes32 service, uint256 chainId, string[] calldata next) public onlyOwner {
        _note(service, chainId);
        emit Reset(service, chainId, _lists[service][chainId].length);
        delete _lists[service][chainId];
        for (uint256 i; i != next.length; ++i) {
            _push(service, chainId, next[i]);
        }
    }

    /// @notice Replace the flags word. See FLAGS above for what the page makes of each bit.
    function setFlags(uint256 next) public onlyOwner {
        emit FlagsSet(flags, next);
        flags = next;
    }

    // ------------------------------------------------------------- OWNERSHIP

    /// @notice Offer ownership to `next`. Nothing changes until it is accepted; offering `address(0)` withdraws an
    ///         offer.
    /// @dev There is no renounce: an unowned registry could never drop an endpoint that has gone bad or clear a
    ///      flag.
    function transferOwnership(address next) public onlyOwner {
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    /// @notice Accept an ownership offer made to `msg.sender`.
    function acceptOwnership() public {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        delete pendingOwner;
    }

    // ------------------------------------------------------------- INTERNAL

    /// @dev No validation on chain: the page checks every entry's shape per service anyway and skips what it cannot
    ///      use, so a malformed write degrades to fewer endpoints, never none.
    function _push(bytes32 service, uint256 chainId, string memory url) internal {
        _note(service, chainId);
        string[] storage l = _lists[service][chainId];
        if (l.length >= MAX_LIST) revert ListFull();
        l.push(url);
        emit Added(service, chainId, l.length - 1, url);
    }

    function _note(bytes32 service, uint256 chainId) internal {
        if (known[service][chainId]) return;
        known[service][chainId] = true;
        _services.push(service);
        _chains.push(chainId);
    }
}
