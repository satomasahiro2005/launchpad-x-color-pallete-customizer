// LPX 422 stores the four Note color defaults as instruction immediates in
// the app image. These are file offsets, not runtime addresses.
const NOTE_TABLE_OFFSETS = [0x0d126, 0x0d128, 0x0d12e, 0x0d130];
const PALETTE_OFFSET = 0x12034;
const FAMILY_ID = 0x02;
const PRODUCT_ID = 0x0c;
const BLOCK_BITS = 0x100;
const BLOCK_BYTES = Math.ceil(BLOCK_BITS / 8);
const BLOCK_7BIT_BYTES = Math.ceil(BLOCK_BITS / 7);
const VERSION_DIGITS = [0x04, 0x02, 0x02];
const NOVATION_HEADER = [0x00, 0x20, 0x29, 0x00];

export const NOTE_ROLES = [
  {
    id: "root",
    label: "Root",
    description: "Root note color. Stock index 0x5e.",
    defaultIndex: 0x5e,
  },
  {
    id: "scale",
    label: "Scale",
    description: "In-scale note color. Stock index 0x24.",
    defaultIndex: 0x24,
  },
  {
    id: "off",
    label: "Off",
    description: "Out-of-scale note color. Stock index 0x00.",
    defaultIndex: 0x00,
  },
  {
    id: "accent",
    label: "Accent",
    description: "Accent color. Stock index 0x15.",
    defaultIndex: 0x15,
  },
];

export const DEFAULT_NOTE_TABLE = NOTE_ROLES.reduce((result, role) => {
  result[role.id] = role.defaultIndex;
  return result;
}, {});

export const DEFAULT_PALETTE = [
  [0, 0, 0],
  [16, 16, 16],
  [32, 32, 32],
  [63, 63, 63],
  [63, 15, 15],
  [63, 0, 0],
  [32, 0, 0],
  [16, 0, 0],
  [63, 46, 26],
  [63, 15, 0],
  [32, 8, 0],
  [16, 4, 0],
  [63, 43, 11],
  [63, 63, 0],
  [32, 32, 0],
  [16, 16, 0],
  [33, 63, 12],
  [20, 63, 0],
  [10, 32, 0],
  [5, 16, 0],
  [18, 63, 18],
  [0, 63, 0],
  [0, 32, 0],
  [0, 16, 0],
  [18, 63, 23],
  [0, 63, 6],
  [0, 32, 3],
  [0, 16, 1],
  [18, 63, 22],
  [0, 63, 21],
  [0, 32, 11],
  [0, 16, 6],
  [18, 63, 45],
  [0, 63, 37],
  [0, 32, 18],
  [0, 16, 9],
  [18, 48, 63],
  [0, 41, 63],
  [0, 21, 32],
  [0, 11, 16],
  [18, 33, 63],
  [0, 21, 63],
  [0, 11, 32],
  [0, 6, 16],
  [11, 9, 63],
  [0, 0, 63],
  [0, 0, 32],
  [0, 0, 16],
  [26, 13, 62],
  [11, 0, 63],
  [6, 0, 32],
  [3, 0, 16],
  [63, 15, 63],
  [63, 0, 63],
  [32, 0, 32],
  [16, 0, 16],
  [63, 16, 27],
  [63, 0, 20],
  [32, 0, 10],
  [16, 0, 5],
  [63, 3, 0],
  [37, 13, 0],
  [29, 20, 0],
  [8, 13, 1],
  [0, 14, 0],
  [0, 18, 6],
  [0, 5, 27],
  [0, 0, 63],
  [0, 17, 19],
  [4, 0, 50],
  [31, 31, 31],
  [7, 7, 7],
  [63, 0, 0],
  [46, 63, 11],
  [43, 58, 1],
  [24, 63, 2],
  [3, 34, 0],
  [0, 63, 23],
  [0, 41, 63],
  [0, 10, 63],
  [6, 0, 63],
  [22, 0, 63],
  [43, 6, 30],
  [10, 4, 0],
  [63, 12, 0],
  [33, 55, 1],
  [28, 63, 5],
  [0, 63, 0],
  [14, 63, 9],
  [21, 63, 27],
  [13, 63, 50],
  [22, 34, 63],
  [12, 20, 48],
  [26, 20, 57],
  [52, 7, 63],
  [63, 0, 22],
  [63, 17, 0],
  [45, 41, 0],
  [35, 63, 0],
  [32, 22, 1],
  [14, 10, 0],
  [0, 18, 3],
  [3, 19, 8],
  [5, 5, 10],
  [5, 7, 22],
  [25, 14, 6],
  [32, 0, 0],
  [54, 16, 10],
  [53, 18, 4],
  [63, 47, 9],
  [39, 55, 11],
  [25, 44, 3],
  [5, 5, 11],
  [54, 52, 26],
  [31, 58, 34],
  [38, 37, 63],
  [35, 25, 63],
  [15, 15, 15],
  [28, 28, 28],
  [55, 63, 63],
  [39, 0, 0],
  [13, 0, 0],
  [6, 51, 0],
  [1, 16, 0],
  [45, 43, 0],
  [15, 12, 0],
  [44, 20, 0],
  [18, 5, 0],
];

