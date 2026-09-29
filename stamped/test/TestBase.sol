// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface Vm {
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function setEnv(string calldata name, string calldata value) external;
    function etch(address target, bytes calldata code) external;
    function readFileBinary(string calldata path) external view returns (bytes memory data);
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        require(condition, "assertTrue failed");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint mismatch");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "address mismatch");
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        require(actual == expected, "bytes32 mismatch");
    }

    function assertEq(string memory actual, string memory expected) internal pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), "string mismatch");
    }
}
