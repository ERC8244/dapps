// ── post-quantum: ML-KEM-768, SHA-3 and the backup phrase ──
// ML-KEM-768 as FIPS 203 defines it (the deterministic inner functions: callers bring the randomness), on the SHA-3 and
// SHAKE sponges of FIPS 202, written here from the standards. A key is checked before use (an encapsulation key's
// coefficients below q, a decapsulation key's hash of its encapsulation key), and a ciphertext that does not re-encrypt
// to itself opens to J(z ‖ c), chosen without a branch on the secret. `expand` does a key's matrix work once, for a scan
// that opens many ciphertexts with one key. Nothing here touches the page, so a worker can run it from the same text;
// only the phrase uses the page's SHA-256 (BIP39's checksum).
//   ek  = t̂ (3 × 384 B) ‖ ρ (32 B)                              1184 B
//   dk  = ŝ (3 × 384 B) ‖ ek ‖ H(ek) ‖ z                          2400 B
//   ct  = Compress10(u) (3 × 320 B) ‖ Compress4(v) (128 B)        1088 B
const PQ = (() => {
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const need = (b, n, what) => { if (!b || b.length != n) throw Error(`ML-KEM: ${what} is ${n} bytes`); };

  // ---- Keccak-f[1600] and its sponges ----
  // Lane k is words 2k (its low half) and 2k + 1. Rotations, lane order and round constants are computed.
  const RO = [], DS = [], RC = [], C = new Int32Array(10);
  for (let t = 0, x = 1, y = 0; t < 24; t++) { RO.push((t + 1) * (t + 2) / 2 % 64); [x, y] = [y, (2 * x + 3 * y) % 5]; DS.push(2 * (x + 5 * y)); }
  for (let i = 0, r = 1; i < 24; i++) {
    let lo = 0, hi = 0;
    for (let j = 0; j < 7; j++) { if (r & 1) j < 6 ? lo |= 1 << (1 << j) - 1 : hi = 1 << 31; r = (r << 1 ^ (r >> 7) * 0x71) & 255; }
    RC.push(lo, hi);
  }
  const f = (s) => {
    for (let r = 0; r < 48; r += 2) {
      for (let i = 0; i < 10; i++) C[i] = s[i] ^ s[i + 10] ^ s[i + 20] ^ s[i + 30] ^ s[i + 40];
      for (let x = 0; x < 10; x += 2) {
        const p = (x + 8) % 10, q = (x + 2) % 10, lo = C[p] ^ (C[q] << 1 | C[q + 1] >>> 31), hi = C[p + 1] ^ (C[q + 1] << 1 | C[q] >>> 31);
        for (let y = x; y < 50; y += 10) { s[y] ^= lo; s[y + 1] ^= hi; }
      }
      // rho and pi (a shift count is taken mod 32, so `hi << n` is `hi << n - 32` past 32)
      let lo = s[2], hi = s[3];
      for (let t = 0; t < 24; t++) {
        const n = RO[t], d = DS[t], a = s[d], b = s[d + 1];
        if (n < 32) { s[d] = lo << n | hi >>> 32 - n; s[d + 1] = hi << n | lo >>> 32 - n; } else { s[d] = hi << n | lo >>> 64 - n; s[d + 1] = lo << n | hi >>> 64 - n; }
        lo = a; hi = b;
      }
      // chi, a row of five lanes at a time, read out first (written out: twice the speed of a loop)
      for (let y = 0; y < 50; y += 10) {
        const a0 = s[y], a1 = s[y + 1], b0 = s[y + 2], b1 = s[y + 3], c0 = s[y + 4], c1 = s[y + 5], d0 = s[y + 6], d1 = s[y + 7], e0 = s[y + 8], e1 = s[y + 9];
        s[y] = a0 ^ ~b0 & c0; s[y + 1] = a1 ^ ~b1 & c1; s[y + 2] = b0 ^ ~c0 & d0; s[y + 3] = b1 ^ ~c1 & d1; s[y + 4] = c0 ^ ~d0 & e0;
        s[y + 5] = c1 ^ ~d1 & e1; s[y + 6] = d0 ^ ~e0 & a0; s[y + 7] = d1 ^ ~e1 & a1; s[y + 8] = e0 ^ ~a0 & b0; s[y + 9] = e1 ^ ~a1 & b1;
      }
      s[0] ^= RC[r]; s[1] ^= RC[r + 1];
    }
  };
  // Absorbs msg with the domain bits `pad` (0x06 SHA-3, 0x1f SHAKE) and returns a squeeze: each call gives the next n bytes.
  const xof = (rate, pad, msg) => {
    const s = new Int32Array(50), x = (b, i) => { s[i >> 2] ^= b << 8 * (i & 3); };
    let p = 0;
    for (const b of msg) { x(b, p); if (++p == rate) { f(s); p = 0; } }
    x(pad, p); x(128, rate - 1); f(s); p = 0;
    return (n) => {
      const o = new Uint8Array(n);
      for (let i = 0; i < n; i++, p++) { if (p == rate) { f(s); p = 0; } o[i] = s[p >> 2] >> 8 * (p & 3); }
      return o;
    };
  };
  const sha3_256 = (m) => xof(136, 6, m)(32), sha3_512 = (m) => xof(72, 6, m)(64);
  const shake128 = (m, n) => xof(168, 31, m)(n), shake256 = (m, n) => xof(136, 31, m)(n);

  // ---- ML-KEM-768 (k = 3, η1 = η2 = 2, du = 10, dv = 4) ----
  // A polynomial is 256 coefficients in [0, q). Z[i] = 17^bitrev7(i) are the NTT's roots, G[i] = 17^(2·bitrev7(i)+1) the
  // base-case multipliers.
  const Q = 3329, K3 = [0, 1, 2], P = () => new Int32Array(256), Z = [], G = [];
  const pow = (e) => { let r = 1; while (e--) r = r * 17 % Q; return r; };
  for (let i = 0; i < 128; i++) { let b = 0; for (let k = 0; k < 7; k++) b = b << 1 | i >> k & 1; Z.push(pow(b)); G.push(pow(2 * b + 1)); }
  const ntt = (f) => {
    for (let l = 128, k = 1; l > 1; l >>= 1) for (let s = 0; s < 256; s += 2 * l) {
      const z = Z[k++];
      for (let j = s; j < s + l; j++) { const t = z * f[j + l] % Q; f[j + l] = (f[j] - t + Q) % Q; f[j] = (f[j] + t) % Q; }
    }
    return f;
  };
  const intt = (f) => {
    for (let l = 2, k = 127; l < 256; l <<= 1) for (let s = 0; s < 256; s += 2 * l) {
      const z = Z[k--];
      for (let j = s; j < s + l; j++) { const t = f[j]; f[j] = (t + f[j + l]) % Q; f[j + l] = z * (f[j + l] - t + Q) % Q; }
    }
    return f.map((a) => a * 3303 % Q);      // 3303 = 128⁻¹ mod q
  };
  // c += a ∘ b in the NTT domain (a may hold a 12-bit value up to 4095: everything stays below 2^31)
  const mac = (c, a, b) => {
    for (let i = 0; i < 256; i += 2) {
      const a0 = a[i], a1 = a[i + 1], b0 = b[i], b1 = b[i + 1];
      c[i] = (c[i] + a0 * b0 + a1 * b1 % Q * G[i >> 1]) % Q;
      c[i + 1] = (c[i + 1] + a0 * b1 + a1 * b0) % Q;
    }
  };
  // little-endian d-bit fields, 256 to a polynomial
  const enc = (f, d, o, at) => { let acc = 0, bits = 0; for (const x of f) { acc |= x << bits; for (bits += d; bits > 7; bits -= 8) { o[at++] = acc; acc >>>= 8; } } };
  const dec = (b, d, at) => {
    const f = P();
    for (let i = 0, acc = 0, bits = 0; i < 256; i++) { for (; bits < d; bits += 8) acc |= b[at++] << bits; f[i] = acc & (1 << d) - 1; acc >>>= d; bits -= d; }
    return f;
  };
  const cmp = (f, d) => f.map((x) => ((x << d) + 1664) / Q & (1 << d) - 1);     // round(2^d·x / q) mod 2^d
  const dcm = (f, d) => f.map((y) => y * Q + (1 << d - 1) >> d);                  // round(q·y / 2^d)
  // CBD η=2 of PRF(seed, n) = SHAKE256(seed ‖ n, 128 bytes)
  const cbd = (seed, n) => {
    const b = shake256(cat(seed, [n]), 128);
    return P().map((_, i) => { const x = b[i >> 1] >> 4 * (i & 1); return ((x & 1) + (x >> 1 & 1) - (x >> 2 & 1) - (x >> 3 & 1) + Q) % Q; });
  };
  // Â[i][j] = SampleNTT(ρ ‖ j ‖ i), kept as A[3i + j]: 12-bit candidates from SHAKE128, those below q taken
  const matrix = (rho) => {
    const A = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const sq = xof(168, 31, cat(rho, [j, i])), a = P();
      for (let n = 0; n < 256;) { const b = sq(3), d1 = b[0] | (b[1] & 15) << 8, d2 = b[1] >> 4 | b[2] << 4; if (d1 < Q) a[n++] = d1; if (d2 < Q && n < 256) a[n++] = d2; }
      A.push(a);
    }
    return A;
  };
  // K-PKE.Encrypt(ek, m, r) with ek expanded
  const encrypt = (x, m, r) => {
    const y = K3.map((i) => ntt(cbd(r, i))), c = new Uint8Array(1088), e2 = cbd(r, 6), mu = dec(m, 1, 0);
    let v = P();
    for (const i of K3) {
      let u = P();
      for (const j of K3) mac(u, x.A[3 * j + i], y[j]);
      const e1 = cbd(r, 3 + i);
      u = intt(u);
      enc(cmp(u.map((a, k) => (a + e1[k]) % Q), 10), 10, c, 320 * i);
      mac(v, x.t[i], y[i]);
    }
    v = intt(v);
    enc(cmp(v.map((a, k) => (a + e2[k] + mu[k] * 1665) % Q), 4), 4, c, 960);
    return c;
  };
  // K-PKE.Decrypt(ŝ, c)
  const decrypt = (s, c) => {
    let w = P();
    for (const i of K3) mac(w, s[i], ntt(dcm(dec(c, 10, 320 * i), 10)));
    w = intt(w);
    const m = new Uint8Array(32);
    enc(cmp(dcm(dec(c, 4, 960), 4).map((a, k) => (a - w[k] + Q) % Q), 1), 1, m, 0);
    return m;
  };
  // An encapsulation key (1184 B) or a decapsulation key (2400 B), checked, with its matrix sampled; encaps and decaps
  // take either the bytes or this. An encapsulation key with a coefficient ≥ q, or a decapsulation key whose H(ek) is
  // not its encapsulation key's hash, is refused (FIPS 203 §7.2, §7.3).
  const expand = (key) => {
    if (key && key.A) return key;
    const dk = key && key.length == 2400;
    if (!dk) need(key, 1184, 'an encapsulation key');
    const ek = (dk ? key.subarray(1152, 2336) : key).slice(), t = K3.map((i) => dec(ek, 12, 384 * i)), h = sha3_256(ek);
    if (!dk && t.some((p) => p.some((a) => a >= Q))) throw Error('ML-KEM: not an encapsulation key (a coefficient is not below q)');
    if (dk && h.some((b, i) => b != key[2336 + i])) throw Error('ML-KEM: not a decapsulation key (its hash does not match)');
    return { ek, t, h, A: matrix(ek.subarray(1152)), s: dk && K3.map((i) => dec(key, 12, 384 * i)), z: dk && key.slice(2368) };
  };
  // ML-KEM.KeyGen_internal(d, z)
  const keygen = (d, z) => {
    need(d, 32, 'd'); need(z, 32, 'z');
    const g = sha3_512(cat(d, [3])), rho = g.subarray(0, 32), A = matrix(rho), s = K3.map((i) => ntt(cbd(g.subarray(32), i)));
    const ek = new Uint8Array(1184), dk = new Uint8Array(2400);
    for (const i of K3) {
      const t = ntt(cbd(g.subarray(32), 3 + i));
      for (const j of K3) mac(t, A[3 * i + j], s[j]);
      enc(t, 12, ek, 384 * i); enc(s[i], 12, dk, 384 * i);
    }
    ek.set(rho, 1152); dk.set(ek, 1152); dk.set(sha3_256(ek), 2336); dk.set(z, 2368);
    return { ek, dk };
  };
  const keygenFromSeed = (seed) => { need(seed, 64, 'a seed'); return keygen(seed.subarray(0, 32), seed.subarray(32)); };
  // ML-KEM.Encaps_internal(ek, m)
  const encaps = (ek, m) => {
    need(m, 32, 'm');
    const x = expand(ek), g = sha3_512(cat(m, x.h));
    return { ct: encrypt(x, m, g.subarray(32)), ss: g.slice(0, 32) };
  };
  // ML-KEM.Decaps_internal(dk, c): K' when c re-encrypts to itself, else J(z ‖ c), picked by a mask
  const decaps = (dk, c) => {
    const x = expand(dk);
    if (!x.s) throw Error('ML-KEM: decaps needs a decapsulation key');
    need(c, 1088, 'a ciphertext');
    const m = decrypt(x.s, c), g = sha3_512(cat(m, x.h)), j = shake256(cat(x.z, c), 32), c2 = encrypt(x, m, g.subarray(32));
    let diff = 0;
    for (let i = 0; i < 1088; i++) diff |= c[i] ^ c2[i];
    const keep = diff - 1 >> 8;      // -1 when equal, else 0
    return g.slice(0, 32).map((b, i) => b & keep | j[i] & ~keep);
  };

  // ---- the backup phrase ----
  // A 32-byte root as 24 BIP39 words: the root, then the first byte of its SHA-256, in 11-bit words (no PBKDF2: the
  // phrase is the root). Read back as tacit.finance reads it: any case and spacing, and a word's first four letters are
  // enough. The English list is kept front-coded: each word is the count of letters it shares with the one before, then
  // the rest.
  const LIST = 'abandon2ility2le2out3ve2sent3orb3tract3urd2use1ccess3ident3ount3use2hieve2id2oustic2quire2ross2t3ion3or3ress3ual' +
    '1dapt2d3ict3ress2just2mit2ult2vance3ice1erobic1ffair3ord2raid1gain2e3nt2ree1head1im2r3port2sle1larm2bum2cohol2er' +
    't2ien2l3ey3ow2most2one2pha2ready2so2ter2ways1mateur3zing2ong3unt2used1nalyst2chor3ient2ger3le3ry2imal2kle2nounce' +
    '3ual2other2swer2tenna3ique2xiety2y1part2ology2pear3le3rove2ril1rch3tic2ea3na2gue2m3ed3or3y2ound2range3est3ive3ow' +
    '2t3efact3ist3work1sk2pect2sault3et3ist3ume2thma1thlete2om2tack3end3itude3ract1uction2dit2gust2nt2thor3o3umn1vera' +
    'ge2ocado3id1wake3re3y2esome2ful2kward1xis0baby2chelor3on2dge2g2lance3cony3l2mboo2nana3ner2r3ely3gain3rel2se3ic3k' +
    'et2ttle1each3n3uty2cause3ome2ef2fore2gin2have3ind2lieve3ow3t2nch3efit2st2tray3ter3ween2yond1icycle2d2ke2nd2ology' +
    '2rd3th2tter1lack3de3me3nket3st2eak3ss2ind2ood3ssom3use2ue3r3sh1oard3t2dy2il2mb2ne3us2ok3st2rder3ing3row2ss2ttom2' +
    'unce2x2y1racket3in3nd3ss3ve2ead3eze2ick3dge3ef3ght3ng3sk2occoli3ken3nze3om3ther3wn2ush1ubble2ddy3get2ffalo2ild2l' +
    'b3k3let2ndle3ker2rden3ger3st2s3iness3y2tter2yer2zz0cabbage3in3le2ctus2ge2ke2ll3m2mera3p2n3al3cel3dy3non3oe3vas3y' +
    'on2pable3ital3tain2r3bon3d3go3pet3ry3t2se3h3ino3tle3ual2t3alog3ch3egory3tle2ught3se3tion2ve1eiling2lery2ment2nsu' +
    's3tury2real3tain1hair3lk3mpion3nge3os3pter3rge3se3t2eap3ck3ese3f3rry3st2icken3ef3ld3mney2oice3ose2ronic2uckle3nk' +
    '3rn1igar2nnamon2rcle2tizen3y2vil1laim3p3rify3w3y2ean3rk3ver2ick3ent3ff3mb3nic3p2ock3g3se3th3ud3wn2ub3mp3ster3tch' +
    '1oach3st2conut2de2ffee2il3n2llect3or3umn2mbine3e3fort3ic3mon3pany2ncert3duct3firm3gress3nect3sider3trol3vince2ok' +
    '3l2pper3y2ral3e3n3rect2st2tton2uch3ntry3ple3rse3sin2ver2yote1rack3dle3ft3m3ne3sh3ter3wl3zy2eam3dit3ek3w2icket3me' +
    '3sp3tic2op3ss3uch3wd2ucial3el3ise3mble3nch3sh2y3stal1ube2lture2p3board2rious3rent3tain3ve2shion3tom2te1ycle0dad2' +
    'mage3p2nce3ger2ring2sh2ughter2wn2y1eal2bate3ris2cade3ember3ide3line3orate3rease2er2fense3ine3y2gree2lay3iver2man' +
    'd3ise2nial3tist3y2part3end3osit3th3uty2rive2scribe3ert3ign3k3pair3troy2tail3ect2velop3ice3ote1iagram3l3mond3ry2c' +
    'e2esel3t2ffer2gital3nity2lemma2nner3osaur2rect3t2sagree3cover3ease3h3miss3order3play3tance2vert3ide3orce2zzy1oct' +
    'or3ument2g2ll3phin2main2nate3key3or2or2se2uble2ve1raft3gon3ma3stic3w2eam3ss2ift3ll3nk3p3ve2op2um2y1uck2mb2ne2rin' +
    'g2st2tch3y1warf1ynamic0eager3le2rly3n3th2sily3t3y1cho2ology3nomy1dge2it2ucate1ffort1gg1ight2ther1lbow2der2ectric' +
    '3gant3ment3phant3vator2ite2se1mbark3ody3race2erge2otion2ploy3ower3ty1nable3ct2d3less3orse2emy3rgy2force2gage3ine' +
    '2hance2joy2list2ough2rich3oll2sure2ter3ire3ry2velope1pisode1qual3ip1ra3se2ode3sion2ror2upt1scape2say3ence2tate1t' +
    'ernal2hics1vidence3l2oke3lve1xact3mple2cess3hange3ite3lude3use2ecute3rcise2haust3ibit2ile3st3t2otic2pand3ect3ire' +
    '3lain3ose3ress2tend3ra1ye3brow0fabric2ce3ulty2de2int3th2ll3se2me3ily3ous2n3cy3tasy2rm2shion2t3al3her3igue2ult2vo' +
    'rite1eature2bruary2deral2e3d3l2male2nce2stival2tch2ver2w1iber2ction2eld2gure2le3m3ter2nal3d3e3ger3ish2re3m3st2sc' +
    'al3h2t3ness2x1lag3me3sh3t3vor2ee2ight3p2oat3ck3or3wer2uid3sh2y1oam2cus2g2il2ld3low2od3t2rce3est3get3k3tune3um3wa' +
    'rd2ssil3ter2und2x1ragile3me2equent3sh2iend3nge2og3nt3st3wn3zen2uit1uel2n3ny2rnace3y2ture0gadget2in2laxy3lery2me2' +
    'p2rage3bage3den3lic3ment2s3p2te3her2uge2ze1eneral3ius3re3tle3uine2sture1host1iant2ft2ggle2nger2raffe3l2ve1lad3nc' +
    'e3re3ss2ide3mpse2obe3om3ry3ve3w2ue1oat2ddess2ld2od3se2rilla2spel3sip2vern2wn1rab3ce3in3nt3pe3ss3vity2eat3en2id3e' +
    'f3t2ocery3up3w2unt1uard2ess2ide3lt3tar2n1ym0habit2ir2lf2mmer3ster2nd2ppy2rbor3d3sh3vest2t2ve2wk2zard1ead3lth3rt3' +
    'vy2dgehog2ight2llo3met3p2n2ro1idden2gh2ll2nt2p2re2story1obby2ckey2ld3e3iday3low2me2ney2od2pe2rn3ror3se2spital3t2' +
    'tel2ur2ver1ub2ge2man3ble3or2ndred3gry3t2rdle3ry3t2sband1ybrid0ice2on1dea3ntify2le1gnore1ll3egal3ness1mage2itate2' +
    'mense3une2pact3ose3rove3ulse1nch3lude3ome3rease2dex3icate3oor3ustry2fant3lict3orm2hale3erit2itial2ject3ury2mate2' +
    'ner3ocent2put2quiry2sane3ect3ide3pire3tall2tact3erest3o2vest3ite3olve1ron1sland2olate2sue1tem1vory0jacket2guar2r' +
    '2zz1ealous3ns2lly2wel1ob2in2ke2urney2y1udge2ice2mp2ngle3ior3k2st0kangaroo1een3p2tchup2y1ick2d3ney2nd3gdom2ss2t3c' +
    'hen3e3ten2wi1nee2ife2ock3w0lab3el3or2dder3y2ke2mp2nguage2ptop2rge2ter3in2ugh3ndry2va2w3n3suit2yer2zy1eader3f3rn3' +
    've2cture2ft2g3al3end2isure2mon2nd3gth3s2opard2sson2tter2vel1iar2berty3rary2cense2fe3t2ght2ke2mb3it2nk2on2quid2st' +
    '2ttle2ve2zard1oad3n2bster2cal3k2gic2nely3g2op2ttery2ud3nge2ve2yal1ucky2ggage2mber2nar3ch2xury1yrics0machine2d2gi' +
    'c3net2id3l3n2jor2ke2mmal2n3age3date3go3sion3ual2ple2rble3ch3gin3ine3ket3riage2sk3s3ter2tch3erial3h3rix3ter2ximum' +
    '2ze1eadow3n3sure3t2chanic2dal3ia2lody3t2mber3ory2ntion3u2rcy3ge3it3ry2sh3sage2tal3hod1iddle3night2lk3lion2mic2nd' +
    '3imum3or3ute2racle3ror2sery3s3take2x3ed3ture1obile2del3ify2m3ent2nitor3key3ster3th2on2ral3e3ning2squito2ther3ion' +
    '3or2untain3se2ve3ie1uch2ffin2le3tiply2scle3eum3hroom3ic3t2tual1yself3tery2th0naive2me2pkin2rrow2sty2tion3ure1ear' +
    '2ck2ed2gative3lect2ither2phew2rve2st2t3work2utral2ver2ws2xt1ice2ght1oble2ise2minee2odle2rmal3th2se2table3e3hing3' +
    'ice2vel2w1uclear2mber2rse2t0oak1bey2ject2lige2scure3erve2tain2vious1ccur2ean2tober1dor1ff3er3ice2ten1il1kay1ld2i' +
    've2ympic1mit1nce2e2ion2line3y1pen3ra2inion2pose2tion1range2bit2chard2der3inary2gan2ient3ginal2phan1strich1ther1u' +
    'tdoor3er3put3side1val2en3r1wn3er1xygen1yster1zone0pact2ddle2ge2ir2lace3m2nda3el3ic3ther2per2rade3ent3k3rot3ty2ss' +
    '2tch3h3ient3rol3tern2use2ve2yment1eace3nut3r3sant2lican2n3alty3cil2ople2pper2rfect3mit3son2t1hone3to2rase2ysical' +
    '1iano2cnic3ture2ece2g3eon2ll3ot2nk2oneer2pe2stol2tch2zza1lace3net3stic3te3y2ease3dge2uck3g3nge1oem3t2int2lar3e3i' +
    'ce2nd3y2ol2pular2rtion2sition3sible3t2tato3tery2verty2wder3er1ractice3ise2edict3fer3pare3sent3tty3vent2ice3de3ma' +
    'ry3nt3ority3son3vate3ze2oblem3cess3duce3fit3gram3ject3mote3of3perty3sper3tect3ud3vide1ublic2dding2ll3p3se2mpkin2' +
    'nch2pil3py2rchase3ity3pose3se2sh2t2zzle1yramid0quality3ntum3rter2estion2ick3t3z2ote0rabbit2ccoon3e3k2dar3io2il3n' +
    '3se2lly2mp2nch3dom3ge2pid2re2te3her2ven2w2zor1eady3l3son2bel3uild2call3eive3ipe3ord3ycle2duce2flect3orm3use2gion' +
    '3ret3ular2ject2lax3ease3ief3y2main3ember3ind3ove2nder3ew3t2open2pair3eat3lace3ort2quire2scue3emble3ist3ource3pon' +
    'se3ult2tire3reat3urn2union2veal3iew2ward1hythm1ib3bon2ce3h2de3ge2fle2ght3id2ng2ot2pple2sk2tual2val3er1oad3st2bot' +
    '3ust2cket2mance2of3kie3m2se2tate2ugh3nd3te2yal1ubber2de2g2le2n3way2ral0sad3dle3ness2fe2il2lad3mon3on3t3ute2me3pl' +
    'e2nd2tisfy3oshi2uce3sage2ve2y1cale3n3re3tter2ene2heme3ool2ience3ssors2orpion3ut2rap3een3ipt3ub1ea3rch3son3t2cond' +
    '3ret3tion3urity2ed3k2gment2lect3l2minar2nior3se3tence2ries3vice2ssion2ttle3up2ven1hadow3ft3llow3re2ed3ll3riff2ie' +
    'ld3ft3ne3p3ver2ock3e3ot3p3rt3ulder3ve2rimp3ug2uffle2y1ibling2ck2de2ege2ght3n2lent3k3ly3ver2milar3ple2nce3g2ren2s' +
    'ter2tuate2x2ze1kate2etch2i3ll3n3rt2ull1lab3m2eep3nder2ice3de3ght3m2ogan3t3w2ush1mall3rt2ile2oke3oth1nack3ke3p2if' +
    'f2ow1oap2ccer3ial3k2da2ft2lar3dier3id3ution3ve2meone2ng2on2rry3t2ul3nd3p3rce3th1pace3re3tial3wn2eak3cial3ed3ll3n' +
    'd2here2ice3der3ke3n3rit2lit2oil3nsor3on3rt3t2ray3ead3ing2y1quare3eeze3irrel1table3dium3ff3ge3irs3mp3nd3rt3te3y2e' +
    'ak3el3m3p3reo2ick3ll3ng2ock3mach3ne3ol3ry3ve2rategy3eet3ike3ong3uggle2udent3ff3mble2yle1ubject3mit3way2ccess3h2d' +
    'den2ffer2gar3gest2it2mmer2n3ny3set2per3ply3reme2re3face3ge3prise3round3vey2spect3tain1wallow3mp3p3rm2ear3et2ift3' +
    'm3ng3tch2ord1ymbol3ptom2rup2stem0table2ckle2g2il2lent3k2nk2pe2rget2sk3te2ttoo2xi1each3m2ll2n3ant3nis3t2rm2st2xt1' +
    'hank3t2eme3n3ory3re3y2ing3s2ought2ree3ive3ow2umb3nder1icket2de2ger2lt2mber3e2ny2p2red2ssue2tle1oast2bacco2day3dl' +
    'er2e2gether2ilet2ken2mato3orrow2ne3gue3ight2ol3th2p3ic3ple2rch3nado3toise2ss2tal2urist2ward3er3n2y1rack3de3ffic3' +
    'gic3in3nsfer3p3sh3vel3y2eat3e3nd2ial3be3ck3gger3m3p2ophy3uble2uck3e3ly3mpet3st3th2y1ube2ition2mble2na3nel2rkey3n' +
    '3tle1welve3nty2ice3n3st2o1ype3ical0ugly1mbrella1nable3ware2cle3over2der3o2fair3old2happy2iform3que3t3verse2known' +
    '2lock2til2usual2veil1pdate2grade2hold2on2per2set1rban2ge1sage2e3d3ful3less2ual1tility0vacant3uum2gue2lid3ley3ve2' +
    'n3ish2por2rious2st2ult1ehicle2lvet2ndor3ture3ue2rb3ify3sion3y2ssel2teran1iable2brant2cious3tory2deo2ew2llage2nta' +
    'ge2olin2rtual3us2sa3it3ual2tal2vid1ocal2ice3d2lcano3ume2te2yage0wage3on2it2lk3l3nut2nt2rfare3m3rior2sh3p3te2ter2' +
    've2y1ealth3pon3r3sel3ther2b2dding2ekend2ird2lcome2st2t1hale3t2eat3el3n3re2ip3sper1ide3th2fe2ld3l2n3dow3e3g3k3ner' +
    '3ter2re2sdom3e3h2tness1olf2man2nder2od3l2rd3k3ld3ry3th1rap2eck3stle2ist3te2ong0yard1ear2llow1ou3ng3th0zebra2ro1o' +
    'ne2o';
  let W;
  const words = () => {
    if (!W) { W = []; let w = ''; for (const [, n, s] of LIST.matchAll(/(\d?)([a-z]+)/g)) W.push(w = w.slice(0, +n) + s); }
    return W;
  };
  // root (32 bytes) → 24 words, space-separated
  const phraseOf = (root) => {
    if (!ArrayBuffer.isView(root) || root.length != 32) throw Error('a root is 32 bytes');
    const b = [...root, sha256(root)[0]].map((x) => x.toString(2).padStart(8, 0)).join('');
    return Array.from({ length: 24 }, (_, i) => words()[parseInt(b.slice(11 * i, 11 * i + 11), 2)]).join(' ');
  };
  // 24 words → the root, or null (a count other than 24, a word not on the list, or a check that does not match)
  const rootOf = (text) => {
    const ws = String(text || '').toLowerCase().split(/[^a-z]+/).filter(Boolean), L = words();
    if (ws.length != 24) return null;
    let b = '';
    for (const w of ws) {
      let i = L.indexOf(w);
      if (i < 0 && w.length > 3) i = L.findIndex((x) => x.startsWith(w.slice(0, 4)));
      if (i < 0) return null;
      b += i.toString(2).padStart(11, 0);
    }
    const root = Uint8Array.from({ length: 32 }, (_, i) => parseInt(b.slice(8 * i, 8 * i + 8), 2));
    return parseInt(b.slice(256), 2) == sha256(root)[0] ? root : null;
  };

  return {
    keygen, keygenFromSeed, expand, encaps, decaps, sha3_256, sha3_512, shake128, shake256,
    shake128x: (m) => xof(168, 31, m), shake256x: (m) => xof(136, 31, m), phraseOf, rootOf, words,
  };
})();