export async function readFirmwareFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const firmware = isSysex(bytes) ? decodeSysexFirmware(bytes) : bytes;

  verifyLpx422Layout(firmware);

  return {
    firmware,
    hash: await sha256Hex(firmware),
    kind: isSysex(bytes) ? "syx" : "bin",
    name: file.name,
    size: firmware.length,
  };
}

export function extractPalette(firmware) {
  verifyLpx422Layout(firmware);

  return Array.from({ length: 128 }, (_, index) => {
    const offset = PALETTE_OFFSET + index * 4;
    return [
      firmware[offset + 2] >> 2,
      firmware[offset + 1] >> 2,
      firmware[offset] >> 2,
    ];
  });
}

export function extractNoteTable(firmware) {
  verifyLpx422Layout(firmware);

  return NOTE_ROLES.reduce((table, role, roleIndex) => {
    table[role.id] = firmware[NOTE_TABLE_OFFSETS[roleIndex]];
    return table;
  }, {});
}

export async function firmwareHash(firmware) {
  return sha256Hex(firmware);
}

// --- Tab / transpose colour re-pointing -------------------------------------
// Unlike the Note table (movs immediates), these colour indices are encoded in
// the operand of `ldr` / `add.w` instructions (offset = idx×4). Re-pointing them
// means re-encoding that operand. Offsets/forms come from docs/SCREEN_COLOR_MAP.md
// and every patch below is checked against the stock encoding first (refuse on
// mismatch) — verified with arm-none-eabi-objdump in the tests.
export const FIXED_SLOT_DEFAULTS = {
  "tab-disabled": 0x00,
  "tab-idle": 0x01,
  "tab-selected": 0x1c,
  "transpose-a-base": 0x5e,
  "transpose-a-blend": 0x5f,
  "transpose-b-base": 0x24,
  "transpose-b-blend": 0x2d,
};
// `expect` = the value read() returns from the stock image (abs index, or the
// relative ldr offset for blends).
const FIXED_SLOT_CODE = {
  "tab-disabled": { offset: 0x924a, form: "ldr16", expect: 0x00 },
  "tab-idle": { offset: 0x9252, form: "ldrw", expect: 0x01 },
  "tab-selected": { offset: 0x9266, form: "ldr16", expect: 0x1c },
  "transpose-a-base": { offset: 0xcdba, form: "addw", expect: 0x5e },
  "transpose-a-blend": { offset: 0xce86, form: "ldr16", relTo: "transpose-a-base", expect: 0x5f - 0x5e },
  "transpose-b-base": { offset: 0xce14, form: "addw", expect: 0x24 },
  "transpose-b-blend": { offset: 0xce30, form: "ldr16", relTo: "transpose-b-base", expect: 0x2d - 0x24 },
};

const rol32 = (v, r) => ((v << r) | (v >>> (32 - r))) >>> 0;
const rd16 = (fw, o) => fw[o] | (fw[o + 1] << 8);
const wr16 = (fw, o, hw) => { fw[o] = hw & 0xff; fw[o + 1] = (hw >> 8) & 0xff; };

