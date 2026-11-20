// A CREATE2 salt for `deployNext`, for a successor address with leading zero bytes.
//
// `deployNext` does a plain `create2(0, initcode, initcode.length, salt)` from the current wrapper's own address,
// with no guard on the salt: only the steward can call it at all, so nothing needs binding to a deployer. The
// address is the textbook CREATE2 formula: keccak256(0xff ++ deployer ++ salt ++ keccak256(initcode))[12:32],
// where `deployer` here is the current wrapper (the contract making the call) and `initcode` is the successor's
// full creation code, constructor args included — so this has to run after every chunk address is final.
//
// usage: vanity2 <deployer 0x…> <keccak256(initcode) 0x…> <zero bytes>   →   salt <0x…> address <0x…>
use rayon::prelude::*;
use sha3::{Digest, Keccak256};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

fn keccak(data: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(data);
    h.finalize().into()
}

fn bytes20(s: &str) -> [u8; 20] {
    let s = s.trim_start_matches("0x");
    assert_eq!(s.len(), 40, "an address is 20 bytes");
    let mut out = [0u8; 20];
    for i in 0..20 { out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).expect("hex"); }
    out
}

fn bytes32(s: &str) -> [u8; 32] {
    let s = s.trim_start_matches("0x");
    assert_eq!(s.len(), 64, "a hash is 32 bytes");
    let mut out = [0u8; 32];
    for i in 0..32 { out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).expect("hex"); }
    out
}

fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(args.len() == 4, "usage: vanity2 <deployer> <initcode-hash> <zero bytes>");
    let (deployer, initcode_hash, zeros) = (bytes20(&args[1]), bytes32(&args[2]), args[3].parse::<usize>().expect("zero bytes"));
    assert!(zeros <= 8, "at most 8 zero bytes");
    // A different starting point each run, so two runs do not hand out the same salt.
    let seed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
    let t0 = Instant::now();
    let hit = (0u64..u64::MAX).into_par_iter().map(|i| {
        let mut salt = [0u8; 32];
        salt[..8].copy_from_slice(&seed.to_be_bytes());
        salt[24..32].copy_from_slice(&i.to_be_bytes());
        let mut p = [0u8; 85];
        p[0] = 0xff;
        p[1..21].copy_from_slice(&deployer);
        p[21..53].copy_from_slice(&salt);
        p[53..85].copy_from_slice(&initcode_hash);
        let a = keccak(&p);
        (salt, a)
    }).find_any(|(_, a)| a[12..12 + zeros].iter().all(|&x| x == 0)).expect("a hit");
    let (salt, a) = hit;
    eprintln!("found in {:.2} s", t0.elapsed().as_secs_f64());
    println!("salt 0x{} address 0x{}", hex(&salt), hex(&a[12..32]));
}
