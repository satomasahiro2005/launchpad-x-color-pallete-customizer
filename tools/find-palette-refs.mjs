// Locate every place the firmware reads the 128-colour RGB palette and report
// the constant palette indices each site uses, with file offsets so they can be
// turned into editable targets.
//
//   node tools/find-palette-refs.mjs [firmware.bin] [baseHex] [paletteOffHex]
//   defaults: firmware.bin  0x0800C000  0x12034
//
// Method: find PC-relative literals equal to the palette runtime address
// (base + paletteOffset), then for each loader track the palette-base register
// (and pointers derived from it via add) and decode constant ldr/ldrb/add
// accesses into palette indices.
import { readFile } from "node:fs/promises";

const [, , binPath = "firmware.bin", baseArg = "0x0800C000", palArg = "0x12034"] = process.argv;
const B = Number(baseArg);
const PAL = Number(palArg);
const fw = new Uint8Array(await readFile(binPath));
const size = fw.length;
const u16 = (o) => (fw[o] | (fw[o + 1] << 8));
const u32 = (o) => (fw[o] | (fw[o + 1] << 8) | (fw[o + 2] << 16) | (fw[o + 3] << 24)) >>> 0;
const paletteRT = (B + PAL) >>> 0;

// Decode a Thumb-2 12-bit modified immediate (used by add.w T3).
function t2mod(i) {
  const a = (i >> 8) & 0xf;
  const b = i & 0xff;
  if (a < 4) return [b, (b << 16) | b, (b << 24) | (b << 8), (b << 24) | (b << 16) | (b << 8) | b][a] >>> 0;
  const v = 0x80 | (i & 0x7f);
  const rot = (i >> 7) & 0x1f;
  return ((v >>> rot) | (v << (32 - rot))) >>> 0;
}

// All literal-pool words pointing at the palette base = the renderer sites.
const sites = [];
for (let o = 0; o + 4 <= size; o += 4) if (u32(o) === paletteRT) sites.push(o);

console.log(`palette runtime addr: 0x${paletteRT.toString(16)} (base 0x${B.toString(16)} + 0x${PAL.toString(16)})`);
console.log(`literal-pool references (renderer sites): ${sites.length}`);

for (const lit of sites) {
  const litRT = lit + B;
  console.log(`\n#### palette literal @ file 0x${lit.toString(16)} (rt 0x${litRT.toString(16)})`);
  // Find loaders (T1 ldr / T2 ldr.w pc-relative) that target this literal.
  for (let o = 0; o + 2 <= size; o += 2) {
    const w = u16(o);
    let rt = -1;
    if ((w & 0xf800) === 0x4800) {
      const pc = (o + B + 4) & ~3;
      if (pc + (w & 0xff) * 4 === litRT) rt = (w >> 8) & 7;
    } else if (w === 0xf8df) {
      const w2 = u16(o + 2);
      const pc = (o + B + 4) & ~3;
      if (pc + (w2 & 0xfff) === litRT) rt = (w2 >> 12) & 0xf;
    }
    if (rt < 0) continue;

    // Track palette-base-derived registers across a short forward window.
    const derived = { [rt]: 0 };
    const found = [];
    for (let p = o + 2; p < o + 0x140 && p + 2 <= size; p += 2) {
      const x = u16(p);
      if ((x & 0xf800) === 0x6800) { // ldr rd,[rn,#imm5*4]
        const rn = (x >> 3) & 7, imm = ((x >> 6) & 0x1f) * 4;
        if (rn in derived) found.push({ p, kind: "ldr", idx: (derived[rn] + imm) / 4 });
      } else if ((x & 0xf800) === 0x7800) { // ldrb rd,[rn,#imm5]
        const rn = (x >> 3) & 7, imm = (x >> 6) & 0x1f;
        if (rn in derived) found.push({ p, kind: "ldrb", idx: ((derived[rn] + imm) / 4) | 0 });
      } else if ((x & 0xfff0) === 0xf8d0) { // ldr.w rd,[rn,#imm12]
        const w2 = u16(p + 2), rn = x & 0xf, imm = w2 & 0xfff;
        if (rn in derived) found.push({ p, kind: "ldr.w", idx: (derived[rn] + imm) / 4 });
      } else if ((x & 0xfbf0) === 0xf100 || (x & 0xfbf0) === 0xf200) { // add(w) rd,rn,#imm
        const w2 = u16(p + 2), rn = x & 0xf, rd = (w2 >> 8) & 0xf;
        const enc = (((x >> 10) & 1) << 11) | (((w2 >> 12) & 7) << 8) | (w2 & 0xff);
        const imm = (x & 0xfbf0) === 0xf200 ? enc : t2mod(enc); // T4 raw imm12 vs T3 modified
        if (rn in derived) { derived[rd] = derived[rn] + imm; found.push({ p, kind: "add", idx: (derived[rn] + imm) / 4 }); }
      }
    }
    const consts = found.filter((f) => Number.isInteger(f.idx) && f.idx >= 0 && f.idx < 128);
    console.log(`  loader 0x${(o + B).toString(16)} -> r${rt}`);
    for (const f of consts) {
      console.log(`    ${f.kind.padEnd(5)} @ file 0x${f.p.toString(16)} -> palette idx 0x${f.idx.toString(16)}`);
    }
    if (!consts.length) console.log("    (variable index only: host/RAM/table-driven)");
  }
}