// Thumb-2 modified immediate (ThumbExpandImm) encoder/decoder.
export function thumbExpandEncode(v) {
  v >>>= 0;
  if (v <= 0xff) return { i: 0, imm3: 0, imm8: v };
  const b0 = v & 0xff, b1 = (v >>> 8) & 0xff, b2 = (v >>> 16) & 0xff, b3 = (v >>> 24) & 0xff;
  if (b1 === 0 && b3 === 0 && b0 === b2 && b0 !== 0) return { i: 0, imm3: 1, imm8: b0 };
  if (b0 === 0 && b2 === 0 && b1 === b3 && b1 !== 0) return { i: 0, imm3: 2, imm8: b1 };
  if (b0 === b1 && b1 === b2 && b2 === b3 && b0 !== 0) return { i: 0, imm3: 3, imm8: b0 };
  for (let r = 8; r <= 31; r++) {
    const base = rol32(v, r);
    if (base >= 0x80 && base <= 0xff) return { i: (r >> 4) & 1, imm3: (r >> 1) & 7, imm8: ((r & 1) << 7) | (base & 0x7f) };
  }
  return null;
}
function thumbExpandDecode(i, imm3, imm8) {
  const ctrl = (i << 3) | imm3;
  if (ctrl === 0) return imm8;
  if (ctrl === 1) return ((imm8 << 16) | imm8) >>> 0;
  if (ctrl === 2) return ((imm8 << 24) | (imm8 << 8)) >>> 0;
  if (ctrl === 3) return ((imm8 << 24) | (imm8 << 16) | (imm8 << 8) | imm8) >>> 0;
  const rot = (ctrl << 1) | (imm8 >> 7);
  const base = 0x80 | (imm8 & 0x7f);
  return ((base >>> rot) | (base << (32 - rot))) >>> 0;
}

const SLOT_FORMS = {
  ldr16: {
    read: (fw, o) => (rd16(fw, o) >> 6) & 0x1f,
    write: (fw, o, val) => {
      if (val < 0 || val > 31) throw new Error(`ldr offset ${val} out of range 0..31`);
      wr16(fw, o, (rd16(fw, o) & ~(0x1f << 6)) | (val << 6));
    },
  },
  ldrw: {
    read: (fw, o) => (rd16(fw, o + 2) & 0xfff) >> 2,
    write: (fw, o, idx) => {
      if (idx < 0 || idx > 127) throw new Error(`ldr.w index ${idx} out of range`);
      wr16(fw, o + 2, (rd16(fw, o + 2) & 0xf000) | ((idx << 2) & 0xfff));
    },
  },
  addw: {
    read: (fw, o) => thumbExpandDecode((rd16(fw, o) >> 10) & 1, (rd16(fw, o + 2) >> 12) & 7, rd16(fw, o + 2) & 0xff) >> 2,
    write: (fw, o, idx) => {
      const enc = thumbExpandEncode(idx << 2);
      if (!enc) throw new Error(`add.w index ${idx} not encodable`);
      wr16(fw, o, (rd16(fw, o) & ~(1 << 10)) | (enc.i << 10));
      wr16(fw, o + 2, (enc.imm3 << 12) | (rd16(fw, o + 2) & 0x0f00) | enc.imm8);
    },
  },
};

// Can the target be re-pointed to `idx` given the current re-points (`slots`)?
export function isFixedSlotReachable(targetId, idx, slots = {}) {
  const code = FIXED_SLOT_CODE[targetId];
  if (!code || idx < 0 || idx > 127) return false;
  if (code.relTo) {
    const base = slots[code.relTo] ?? FIXED_SLOT_DEFAULTS[code.relTo];
    return idx >= base && idx <= base + 31;
  }
  if (code.form === "ldr16") return idx <= 31;
  if (code.form === "ldrw") return true;
  if (code.form === "addw") return thumbExpandEncode(idx << 2) !== null;
  return false;
}

// The absolute palette index a fixed target's instruction currently reads.
export function extractFixedSlotIndex(firmware, targetId) {
  const code = FIXED_SLOT_CODE[targetId];
  if (!code) return undefined;
  const raw = SLOT_FORMS[code.form].read(firmware, code.offset);
  if (code.relTo) {
    const base = FIXED_SLOT_CODE[code.relTo];
    return SLOT_FORMS[base.form].read(firmware, base.offset) + raw;
  }
  return raw;
}

