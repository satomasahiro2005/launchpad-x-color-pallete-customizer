// Pure, DOM-free editor logic: the Launchpad note-grid mapping, the target
// table, palette-index resolution, transpose sync, and preview-cell metadata.
// Kept separate from app.js (which owns the DOM/render/MIDI) so it can be unit
// tested. app.js imports everything here.
import { NOTE_ROLES } from "./firmware.js";

export const SCALE_NOTES = new Set([0, 2, 4, 5, 7, 9, 11]);

// Tab + transpose colours read FIXED palette indices from the firmware; their
// colour is edited via RGB (not re-pointed by clicking the palette).
export const FIXED_PALETTE_TARGETS = [
  { id: "tab-disabled", kind: "palette-slot", label: "Tab disabled", description: "Mode button off/disabled (0x00, per disassembly)", slot: 0x00 },
  { id: "tab-idle", kind: "palette-slot", label: "Tab idle", description: "Mode button idle/unselected (0x01, dim)", slot: 0x01 },
  { id: "tab-selected", kind: "palette-slot", label: "Tab selected", description: "Mode button selected/lit (0x1C, green)", slot: 0x1c },
  { id: "transpose-a-base", kind: "palette-slot", label: "A base", description: "First transpose color", slot: 0x5e },
  { id: "transpose-a-blend", kind: "palette-slot", label: "A blend", description: "First transpose blend color", slot: 0x5f },
  { id: "transpose-b-base", kind: "palette-slot", label: "B base", description: "Second transpose color", slot: 0x24 },
  { id: "transpose-b-blend", kind: "palette-slot", label: "B blend", description: "Second transpose blend color", slot: 0x2d },
];

export const SLOT_TARGETS = [
  ...NOTE_ROLES.map((role) => ({ ...role, kind: "note-role" })),
  ...FIXED_PALETTE_TARGETS,
];

export const targetById = Object.fromEntries(SLOT_TARGETS.map((t) => [t.id, t]));

export const TARGET_DISPLAY_LABELS = {
  root: "Root note",
  scale: "In-scale",
  off: "Out-of-scale",
  accent: "Accent (pressed)",
};

export const TOP_PREVIEW_LABELS = ["↑", "↓", "←", "→", "S", "N", "C", "C"];
export const TOP_PREVIEW_TARGETS = [
  "transpose-a-base",
  "transpose-a-blend",
  "transpose-b-base",
  "transpose-b-blend",
  "menu-disabled",
  "tab-selected", // Note mode is the active mode in this preview
  "tab-idle",
  "tab-idle",
];

// Note grid: pitch increases by 1 per column, by 5 per row going up (origin
// bottom-left). y is the grid row 0..7 from the top.
export function getGridPitch(x, y) {
  return x + (7 - y) * 5;
}

export function getGridRole(x, y) {
  const pitchClass = ((getGridPitch(x, y) % 12) + 12) % 12;
  if (pitchClass === 0) return "root";
  if (SCALE_NOTES.has(pitchClass)) return "scale";
  return "off";
}

export function getGridPitchCount(pitch) {
  let count = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (getGridPitch(x, y) === pitch) count++;
  return count;
}

export function getFirstGridCellForPitch(pitch) {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (getGridPitch(x, y) === pitch) return { x, y };
  return { x: 0, y: 7 };
}

// Palette index a target currently points at. Note roles are re-pointed via
// `table`; fixed (tab/transpose) targets are re-pointed via `slots` (an override
// of their hardcoded firmware slot). Re-pointing only changes WHICH index is
// used — it never overwrites a palette colour.
export function getTargetPaletteIndex(target, table, slots = {}) {
  if (target.kind === "note-role") return table[target.id];
  const override = slots[target.id];
  return override === undefined ? target.slot : override;
}

// While sync is on, the transpose BASE colours follow Root/Scale and lock; the
// blend slots stay editable.
export function isSyncedTransposeBase(id, syncTranspose) {
  return Boolean(syncTranspose) && (id === "transpose-a-base" || id === "transpose-b-base");
}

// The palette actually written to the device: optionally mirror the transpose
// base slots onto the current Root/Scale colours.
export function getOutputPalette(palette, table, syncTranspose) {
  const out = palette.map((rgb) => [...rgb]);
  if (syncTranspose) {
    out[0x5e] = [...palette[table.root]];
    out[0x24] = [...palette[table.scale]];
  }
  return out;
}

// Structural metadata for a 9x9 preview cell (no colours). `empty` cells render
// as frame; a cell is selectable when it has a target and isn't a locked base.
export function getPreviewCellMeta(col, row, activeTarget, syncTranspose) {
  if (row === 0 && col === 8) {
    return { kind: "logo", targetId: null, empty: true, active: false, selectable: false, label: "", title: "Logo" };
  }
  if (row === 0) {
    const targetId = TOP_PREVIEW_TARGETS[col];
    if (targetId === "menu-disabled") {
      return { kind: "logo", targetId: null, empty: true, active: false, selectable: false, label: TOP_PREVIEW_LABELS[col], title: "Disabled" };
    }
    return surfaceMeta(targetId, TOP_PREVIEW_LABELS[col], activeTarget, syncTranspose);
  }
  if (col === 8) {
    return surfaceMeta("tab-idle", ">", activeTarget, syncTranspose);
  }
  const role = getGridRole(col, row - 1);
  const pitch = getGridPitch(col, row - 1);
  return {
    kind: "note",
    targetId: role,
    role,
    pitch,
    empty: false,
    active: activeTarget === role,
    selectable: true,
    label: "",
    title: `${targetById[role].label} / pitch ${pitch} / pushed cells ${getGridPitchCount(pitch)}`,
  };
}

function surfaceMeta(targetId, label, activeTarget, syncTranspose) {
  return {
    kind: "surface",
    targetId,
    empty: false,
    active: activeTarget === targetId,
    // locked synced bases aren't selectable
    selectable: !isSyncedTransposeBase(targetId, syncTranspose),
    label,
    title: targetById[targetId].label,
  };
}
