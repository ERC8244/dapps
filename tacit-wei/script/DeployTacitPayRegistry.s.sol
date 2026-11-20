// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script, console} from "forge-std/Script.sol";
import {TacitPayRegistry} from "../src/TacitPayRegistry.sol";

interface ICreateX {
    function deployCreate3(bytes32 salt, bytes memory initCode) external payable returns (address newContract);
    function computeCreate3Address(bytes32 salt) external view returns (address computedAddress);
}

/// @notice Deploys TacitPayRegistry with the seeds in deploy/registry-seeds.json, then reads everything back.
///
///   REGISTRY_OWNER     required, the first owner (never zero)
///   REGISTRY_FLAGS     optional, the initial flags word (default 0)
///   REGISTRY_SALT      optional, a CreateX salt for a CREATE3 deploy: the deployer's address, then 0x00 (same address
///                      on every chain) or 0x01 (this chain only), then 11 free bytes. Any other salt is refused,
///                      because a CREATE3 address does not depend on the code, so a salt anyone may use is a salt
///                      anyone may take first with code of their own.
///   REGISTRY_EXPECTED  required with REGISTRY_SALT: the address CreateX reports for it
///
/// A setting that is present must parse in full: a malformed one stops the script rather than falling back.
///
///   forge script script/DeployTacitPayRegistry.s.sol --rpc-url <node> --private-key <key> [--broadcast]
contract DeployTacitPayRegistry is Script {
    address constant CREATEX = 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed;
    string constant SEEDS = "deploy/registry-seeds.json";

    function run() external returns (TacitPayRegistry reg) {
        address owner_ = _address("REGISTRY_OWNER");
        require(owner_ != address(0), "REGISTRY_OWNER is the zero address");
        uint256 flags_ = vm.envExists("REGISTRY_FLAGS") ? vm.envUint("REGISTRY_FLAGS") : 0;
        TacitPayRegistry.Seed[] memory seeds = _seeds(vm.readFile(string.concat(vm.projectRoot(), "/", SEEDS)));
        bytes memory init = abi.encodePacked(type(TacitPayRegistry).creationCode, abi.encode(owner_, seeds, flags_));

        bool create3 = vm.envExists("REGISTRY_SALT");
        bytes32 salt;
        address expected;
        if (create3) {
            salt = _bytes32("REGISTRY_SALT");
            expected = _address("REGISTRY_EXPECTED");
        } else {
            require(!vm.envExists("REGISTRY_EXPECTED"), "REGISTRY_EXPECTED is set without REGISTRY_SALT");
        }

        console.log("owner          ", owner_);
        console.log("flags          ", flags_);
        console.log("seeded lists   ", seeds.length);
        console.log("initcode bytes ", init.length);
        console.log("initcode hash");
        console.logBytes32(keccak256(init));

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        console.log("deployer       ", deployer);
        if (create3) {
            bytes32 guarded = _guard(salt, deployer);
            require(CREATEX.code.length != 0, "CreateX is not on this chain");
            address reported = ICreateX(CREATEX).computeCreate3Address(guarded);
            require(reported == _create3Address(guarded, CREATEX), "CreateX reports another address than CREATE3 gives");
            require(reported == expected, "REGISTRY_EXPECTED is not the address CreateX reports for this salt");
            require(expected.code.length == 0, "something is already deployed at REGISTRY_EXPECTED");
            console.log("guarded salt");
            console.logBytes32(guarded);
            reg = TacitPayRegistry(ICreateX(CREATEX).deployCreate3(salt, init));
            require(address(reg) == expected, "CreateX deployed somewhere else");
            console.log("CREATE3 via CreateX");
        } else {
            reg = new TacitPayRegistry(owner_, seeds, flags_);
            console.log("plain CREATE");
        }
        vm.stopBroadcast();

        _check(reg, owner_, flags_, seeds);
        console.log("registry       ", address(reg));
        console.log("runtime bytes  ", address(reg).code.length);
    }

    // ------------------------------------------------------------- checks

    function _check(TacitPayRegistry reg, address owner_, uint256 flags_, TacitPayRegistry.Seed[] memory seeds)
        internal
        view
    {
        require(address(reg).code.length != 0, "no code at the registry");
        require(reg.owner() == owner_, "owner reads back wrong");
        require(reg.pendingOwner() == address(0), "a pending owner is set");
        require(reg.flags() == flags_, "flags read back wrong");
        (bytes32[] memory services, uint256[] memory chains) = reg.keys();
        require(services.length == seeds.length && chains.length == seeds.length, "key count reads back wrong");
        for (uint256 i; i != seeds.length; ++i) {
            require(services[i] == seeds[i].service && chains[i] == seeds[i].chainId, "key order reads back wrong");
            require(
                keccak256(abi.encode(reg.listAt(seeds[i].service, seeds[i].chainId)))
                    == keccak256(abi.encode(seeds[i].urls)),
                "a seeded list reads back wrong"
            );
            console.log("  checked", _name(seeds[i].service), seeds[i].chainId, seeds[i].urls.length);
        }
    }

    function _name(bytes32 service) internal pure returns (string memory s) {
        uint256 n;
        while (n != 32 && service[n] != 0) ++n;
        s = new string(n);
        for (uint256 i; i != n; ++i) bytes(s)[i] = service[i];
    }

    // ------------------------------------------------------------- CreateX

    /// @dev CreateX's `_guard` for the two salts this script accepts (first 20 bytes the deployer): 0x00 in byte 21
    ///      hashes the deployer with the salt, 0x01 the deployer, the chain id and the salt.
    function _guard(bytes32 salt, address deployer) internal view returns (bytes32) {
        require(address(bytes20(salt)) == deployer, "REGISTRY_SALT does not start with the deployer's address");
        bytes1 flag = salt[20];
        if (flag == 0x00) return keccak256(abi.encodePacked(bytes32(uint256(uint160(deployer))), salt));
        if (flag == 0x01) return keccak256(abi.encode(deployer, block.chainid, salt));
        revert("REGISTRY_SALT byte 21 must be 0x00 or 0x01");
    }

    /// @dev The CREATE3 address (Solady's proxy, as CreateX uses) for `salt` from `factory`, computed here so the
    ///      address CreateX reports is checked against an independent derivation.
    function _create3Address(bytes32 salt, address factory) internal pure returns (address) {
        bytes32 proxyInitHash = 0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f;
        address proxy = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), factory, salt, proxyInitHash)))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes2(0xd694), proxy, bytes1(0x01))))));
    }

    // ------------------------------------------------------------- settings

    function _address(string memory name) internal view returns (address) {
        _hex(name, 20);
        return vm.envAddress(name);
    }

    function _bytes32(string memory name) internal view returns (bytes32) {
        _hex(name, 32);
        return vm.envBytes32(name);
    }

    /// @dev The raw value must be 0x and exactly `n` bytes of hex, so a value a digit short is refused rather than
    ///      padded. vm.envString reverts when the variable is missing.
    function _hex(string memory name, uint256 n) internal view {
        bytes memory s = bytes(vm.envString(name));
        require(s.length == 2 + 2 * n && s[0] == "0" && s[1] == "x", string.concat(name, ": expected 0x and ", vm.toString(2 * n), " hex digits"));
        for (uint256 i = 2; i != s.length; ++i) {
            bytes1 c = s[i];
            require(
                (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F"),
                string.concat(name, ": not hex")
            );
        }
    }

    /// @dev deploy/registry-seeds.json: an array of {"service", "chainId", "urls"}, nothing else. Each service is
    ///      1-32 printable ASCII characters, left-aligned into a bytes32; each (service, chainId) appears once; every
    ///      list has at least one non-empty entry.
    function _seeds(string memory json) internal view returns (TacitPayRegistry.Seed[] memory seeds) {
        uint256 n;
        while (vm.keyExistsJson(json, string.concat("$[", vm.toString(n), "]"))) ++n;
        require(n != 0, "no seeds");
        seeds = new TacitPayRegistry.Seed[](n);
        for (uint256 i; i != n; ++i) {
            string memory at_ = string.concat("$[", vm.toString(i), "]");
            require(vm.parseJsonKeys(json, at_).length == 3, "a seed has keys other than service, chainId, urls");
            bytes memory svc = bytes(vm.parseJsonString(json, string.concat(at_, ".service")));
            require(svc.length != 0 && svc.length <= 32, "a service name is empty or longer than 32 bytes");
            for (uint256 j; j != svc.length; ++j) {
                require(svc[j] >= 0x21 && svc[j] <= 0x7e, "a service name is not printable ASCII");
            }
            seeds[i].service = bytes32(svc);
            seeds[i].chainId = vm.parseJsonUint(json, string.concat(at_, ".chainId"));
            seeds[i].urls = vm.parseJsonStringArray(json, string.concat(at_, ".urls"));
            require(seeds[i].urls.length != 0, "a seed has no urls");
            for (uint256 j; j != seeds[i].urls.length; ++j) {
                require(bytes(seeds[i].urls[j]).length != 0, "a seed has an empty url");
            }
            for (uint256 k; k != i; ++k) {
                require(
                    seeds[k].service != seeds[i].service || seeds[k].chainId != seeds[i].chainId,
                    "a (service, chainId) appears twice"
                );
            }
        }
    }
}
