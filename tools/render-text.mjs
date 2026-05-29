// Render text using the Launchpad X firmware's built-in 8px bitmap font, the
// same one the device uses for the Settings labels (LED/VEL/AFT/FAD) and the
// scrolling mode messages (Live/Programmer/Legacy). Useful for "recording" what
// a text screen looks like on the 8x8 grid.
//
//   node tools/render-text.mjs <firmware.bin> "TEXT" [baseHex]
//   defaults: base 0x0800C000
//
// Font tables (resolved from the glyph renderer at runtime 0x800EF58):
//   per-char u16 offset table  -> palette+0x9d0  (file 0x12a04)
//   glyph column bytes (8px)   -> file 0x12234   (right after the RGB palette)
//   per-char width table (&0x3f) -> file 0x13174
// Each glyph column is one byte = 8 vertical pixels (bit7 = top row).
import { readFile } from "node:fs/promises";

const [, , binPath = "firmware.bin", text = "LED", baseArg = "0x0800C000"] = process.argv;
const B = Number(baseArg);
const b = new Uint8Array(await readFile(binPath));
const u32 = (o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16 = (o) => b[o] | (b[o + 1] << 8);

// Resolve the three font tables from the literals next to the renderer, so this
// keeps working if offsets shift between firmware revisions.
const OFF = u32(0x800f104 - B) - B; // per-char u16 offset table
const GLY = u32(0x800f108 - B) - B; // glyph column data
const WID = u32(0x800f10c - B) - B; // per-char width table

function glyph(ch) {
  const idx = ch.charCodeAt(0) - 32;
  if (idx < 0 || idx >= 96) return [];
  const off = u16(OFF + idx * 2);
  const width = b[WID + idx] & 0x3f;
  const cols = [];
  for (let i = 0; i < width; i++) cols.push(b[GLY + off + i]);
  return cols;
}

const cols = [];
for (const ch of text) {
  for (const c of glyph(ch)) cols.push(c);
  cols.push(0); // 1px gap between glyphs
}

for (let row = 0; row < 8; row++) {
  let line = "";
  for (const c of cols) line += (c >> (7 - row)) & 1 ? "#" : ".";
  console.log(line);
}
