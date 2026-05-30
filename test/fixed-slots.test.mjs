import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PALETTE, DEFAULT_NOTE_TABLE,
  thumbExpandEncode, isFixedSlotReachable, FIXED_SLOT_DEFAULTS,
  buildPatchedFirmware, extractFixedSlotIndex,
} from "../firmware.js";

// Stock firmware with the real tab/transpose instruction encodings at the
// documented offsets (bytes confirmed against arm-none-eabi-objdump).
function makeStock() {
  const fw = new Uint8Array(0x13000);
  fw[0x0d127] = 0x20; fw[0x0d129] = 0x22; fw[0x0d12f] = 0x20; fw[0x0d131] = 0x22;
  const put = (o, bytes) => bytes.forEach((b, k) => (fw[o + k] = b));
  put(0x924a, [0x31, 0x68]);             // ldr  r1,[r6,#0]      tab-disabled 0x00
  put(0x9252, [0xd6, 0xf8, 0x04, 0x80]); // ldr.w r8,[r6,#4]     tab-idle 0x01
  put(0x9266, [0x37, 0x6f]);             // ldr  r7,[r6,#0x70]   tab-selected 0x1c
  put(0xcdba, [0x05, 0xf5, 0xbc, 0x74]); // add.w r4,r5,#0x178   transpose-a-base 0x5e
  put(0xce86, [0x61, 0x68]);             // ldr  r1,[r4,#4]      a-blend (base+1) 0x5f
  put(0xce14, [0x05, 0xf1, 0x90, 0x06]); // add.w r6,r5,#0x90    transpose-b-base 0x24
  put(0xce30, [0x71, 0x6a]);             // ldr  r1,[r6,#0x24]   b-blend (base+9) 0x2d
  return fw;
}
const base = () => ({ stockFirmware: makeStock(), table: DEFAULT_NOTE_TABLE, palette: DEFAULT_PALETTE });

test("ThumbExpandImm encoder is correct for plain, replicated and rotated values", () => {
  // round-trip a sample of idx×4 values through encode + the inverse used by reads
  const decode = (e) => {
    const ctrl = (e.i << 3) | e.imm3;
    if (ctrl === 0) return e.imm8;
    if (ctrl === 3) return ((e.imm8 << 24) | (e.imm8 << 16) | (e.imm8 << 8) | e.imm8) >>> 0;
    const rot = (ctrl << 1) | (e.imm8 >> 7), b = 0x80 | (e.imm8 & 0x7f);
    return ((b >>> rot) | (b << (32 - rot))) >>> 0;
  };
  for (let idx = 0; idx <= 127; idx++) {
    const e = thumbExpandEncode(idx << 2);
    if (e) assert.equal(decode(e), idx << 2, `idx ${idx}`);
  }
  assert.equal(thumbExpandEncode(0x5e << 2) === null, false); // 0x178 encodable
});

test("FIXED_SLOT_DEFAULTS match the stock encodings read back", () => {
  const stock = makeStock();
  for (const id of Object.keys(FIXED_SLOT_DEFAULTS)) {
    assert.equal(extractFixedSlotIndex(stock, id), FIXED_SLOT_DEFAULTS[id], id);
  }
});

test("isFixedSlotReachable enforces the per-form ranges", () => {
  // 16-bit ldr tabs: idx 0..31 only
  assert.equal(isFixedSlotReachable("tab-selected", 31), true);
  assert.equal(isFixedSlotReachable("tab-selected", 32), false);
  // ldr.w tab-idle: full palette
  assert.equal(isFixedSlotReachable("tab-idle", 120), true);
  // add.w base: only encodable idx×4
  assert.equal(isFixedSlotReachable("transpose-a-base", 40), true);
  assert.equal(isFixedSlotReachable("transpose-a-base", 70), true); // 280 via rotation
  // blends are relative to their base (default 0x5e): base..base+31
  assert.equal(isFixedSlotReachable("transpose-a-blend", 0x5e + 31), true);
  assert.equal(isFixedSlotReachable("transpose-a-blend", 0x5e + 32), false);
  assert.equal(isFixedSlotReachable("transpose-a-blend", 0x5e - 1), false);
});

test("buildPatchedFirmware re-points absolute tab slots and reads back", () => {
  const patched = buildPatchedFirmware({ ...base(), slots: { "tab-selected": 30, "tab-idle": 100, "tab-disabled": 7 } });
  assert.equal(extractFixedSlotIndex(patched, "tab-selected"), 30);
  assert.equal(extractFixedSlotIndex(patched, "tab-idle"), 100);
  assert.equal(extractFixedSlotIndex(patched, "tab-disabled"), 7);
});

test("buildPatchedFirmware re-points add.w transpose bases (incl. rotated immediate)", () => {
  const patched = buildPatchedFirmware({ ...base(), slots: { "transpose-a-base": 40, "transpose-b-base": 70 } });
  assert.equal(extractFixedSlotIndex(patched, "transpose-a-base"), 40);
  assert.equal(extractFixedSlotIndex(patched, "transpose-b-base"), 70);
});

test("re-pointing a transpose blend stays relative to its base", () => {
  // move A base to 40 and A blend to 45 -> blend offset = +5 from base
  const patched = buildPatchedFirmware({ ...base(), slots: { "transpose-a-base": 40, "transpose-a-blend": 45 } });
  assert.equal(extractFixedSlotIndex(patched, "transpose-a-base"), 40);
  assert.equal(extractFixedSlotIndex(patched, "transpose-a-blend"), 45);
});

test("buildPatchedFirmware refuses an out-of-range / non-encodable re-point", () => {
  assert.throws(() => buildPatchedFirmware({ ...base(), slots: { "tab-selected": 40 } }), /range/i);
  assert.throws(() => buildPatchedFirmware({ ...base(), slots: { "transpose-a-blend": 0x5e + 40 } }), /range/i);
});

test("no slots => instructions are untouched (defaults preserved)", () => {
  const patched = buildPatchedFirmware(base());
  for (const id of Object.keys(FIXED_SLOT_DEFAULTS)) {
    assert.equal(extractFixedSlotIndex(patched, id), FIXED_SLOT_DEFAULTS[id], id);
  }
});
