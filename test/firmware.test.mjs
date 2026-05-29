import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PALETTE, DEFAULT_NOTE_TABLE, NOTE_ROLES, toHex,
  parsePaletteFile, extractPalette, extractNoteTable,
  buildPatchedFirmware, buildSysexFirmware, decodeSysexFirmware, firmwareHash,
} from "../firmware.js";

const PALETTE_OFFSET = 0x12034;

function makeStockFirmware() {
  const fw = new Uint8Array(0x13000);
  // verifyLpx422Layout expects these instruction-opcode bytes intact:
  fw[0x0d127] = 0x20; fw[0x0d129] = 0x22; fw[0x0d12f] = 0x20; fw[0x0d131] = 0x22;
  // 0x12034..37 are already 0 (Uint8Array). Leave them.
  return fw;
}

const fakeFile = (text) => ({ text: async () => text });
function paletteText(palette) {
  return palette.map((rgb, i) => `${i}, ${rgb[0]} ${rgb[1]} ${rgb[2]};`).join("\n");
}

test("DEFAULT_PALETTE is 128 RGB triples in 0..63", () => {
  assert.equal(DEFAULT_PALETTE.length, 128);
  for (const rgb of DEFAULT_PALETTE) {
    assert.equal(rgb.length, 3);
    assert.ok(rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 63));
  }
});

test("DEFAULT_NOTE_TABLE has the four roles with stock indices", () => {
  assert.deepEqual(Object.keys(DEFAULT_NOTE_TABLE).sort(), ["accent", "off", "root", "scale"]);
  assert.equal(DEFAULT_NOTE_TABLE.root, 0x5e);
  assert.equal(DEFAULT_NOTE_TABLE.scale, 0x24);
  assert.equal(DEFAULT_NOTE_TABLE.off, 0x00);
  assert.equal(DEFAULT_NOTE_TABLE.accent, 0x15);
  assert.equal(NOTE_ROLES.length, 4);
});

test("toHex pads to two digits", () => {
  assert.equal(toHex(0), "00");
  assert.equal(toHex(5), "05");
  assert.equal(toHex(255), "ff");
});

test("parsePaletteFile parses a complete 128-entry file", async () => {
  const palette = Array.from({ length: 128 }, (_, i) => [i % 64, (i * 2) % 64, (i * 3) % 64]);
  const parsed = await parsePaletteFile(fakeFile(paletteText(palette)));
  assert.deepEqual(parsed, palette);
});

test("parsePaletteFile rejects an incomplete file", async () => {
  const text = Array.from({ length: 100 }, (_, i) => `${i}, 0 0 0;`).join("\n");
  await assert.rejects(() => parsePaletteFile(fakeFile(text)), /incomplete/i);
});

test("parsePaletteFile rejects out-of-range channels", async () => {
  const palette = Array.from({ length: 128 }, () => [0, 0, 0]);
  let text = paletteText(palette).replace("0, 0 0 0;", "0, 99 0 0;"); // 99 > 63
  await assert.rejects(() => parsePaletteFile(fakeFile(text)), /out of range/i);
});

test("buildPatchedFirmware + extractPalette round-trips the palette", () => {
  const stock = makeStockFirmware();
  const palette = Array.from({ length: 128 }, (_, i) => [(i) % 64, (63 - i % 64), (i * 5) % 64]);
  palette[0] = [0, 0, 0]; // a valid LPX image keeps palette index 0 = off (0,0,0)
  const table = { root: 30, scale: 5, off: 0, accent: 21 };
  const patched = buildPatchedFirmware({ stockFirmware: stock, table, palette });
  assert.deepEqual(extractPalette(patched), palette);
});

test("buildPatchedFirmware writes the note table at the instruction immediates", () => {
  const stock = makeStockFirmware();
  const palette = DEFAULT_PALETTE.map((c) => [...c]);
  const table = { root: 40, scale: 41, off: 42, accent: 43 };
  const patched = buildPatchedFirmware({ stockFirmware: stock, table, palette });
  assert.deepEqual(extractNoteTable(patched), table);
});

test("patched palette byte layout is B,G,R,0 each shifted <<2", () => {
  const stock = makeStockFirmware();
  const palette = DEFAULT_PALETTE.map((c) => [...c]);
  palette[7] = [63, 31, 15];
  const patched = buildPatchedFirmware({ stockFirmware: stock, table: DEFAULT_NOTE_TABLE, palette });
  const o = PALETTE_OFFSET + 7 * 4;
  assert.equal(patched[o], 15 << 2);     // B
  assert.equal(patched[o + 1], 31 << 2); // G
  assert.equal(patched[o + 2], 63 << 2); // R
  assert.equal(patched[o + 3], 0);
});

test("buildPatchedFirmware does not mutate the stock firmware", () => {
  const stock = makeStockFirmware();
  const before = Uint8Array.from(stock);
  buildPatchedFirmware({ stockFirmware: stock, table: DEFAULT_NOTE_TABLE, palette: DEFAULT_PALETTE });
  assert.deepEqual(stock, before);
});

test("SysEx encode → decode round-trips the firmware bytes", () => {
  const firmware = new Uint8Array(300);
  for (let i = 0; i < firmware.length; i++) firmware[i] = (i * 37 + 11) & 0xff;
  const syx = buildSysexFirmware(firmware);
  assert.equal(syx[0], 0xf0);
  assert.equal(syx[syx.length - 1], 0xf7);
  const decoded = decodeSysexFirmware(syx);
  assert.deepEqual(decoded, firmware);
});

test("decodeSysexFirmware throws on a CRC mismatch", () => {
  const firmware = new Uint8Array(64).map((_, i) => i);
  const syx = Array.from(buildSysexFirmware(firmware));
  // corrupt a data byte inside a block message (after the headers)
  syx[120] ^= 0x01;
  assert.throws(() => decodeSysexFirmware(new Uint8Array(syx)), /CRC|blocks/i);
});

test("firmwareHash returns a 64-char hex digest", async () => {
  const hash = await firmwareHash(new Uint8Array([1, 2, 3, 4]));
  assert.match(hash, /^[0-9a-f]{64}$/);
});
