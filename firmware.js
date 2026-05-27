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

export function buildPatchedFirmware({ stockFirmware, table, palette }) {
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