// Re-point the tab/transpose colour instructions per `slots` (id -> abs index).
function patchFixedSlots(patched, slots) {
  for (const [id, code] of Object.entries(FIXED_SLOT_CODE)) {
    const target = slots[id] ?? FIXED_SLOT_DEFAULTS[id];
    if (target === FIXED_SLOT_DEFAULTS[id]) continue; // unchanged
    if (!isFixedSlotReachable(id, target, slots)) {
      throw new Error(`${id} cannot be re-pointed to index ${target} (encoding range).`);
    }
    const form = SLOT_FORMS[code.form];
    if (form.read(patched, code.offset) !== code.expect) {
      throw new Error(`Unexpected encoding for ${id} at 0x${code.offset.toString(16)}. Refusing to patch.`);
    }
    if (code.relTo) {
      const base = slots[code.relTo] ?? FIXED_SLOT_DEFAULTS[code.relTo];
      form.write(patched, code.offset, target - base); // relative ldr offset
    } else {
      form.write(patched, code.offset, target);
    }
  }
}

export function buildPatchedFirmware({ stockFirmware, table, palette, slots = {} }) {
  const patched = new Uint8Array(stockFirmware);

  verifyLpx422Layout(stockFirmware);

  palette.forEach((rgb, index) => {
    const offset = PALETTE_OFFSET + index * 4;
    patched[offset] = rgb[2] << 2;
    patched[offset + 1] = rgb[1] << 2;
    patched[offset + 2] = rgb[0] << 2;
    patched[offset + 3] = 0x00;
  });

  NOTE_ROLES.forEach((role, roleIndex) => {
    patched[NOTE_TABLE_OFFSETS[roleIndex]] = table[role.id];
  });

  patchFixedSlots(patched, slots);

  return patched;
}

export function buildSysexFirmware(firmware) {
  const messages = [];
  const crc = crc32(firmware);
  const blocks = Math.ceil(firmware.length / BLOCK_BYTES);

  messages.push([
    0xf0,
    ...NOVATION_HEADER,
    0x71,
    FAMILY_ID,
    PRODUCT_ID,
    0x00,
    0x00,
    0x00,
    ...VERSION_DIGITS.map((digit) => digit & 0x0f),
    0xf7,
  ]);

  messages.push([
    0xf0,
    ...NOVATION_HEADER,
    0x7c,
    0x00,
    0x30,
    0x30,
    0x30,
    ...VERSION_DIGITS.map((digit) => 0x30 | digit),
    ...toNibbles(firmware.length),
    ...toNibbles(crc),
    0xf7,
  ]);

  for (let blockIndex = 1; blockIndex < blocks; blockIndex++) {
    messages.push([
      0xf0,
      ...NOVATION_HEADER,
      0x72,
      ...encodeFirmwareBlock(firmware, blockIndex),
      0xf7,
    ]);
  }

  messages.push([
    0xf0,
    ...NOVATION_HEADER,
    0x73,
    ...encodeFirmwareBlock(firmware, 0),
    0xf7,
  ]);

  return new Uint8Array(messages.flat());
}

export function decodeSysexFirmware(sysex) {
  const messages = splitSysexMessages(sysex);
  let expectedSize = null;
  let expectedCrc = null;
  let firstBlock = null;
  const restBlocks = [];

  messages.forEach((message) => {
    if (!hasNovationHeader(message)) return;

    const command = message[5];
    if (command === 0x7c) {
      expectedSize = fromNibbles(message.slice(13, 21));
      expectedCrc = fromNibbles(message.slice(21, 29));
      return;
    }

    if (command === 0x72 || command === 0x73) {
      const block = decodeFirmwareBlock(message.slice(6, -1));
      if (command === 0x73) {
        firstBlock = block;
      } else {
        restBlocks.push(block);
      }
    }
  });

  if (!firstBlock || restBlocks.length === 0) {
    throw new Error("Could not read firmware SysEx blocks.");
  }

  const decoded = new Uint8Array([...[...firstBlock], ...restBlocks.flatMap((block) => [...block])]);
  const firmware =
    expectedSize === null ? decoded : decoded.slice(0, expectedSize);

  if (expectedCrc !== null && crc32(firmware) !== expectedCrc) {
    throw new Error("Firmware SysEx CRC mismatch.");
  }

  return firmware;
}

