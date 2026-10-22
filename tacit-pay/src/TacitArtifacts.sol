// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title TacitArtifacts
/// @notice An index of the files Tacit wallets fetch and check against a pinned SHA-256 (the private ETH pool's proving
///         key and witness program, its verifying key and pin record, and the standalone wallet as served), each stored
///         onchain as the code of data contracts, and a way to read them back.
/// @dev    A file is cut into pieces of up to 24,575 bytes. Each piece is the runtime code of a contract: a STOP byte
///         (0x00, so it never runs), then the bytes. Pieces and manifests are deployed through the deterministic CREATE2
///         proxy (0x4e59b44847b379578588920ca78fbf26c0b4956c) with salt 0, so an address follows from its bytes alone.
///         A manifest's code is 0x00 ‖ "tacit-artifact-v1" ‖ sha256 (32) ‖ size (uint64) ‖ count (uint16) ‖ count
///         piece addresses (20 each). Joining the pieces, each less its first byte, gives the file; its SHA-256 is the
///         check, as the wallets that pin it make it.
contract TacitArtifacts {
    struct File {
        string name;
        bytes32 sha256;
        uint64 size;
        address manifest;
    }

    bytes constant TAG = "tacit-artifact-v1";

    /// @notice The files, with their pinned SHA-256, size in bytes and manifest.
    function files() external pure returns (File[] memory f) {
        f = new File[](5);
        f[0] = File("transact_final.zkey", 0x40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b, 28558285, 0xF7679584f6dc84495374dA5B5350C2E7828ad620);
        f[1] = File("transact.wasm", 0x02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1, 4916992, 0xc63e43d159429583A9fb3fF0b5053e4D12415F55);
        f[2] = File("transact_vk.json", 0xf3e36ac06ad59428003b90abd80b807180badeb06c3960c50b060ebc59b626b3, 4761, 0x8649Dd8ec5b0DE7de9F6934A13188E2b868B975B);
        f[3] = File("pin.json", 0x79ddf12a68239eb9d1ddeaff9518d05ef57fa56e20deea8aae730413c3be78f9, 1501, 0x75578ab320147Af1f8d39e7e3643621Bc57e5bE9);
        f[4] = File("tacit-evm-pool-wallet.js", 0xcdc59dd5d5c95370a30161dd64637e32590b85290241944184283a05098c15c0, 705182, 0x202fF20B540794CD6f8F54cF80A0Af6170BEaDB4);
    }

    /// @notice What a manifest says: the file's SHA-256, its size, and the addresses of its pieces in order.
    function manifest(address m) public view returns (bytes32 hash, uint64 size, address[] memory pieces) {
        bytes memory c = m.code;
        uint256 at = 1 + TAG.length;
        require(c.length >= at + 42 && c[0] == 0x00, "not a manifest");
        for (uint256 i; i < TAG.length; ++i) require(c[1 + i] == TAG[i], "not a manifest");
        uint256 count;
        assembly ("memory-safe") {
            let p := add(add(c, 0x20), at)
            hash := mload(p)
            size := shr(192, mload(add(p, 32)))
            count := shr(240, mload(add(p, 40)))
        }
        at += 42;
        require(c.length == at + 20 * count, "not a manifest");
        pieces = new address[](count);
        for (uint256 i; i < count; ++i) {
            address a;
            assembly ("memory-safe") { a := shr(96, mload(add(add(add(c, 0x20), at), mul(i, 20)))) }
            pieces[i] = a;
        }
    }

    /// @notice Piece `i` of the file `m` describes, as bytes (its code less the leading STOP byte).
    function piece(address m, uint256 i) public view returns (bytes memory b) {
        (, , address[] memory pieces) = manifest(m);
        b = _data(pieces[i]);
    }

    /// @notice Whether the file `m` describes reassembles to its SHA-256, for files small enough to check in one call.
    function check(address m) external view returns (bool) {
        (bytes32 hash, uint64 size, address[] memory pieces) = manifest(m);
        bytes memory all;
        for (uint256 i; i < pieces.length; ++i) all = bytes.concat(all, _data(pieces[i]));
        return all.length == size && sha256(all) == hash;
    }

    function _data(address a) private view returns (bytes memory b) {
        uint256 n = a.code.length;
        require(n > 0, "missing piece");
        b = new bytes(n - 1);
        assembly ("memory-safe") {
            extcodecopy(a, add(b, 0x20), 0, 1)
            if byte(0, mload(add(b, 0x20))) { revert(0, 0) }
            extcodecopy(a, add(b, 0x20), 1, sub(n, 1))
        }
    }
}
