// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.30;

/**
 * @title ERC-5219 Decentralized Application Interface
 * @notice Defines contract-based resource resolution for decentralized web applications.
 * @dev Kept dependency-free and CC0-compatible so the resolver can expose the standard interface directly.
 */
interface IDecentralizedApp {
    /**
     * @notice One request parameter or response header.
     * @param key Parameter or header name.
     * @param value Parameter or header value.
     */
    struct KeyValue {
        string key;
        string value;
    }

    /**
     * @notice Resolves one application resource entirely from contract state.
     * @param resource URL path split into decoded path segments.
     * @param params Optional request metadata supplied by the gateway.
     * @return statusCode HTTP-style response status.
     * @return body Raw resource bytes represented as a Solidity string.
     * @return headers Response metadata including content type and cache policy.
     */
    function request(string[] memory resource, KeyValue[] memory params)
        external
        view
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers);
}
