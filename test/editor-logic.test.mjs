import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCALE_NOTES, FIXED_PALETTE_TARGETS, SLOT_TARGETS, targetById,
  TARGET_DISPLAY_LABELS, TOP_PREVIEW_TARGETS, TOP_PREVIEW_LABELS,
  getGridPitch, getGridRole, getGridPitchCount, getFirstGridCellForPitch,
  getTargetPaletteIndex, isSyncedTransposeBase, getOutputPalette, getPreviewCellMeta,
} from "../editor-logic.js";

test("getGridPitch maps the corners (origin bottom-left, +1/col, +5/row up)", () => {
  assert.equal(getGridPitch(0, 7), 0);   // bottom-left
  assert.equal(getGridPitch(7, 7), 7);   // bottom-right
  assert.equal(getGridPitch(0, 0), 35);  // top-left
  assert.equal(getGridPitch(7, 0), 42);  // top-right
  assert.equal(getGridPitch(1, 6), 6);
});

test("getGridRole: root on pitch-class 0, scale on major scale, off otherwise", () => {
  assert.equal(getGridRole(0, 7), "root");        // pitch 0
  assert.equal(getGridRole(2, 7), "scale");       // pitch 2 (D)
  assert.equal(getGridRole(1, 7), "off");         // pitch 1 (C#)
  // pitch 12 (octave) is also root
  const cell12 = getFirstGridCellForPitch(12);
  assert.equal(getGridRole(cell12.x, cell12.y), "root");
});

test("SCALE_NOTES is the major scale", () => {
  assert.deepEqual([...SCALE_NOTES].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
});

test("every grid role is one of root/scale/off and counts are sane", () => {
  let root = 0, scale = 0, off = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const r = getGridRole(x, y);
    assert.ok(["root", "scale", "off"].includes(r));
    if (r === "root") root++; else if (r === "scale") scale++; else off++;
  }
  assert.equal(root + scale + off, 64);
  assert.ok(root > 0 && scale > 0 && off > 0);
});

test("getGridPitchCount sums to 64 across all reachable pitches", () => {
  const pitches = new Set();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pitches.add(getGridPitch(x, y));
  let total = 0;
  for (const p of pitches) total += getGridPitchCount(p);
  assert.equal(total, 64);
  assert.equal(getGridPitchCount(999), 0);
});

test("getFirstGridCellForPitch returns a cell with that pitch", () => {
  for (const p of [0, 7, 35, 42, 20]) {
    const { x, y } = getFirstGridCellForPitch(p);
    assert.equal(getGridPitch(x, y), p);
  }
});

test("FIXED_PALETTE_TARGETS hold the verified firmware slots", () => {
  const byId = Object.fromEntries(FIXED_PALETTE_TARGETS.map((t) => [t.id, t.slot]));
  assert.equal(byId["tab-disabled"], 0x00);
  assert.equal(byId["tab-idle"], 0x01);
  assert.equal(byId["tab-selected"], 0x1c);
  assert.equal(byId["transpose-a-base"], 0x5e);
  assert.equal(byId["transpose-a-blend"], 0x5f);
  assert.equal(byId["transpose-b-base"], 0x24);
  assert.equal(byId["transpose-b-blend"], 0x2d);
  FIXED_PALETTE_TARGETS.forEach((t) => assert.equal(t.kind, "palette-slot"));
});

test("SLOT_TARGETS includes the 4 note roles (note-role) plus 7 fixed", () => {
  const roles = SLOT_TARGETS.filter((t) => t.kind === "note-role").map((t) => t.id);
  assert.deepEqual(roles.sort(), ["accent", "off", "root", "scale"]);
  assert.equal(SLOT_TARGETS.filter((t) => t.kind === "palette-slot").length, 7);
  assert.ok(Object.keys(TARGET_DISPLAY_LABELS).every((id) => targetById[id]));
});

test("getTargetPaletteIndex: note roles read the table, fixed read their slot", () => {
  const table = { root: 30, scale: 5, off: 0, accent: 21 };
  assert.equal(getTargetPaletteIndex(targetById.root, table), 30);
  assert.equal(getTargetPaletteIndex(targetById.accent, table), 21);
  assert.equal(getTargetPaletteIndex(targetById["transpose-a-base"], table), 0x5e);
  assert.equal(getTargetPaletteIndex(targetById["tab-selected"], table), 0x1c);
});

