// Decode a Novation Launchpad X SysEx (.syx) into the raw firmware image,
// reusing the project's own decoder in firmware.js.
//
//   node tools/decode-firmware.mjs <input.syx> [output.bin]
//
// Prints the decoded size and SHA-256 (the official 4.2.2 image hashes to
// 9cbb359292aeb93affc50d9b6a7b80449e034686927fc5e2e5f6572cf3ddee8e).
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decodeSysexFirmware } from "../firmware.js";

const [, , src, out = "firmware.bin"] = process.argv;
if (!src) {
  console.error("usage: node tools/decode-firmware.mjs <input.syx> [output.bin]");
  process.exit(1);
}

const bytes = new Uint8Array(await readFile(src));
const firmware = decodeSysexFirmware(bytes);
await writeFile(out, firmware);

console.log("input :", src, bytes.length, "bytes");
console.log("output:", out, firmware.length, "bytes");
console.log("sha256:", createHash("sha256").update(firmware).digest("hex"));
