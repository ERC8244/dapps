/* Presses "Fund it" from BOTH wallet states, because they are different code
   paths and only one of them was ever tested.

   poidh.buttons.mjs answers `eth_accounts` with an address, so the page always
   starts connected and `need()` returns immediately. A wallet that has not yet
   authorised the site answers `[]`, and the press has to run the connect flow
   first - which ends in `refresh()`, which re-renders the detail panel, which
   REBUILDS the very input the reader typed into. Reading the field after that
   read an empty one and reported "That amount is not a number" about an amount
   they did type, having sent nothing.

   `joinAmt` is the only input in the rendered panel offered before connecting:
   the claim form is gated on `account`, and the new-bounty form is static
   markup that render() never rebuilds. So this is the one control that needs
   the two-state test.

   Usage: node test/dapp/poidh.connect.mjs                                   */
import fs from "node:fs";
import {JSDOM} from "jsdom";

const RPC = process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com";
const ACCOUNT = "0x00000000000000000000000000000000000000aa";
const BOUNTY = 24;
const JOIN = "0xa9b2c6eb"; // joinOpenBounty(uint256)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (c, msg, extra) => {
  console.log((c ? "  PASS  " : "  FAIL  ") + msg + (extra !== undefined ? "  " + extra : ""));
  if (!c) failures++;
};

const press = async (startConnected) => {
  let sent = null;
  let authorised = startConnected;
  const dom = new JSDOM(fs.readFileSync("dapp/page.html", "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://x.w4eth.io/",
    beforeParse(w) {
      w.TextEncoder = TextEncoder;
      w.TextDecoder = TextDecoder;
      w.scrollTo = () => {};
      w.confirm = () => true;
      w.HTMLElement.prototype.scrollIntoView = () => {};
      const rpc = async (method, params) => {
        const r = await fetch(RPC, {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({id: 1, jsonrpc: "2.0", method, params: params || []}),
        });
        const j = await r.json();
        if (j.error) throw Error(j.error.message);
        return j.result;
      };
      w.ethereum = {
        request: async ({method, params}) => {
          if (method === "eth_accounts") return authorised ? [ACCOUNT] : [];
          if (method === "eth_requestAccounts") { authorised = true; return [ACCOUNT]; }
          if (method === "eth_chainId") return "0x1";
          if (method === "eth_sendTransaction") { sent = params[0]; return "0x" + "ab".repeat(32); }
          if (method === "eth_getTransactionReceipt") return {status: "0x1"};
          return rpc(method, params);
        },
        on: () => {},
      };
    },
  });

  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);
  await wait(1000);
  w.location.hash = `#b=${BOUNTY}`;
  await w.eval("fromHash()");
  await wait(4000);

  if (!$("doJoin") || !$("joinAmt")) {
    dom.window.close();
    return {error: `bounty #${BOUNTY} no longer offers "Fund it" — pick another open bounty`};
  }
  $("joinAmt").value = "0.05";
  $("doJoin").click();
  await wait(1200);

  // The picker only appears for a wallet that has not authorised the site.
  const row = w.document.querySelector('#wpList button[data-w="0"]');
  if (row) { row.click(); await wait(5000); }

  const stat = $("stat") ? $("stat").textContent.trim() : "";
  dom.window.close();
  return {sent, stat, pickerWasShown: !!row};
};

console.log(`"Fund it" on bounty #${BOUNTY}, against ${RPC}`);

const connected = await press(true);
if (connected.error) ok(false, connected.error);
else {
  ok(!connected.pickerWasShown, "an authorised wallet is not asked to connect again");
  ok(connected.sent?.data?.startsWith(JOIN), "authorised wallet -> joinOpenBounty",
     connected.sent ? connected.sent.data.slice(0, 10) : "NOTHING SENT");
  ok(connected.sent?.value === "0xb1a2bc2ec50000", "value is the 0.05 ETH typed",
     connected.sent?.value);
}

const fresh = await press(false);
if (fresh.error) ok(false, fresh.error);
else {
  ok(fresh.pickerWasShown, "an unauthorised wallet is asked to connect");
  ok(fresh.sent?.data?.startsWith(JOIN), "unauthorised wallet -> joinOpenBounty after connecting",
     fresh.sent ? fresh.sent.data.slice(0, 10) : `NOTHING SENT (${fresh.stat})`);
  ok(fresh.sent?.value === "0xb1a2bc2ec50000",
     "the amount typed before connecting survives the connect", fresh.sent?.value);
}

console.log(failures ? `\n${failures} FAILED` : "\nboth wallet states fund the bounty");
process.exit(failures ? 1 : 0);