test("isSyncedTransposeBase only the two bases, only when sync on", () => {
  assert.equal(isSyncedTransposeBase("transpose-a-base", true), true);
  assert.equal(isSyncedTransposeBase("transpose-b-base", true), true);
  assert.equal(isSyncedTransposeBase("transpose-a-blend", true), false);
  assert.equal(isSyncedTransposeBase("transpose-a-base", false), false);
  assert.equal(isSyncedTransposeBase("root", true), false);
});

test("getOutputPalette clones (no aliasing) and does not mutate input", () => {
  const palette = Array.from({ length: 128 }, (_, i) => [i % 64, 0, 0]);
  const table = { root: 5, scale: 21, off: 0, accent: 15 };
  const out = getOutputPalette(palette, table, false);
  assert.deepEqual(out, palette);
  out[0][0] = 99;
  assert.notEqual(palette[0][0], 99); // deep clone, input untouched
});

test("getOutputPalette sync mirrors transpose bases onto Root/Scale, leaves blends", () => {
  const palette = Array.from({ length: 128 }, () => [1, 1, 1]);
  palette[5] = [63, 0, 0];   // root colour
  palette[21] = [0, 63, 0];  // scale colour
  palette[0x5f] = [7, 7, 7]; // A blend (should stay)
  palette[0x2d] = [9, 9, 9]; // B blend (should stay)
  const table = { root: 5, scale: 21, off: 0, accent: 15 };
  const out = getOutputPalette(palette, table, true);
  assert.deepEqual(out[0x5e], [63, 0, 0]); // A base = root colour
  assert.deepEqual(out[0x24], [0, 63, 0]); // B base = scale colour
  assert.deepEqual(out[0x5f], [7, 7, 7]);  // blends untouched
  assert.deepEqual(out[0x2d], [9, 9, 9]);
  assert.deepEqual(palette[0x5e], [1, 1, 1]); // input not mutated
});

test("preview layout: logo corner and disabled S are not selectable", () => {
  const logo = getPreviewCellMeta(8, 0, "root", false);
  assert.equal(logo.kind, "logo");
  assert.equal(logo.selectable, false);
  const sCol = TOP_PREVIEW_TARGETS.indexOf("menu-disabled");
  const disabled = getPreviewCellMeta(sCol, 0, "root", false);
  assert.equal(disabled.empty, true);
  assert.equal(disabled.selectable, false);
});

test("preview top row maps to transpose/tab surface targets and is selectable", () => {
  for (let col = 0; col < 8; col++) {
    const targetId = TOP_PREVIEW_TARGETS[col];
    const cell = getPreviewCellMeta(col, 0, "root", false);
    if (targetId === "menu-disabled") continue;
    assert.equal(cell.kind, "surface");
    assert.equal(cell.targetId, targetId);
    assert.equal(cell.selectable, true);
  }
});

test("preview side column is the idle tab and selectable", () => {
  for (let row = 1; row < 9; row++) {
    const cell = getPreviewCellMeta(8, row, "root", false);
    assert.equal(cell.kind, "surface");
    assert.equal(cell.targetId, "tab-idle");
    assert.equal(cell.selectable, true);
  }
});

test("preview 8x8 note area maps to note roles and reports active", () => {
  // (col, row) with row>=1 and col<8 is the note grid (row-1 = grid y)
  const cell = getPreviewCellMeta(0, 8, "off", false); // grid (0,7) = pitch 0 = root
  assert.equal(cell.kind, "note");
  assert.equal(cell.targetId, "root");
  assert.equal(cell.active, false);
  const activeCell = getPreviewCellMeta(0, 8, "root", false);
  assert.equal(activeCell.active, true);
});

test("synced transpose bases become non-selectable in the preview", () => {
  const aBaseCol = TOP_PREVIEW_TARGETS.indexOf("transpose-a-base");
  assert.equal(getPreviewCellMeta(aBaseCol, 0, "root", false).selectable, true);
  assert.equal(getPreviewCellMeta(aBaseCol, 0, "root", true).selectable, false);
  // blend stays selectable even when synced
  const aBlendCol = TOP_PREVIEW_TARGETS.indexOf("transpose-a-blend");
  assert.equal(getPreviewCellMeta(aBlendCol, 0, "root", true).selectable, true);
});
