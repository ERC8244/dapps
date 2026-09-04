// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { IDecentralizedApp } from "./interfaces/IDecentralizedApp.sol";
import { IStampedVersion } from "./interfaces/IStampedVersion.sol";

/**
 * @title Stamped Gateway Compatibility Adapter
 * @author acgk.eth
 * @notice Serves a small uncompressed launcher for gateways that discard ERC-5219 `Content-Encoding` headers.
 * @notice All application content, metadata, and assets continue to come from the existing reviewed resolver.
 * @dev The launcher downloads the resolver's immutable gzip bytes from `/app.gz`, decompresses them in the browser,
 *      and replaces itself with the complete application document.
 * @dev Delegating release selection to the existing resolver preserves its three-day review and activation policy.
 */
contract StampedGatewayAdapter is IDecentralizedApp {
    /// @notice The supplied upstream address is not a deployed, active Stamped resolver.
    error InvalidUpstream(address upstream);

    /// @notice Existing reviewed resolver that remains the source of every Stamped release.
    IStampedVersion public immutable upstream;

    /**
     * @notice Creates a gateway-compatible endpoint around an existing active Stamped resolver.
     * @param upstream_ Existing resolver whose reviewed release bytes will be served.
     * @dev The deployment script must additionally verify the exact upstream address and chain.
     */
    constructor(address upstream_) {
        if (upstream_.code.length == 0) revert InvalidUpstream(upstream_);
        try IStampedVersion(upstream_).htmlHash() returns (bytes32 value) {
            if (value == bytes32(0)) revert InvalidUpstream(upstream_);
        } catch {
            revert InvalidUpstream(upstream_);
        }
        upstream = IStampedVersion(upstream_);
    }

    /**
     * @notice Advertises ERC-5219 routing to ERC-4804 gateways through ERC-6944.
     * @return Exact short ASCII mode identifier `5219`, right-padded to 32 bytes.
     */
    function resolveMode() external pure returns (bytes32) {
        // ERC-6944 requires this exact short ASCII value, right-padded to bytes32.
        // forge-lint: disable-next-line(unsafe-typecast)
        return bytes32("5219");
    }

    /**
     * @inheritdoc IDecentralizedApp
     * @dev `/` and `/index.html` return an uncompressed launcher. `/app.gz` returns the reviewed application bytes
     *      without a `Content-Encoding` header. Every remaining route is delegated unchanged to the upstream resolver.
     */
    function request(string[] memory resource, KeyValue[] memory params)
        external
        view
        override
        returns (uint16 statusCode, string memory body, KeyValue[] memory headers)
    {
        if (_isHtml(resource)) return (200, _launcher(), _headers("text/html; charset=utf-8"));
        if (resource.length == 1 && _same(resource[0], "app.gz")) {
            return (200, upstream.html(), _headers("application/gzip"));
        }
        if (_isManifest(resource)) {
            return (200, _manifest(), _headers("application/json; charset=utf-8"));
        }
        return IDecentralizedApp(address(upstream)).request(resource, params);
    }

    /// @dev Recognizes the root path, an empty segment, and `index.html` as launcher requests.
    function _isHtml(string[] memory resource) private pure returns (bool) {
        return resource.length == 0
            || (resource.length == 1 && (bytes(resource[0]).length == 0 || _same(resource[0], "index.html")));
    }

    /// @dev Recognizes the canonical Farcaster domain-manifest route.
    function _isManifest(string[] memory resource) private pure returns (bool) {
        return resource.length == 2 && _same(resource[0], ".well-known") && _same(resource[1], "farcaster.json");
    }

    /**
     * @dev Preserves the signed, reviewed manifest while filling the two deprecated discovery fields shown by
     *      Farcaster's current debugger. The page-level `fc:miniapp` embed remains the authoritative share card.
     */
    function _manifest() private view returns (string memory) {
        bytes memory manifest = bytes(upstream.farcasterManifest());
        bool needsImage = !_contains(manifest, bytes('"imageUrl"'));
        bool needsButton = !_contains(manifest, bytes('"buttonTitle"'));
        if (!needsImage && !needsButton) return string(manifest);

        uint256 miniapp = _indexOf(manifest, bytes('"miniapp"'));
        if (miniapp == type(uint256).max) return string(manifest);
        uint256 brace = miniapp + 9;
        while (brace < manifest.length && manifest[brace] != 0x7b) ++brace;
        if (brace == manifest.length) return string(manifest);

        string memory fields;
        if (needsImage) fields = '"imageUrl":"https://stamped.wei.limo/embed-onchain.png",';
        if (needsButton) fields = string.concat(fields, '"buttonTitle":"Get stamped",');
        return string.concat(_slice(manifest, 0, brace + 1), fields, _slice(manifest, brace + 1, manifest.length));
    }

    /// @dev Compares short route strings by Keccak-256 hash.
    function _same(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// @dev Returns whether `needle` occurs within `haystack`.
    function _contains(bytes memory haystack, bytes memory needle) private pure returns (bool) {
        return _indexOf(haystack, needle) != type(uint256).max;
    }

    /// @dev Returns the first byte offset of `needle`, or the maximum uint256 when absent.
    function _indexOf(bytes memory haystack, bytes memory needle) private pure returns (uint256) {
        if (needle.length == 0 || needle.length > haystack.length) return type(uint256).max;
        for (uint256 i; i <= haystack.length - needle.length; ++i) {
            bool found = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return type(uint256).max;
    }

    /// @dev Copies the half-open byte interval `[start, end)` into a string.
    function _slice(bytes memory source, uint256 start, uint256 end) private pure returns (string memory) {
        bytes memory result = new bytes(end - start);
        for (uint256 i; i < result.length; ++i) {
            result[i] = source[start + i];
        }
        return string(result);
    }

    /// @dev Returns gateway-safe headers without `Content-Encoding`; the body is uncompressed unless routed to `/app.gz`.
    function _headers(string memory contentType) private pure returns (KeyValue[] memory headers) {
        headers = new KeyValue[](2);
        headers[0] = KeyValue({ key: "Content-Type", value: contentType });
        headers[1] = KeyValue({ key: "Cache-Control", value: "public, max-age=60" });
    }

    /**
     * @dev Returns the complete crawler-visible Mini App and Open Graph metadata before JavaScript executes.
     *      The launcher is intentionally small so the compatibility repair requires only one contract deployment.
     */
    function _launcher() private pure returns (string memory) {
        return string.concat(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\">",
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">",
            "<meta name=\"theme-color\" content=\"#100d20\">",
            "<meta name=\"description\" content=\"Create and collect permanent proof-of-attendance credentials, fully onchain.\">",
            "<meta property=\"og:title\" content=\"Stamped &mdash; Show up. Get stamped.\">",
            "<meta property=\"og:description\" content=\"Permanent POAPs and event memories, fully onchain.\">",
            "<meta property=\"og:image\" content=\"https://stamped.wei.limo/og-onchain.png\">",
            "<meta property=\"og:url\" content=\"https://stamped.wei.limo/\"><meta property=\"og:type\" content=\"website\">",
            "<meta property=\"og:site_name\" content=\"Stamped\"><link rel=\"canonical\" href=\"https://stamped.wei.limo/\">",
            "<meta name=\"twitter:card\" content=\"summary_large_image\">",
            "<meta name=\"twitter:title\" content=\"Stamped - Show up. Get stamped.\">",
            "<meta name=\"twitter:description\" content=\"Permanent POAPs and event memories, fully onchain.\">",
            "<meta name=\"twitter:image\" content=\"https://stamped.wei.limo/og-onchain.png\">",
            "<meta name=\"fc:miniapp\" content='",
            "{\"version\":\"1\",\"imageUrl\":\"https://stamped.wei.limo/embed-onchain.png\",",
            "\"button\":{\"title\":\"Get stamped\",\"action\":{\"type\":\"launch_miniapp\",",
            "\"name\":\"Stamped\",\"url\":\"https://stamped.wei.limo/?miniApp=true\",",
            "\"splashImageUrl\":\"https://stamped.wei.limo/splash-onchain.png\",",
            "\"splashBackgroundColor\":\"#100d20\"}}}'>",
            "<link rel=\"icon\" href=\"https://stamped.wei.limo/icon-onchain.png\">",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' data: blob:;",
            "script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';",
            "connect-src 'self' https://sourcify.dev https://sepolia.base.org https://mainnet.base.org ",
            "https://base-rpc.publicnode.com https://base-sepolia-rpc.publicnode.com https://arb1.arbitrum.io ",
            "https://arbitrum-one-rpc.publicnode.com https://ethereum-sepolia-rpc.publicnode.com https://rpc.sepolia.org ",
            "https://ethereum-rpc.publicnode.com https://eth.drpc.org wss://relay.walletconnect.org;",
            "img-src 'self' data: blob:;font-src 'none';object-src 'none';base-uri 'none';frame-ancestors *\">",
            "<title>Stamped &mdash; Onchain POAPs</title></head><body style=\"margin:0;background:#100d20;color:#ece9e2\">",
            "<noscript>Stamped needs JavaScript to open the onchain application.</noscript><script>",
            "(async()=>{try{if(!('DecompressionStream'in window))throw Error('This browser cannot open gzip applications.');",
            "const r=await fetch('/app.gz');if(!r.ok)throw Error('Application download failed: '+r.status);",
            "const s=new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'));",
            "const h=await new Response(s).text();document.open();document.write(h);document.close()}",
            "catch(e){console.error(e);document.body.innerHTML='<main style=\"padding:32px;font:16px system-ui\">",
            "<h1>Stamped could not open.</h1><p>Refresh the page or use a current browser.</p></main>'}})();",
            "</script></body></html>"
        );
    }
}