export async function parsePaletteFile(file) {
  const text = await file.text();
  const matches = [
    ...text.matchAll(/(\d{1,3})\s*,\s*(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s*;/g),
  ];

  if (matches.length < 128) {
    throw new Error("Palette file is incomplete.");
  }

  const palette = Array.from({ length: 128 }, () => null);

  matches.forEach((match) => {
    const index = Number(match[1]);
    const rgb = [Number(match[2]), Number(match[3]), Number(match[4])];

    if (index < 0 || index > 127 || rgb.some((value) => value < 0 || value > 63)) {
      throw new Error("Palette entry out of range.");
    }

    palette[index] = rgb;
  });

  if (palette.some((entry) => entry === null)) {
    throw new Error("Palette file is missing entries.");
  }

  return palette;
}

export function toHex(value) {
  return value.toString(16).padStart(2, "0");
}

function isSysex(bytes) {
  return bytes[0] === 0xf0 && bytes.includes(0xf7);
}

function splitSysexMessages(bytes) {
  const messages = [];
  let start = -1;

  bytes.forEach((byte, index) => {
    if (byte === 0xf0) {
      start = index;
      return;
    }

    if (byte === 0xf7 && start >= 0) {
      messages.push(bytes.slice(start, index + 1));
      start = -1;
    }
  });

  return messages;
}

function hasNovationHeader(message) {
  return (
    message.length >= 7 &&
    message[0] === 0xf0 &&
    message[1] === NOVATION_HEADER[0] &&
    message[2] === NOVATION_HEADER[1] &&
    message[3] === NOVATION_HEADER[2] &&
    message[4] === NOVATION_HEADER[3]
  );
}

function encodeFirmwareBlock(firmware, blockIndex) {
  const encoded = new Uint8Array(BLOCK_7BIT_BYTES);

  for (let bitIndex = 0; bitIndex < BLOCK_BITS; bitIndex++) {
    const sourceIndex = blockIndex * BLOCK_BYTES + Math.floor(bitIndex / 8);
    const sourceBit = 7 - (bitIndex % 8);
    const targetIndex = Math.floor(bitIndex / 7);
    const targetBit = 6 - (bitIndex % 7);

    const value =
      sourceIndex >= firmware.length ? 1 : (firmware[sourceIndex] >> sourceBit) & 1;

    encoded[targetIndex] |= value << targetBit;
  }

  return [...encoded];
}

function decodeFirmwareBlock(encoded) {
  const decoded = new Uint8Array(BLOCK_BYTES);

  for (let bitIndex = 0; bitIndex < BLOCK_BITS; bitIndex++) {
    const sourceIndex = Math.floor(bitIndex / 7);
    const sourceBit = 6 - (bitIndex % 7);
    const targetIndex = Math.floor(bitIndex / 8);
    const targetBit = 7 - (bitIndex % 8);
    const value = (encoded[sourceIndex] >> sourceBit) & 1;

    decoded[targetIndex] |= value << targetBit;
  }

  return decoded;
}

function toNibbles(value) {
  const nibbles = [];
  for (let shift = 28; shift >= 0; shift -= 4) {
    nibbles.push((value >>> shift) & 0x0f);
  }
  return nibbles;
}

function fromNibbles(nibbles) {
  return nibbles.reduce((value, nibble) => ((value << 4) | (nibble & 0x0f)) >>> 0, 0);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function crc32(buffer) {
  let crc = 0xffffffff >>> 0;

  buffer.forEach((byte) => {
    crc = (crc ^ (byte << 24)) >>> 0;

    for (let index = 0; index < 8; index++) {
      const carry = crc & 0x80000000;
      crc = ((crc << 1) >>> 0) ^ (carry ? 0x04c11db7 : 0x00000000);
    }
  });

  return crc >>> 0;
}

function verifyLpx422Layout(stockFirmware) {
  const checks = [
    [0x0d127, 0x20],
    [0x0d129, 0x22],
    [0x0d12f, 0x20],
    [0x0d131, 0x22],
    [0x12034, 0x00],
    [0x12035, 0x00],
    [0x12036, 0x00],
    [0x12037, 0x00],
  ];

  for (const [offset, expected] of checks) {
    if (stockFirmware[offset] !== expected) {
      throw new Error(
        `Unexpected LPX 422 layout at 0x${offset
          .toString(16)
          .padStart(5, "0")}. Refusing to patch.`
      );
    }
  }
}
