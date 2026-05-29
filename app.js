import {
  DEFAULT_NOTE_TABLE,
  DEFAULT_PALETTE,
  NOTE_ROLES,
  buildPatchedFirmware,
  buildSysexFirmware,
  extractNoteTable,
  extractPalette,
  parsePaletteFile,
  readFirmwareFile,
  toHex,
} from "./firmware.js";
import { createMidiManager } from "./midi.js";

const SCALE_NOTES = new Set([0, 2, 4, 5, 7, 9, 11]);
const FIXED_PALETTE_TARGETS = [
  {
    id: "tab-disabled",
    kind: "palette-slot",
    label: "Tab disabled",
    description: "Mode / Custom disabled color candidate",
    slot: 0x01,
  },
  {
    id: "tab-idle",
    kind: "palette-slot",
    label: "Tab idle",
    description: "Mode / Custom unselected color candidate",
    slot: 0x24,
  },
  {
    id: "tab-selected",
    kind: "palette-slot",
    label: "Tab selected",
    description: "Mode / Custom selected color candidate",
    slot: 0x34,
  },
  {
    id: "transpose-a-base",
    kind: "palette-slot",
    label: "A base",
    description: "First transpose color",
    slot: 0x5e,
  },
  {
    id: "transpose-a-blend",
    kind: "palette-slot",
    label: "A blend",
    description: "First transpose blend color",
    slot: 0x5f,
  },
  {
    id: "transpose-b-base",
    kind: "palette-slot",
    label: "B base",
    description: "Second transpose color",
    slot: 0x24,
  },
  {
    id: "transpose-b-blend",
    kind: "palette-slot",
    label: "B blend",
    description: "Second transpose blend color",
    slot: 0x2d,
  },
];
const SLOT_TARGETS = [
  ...NOTE_ROLES.map((role) => ({ ...role, kind: "note-role" })),
  ...FIXED_PALETTE_TARGETS,
];
const TARGET_DISPLAY_LABELS = {
  root: "Root note",
  scale: "In-scale",
  off: "Out-of-scale",
  accent: "Accent (pressed)",
};
const TOP_PREVIEW_LABELS = ["↑", "↓", "←", "→", "S", "N", "C", "C"];
const TOP_PREVIEW_TARGETS = [
  "transpose-a-base",
  "transpose-a-blend",
  "transpose-b-base",
  "transpose-b-blend",
  "menu-disabled",
  "tab-idle",
  "tab-idle",
  "tab-idle",
];
const KNOWN_LPX_422_FIRMWARE_SHA256 =
  "9cbb359292aeb93affc50d9b6a7b80449e034686927fc5e2e5f6572cf3ddee8e";

const state = {
  activeTarget: "root",
  busy: false,
  device: null,
  devices: [],
  firmwareInfo: null,
  logLines: [],
  noticeText: "Click Refresh MIDI to request MIDI access.",
  palette: clonePalette(DEFAULT_PALETTE),
  paletteDirty: false,
  stockFirmware: null,
  syncTranspose: false,
  table: { ...DEFAULT_NOTE_TABLE },
};

const targetById = Object.fromEntries(
  SLOT_TARGETS.map((target) => [target.id, target])
);

const elements = {
  activeMeta: document.querySelector("#active-meta"),
  activeTitle: document.querySelector("#active-title"),
  bootloaderState: document.querySelector("#bootloader-state"),
  deviceSelect: document.querySelector("#device-select"),
  downloadSyxButton: document.querySelector("#download-syx-button"),
  exportPaletteButton: document.querySelector("#export-palette-button"),
  firmwareCheck: document.querySelector("#firmware-check"),
  firmwareFileInput: document.querySelector("#firmware-file-input"),
  firmwareState: document.querySelector("#firmware-state"),
  importPaletteButton: document.querySelector("#import-palette-button"),
  midiState: document.querySelector("#midi-state"),
  modeTargetList: document.querySelector("#mode-target-list"),
  noteTargetList: document.querySelector("#note-target-list"),
  notice: document.querySelector("#notice"),
  paletteHover: document.querySelector("#palette-hover"),
  paletteFileInput: document.querySelector("#palette-file-input"),
  paletteGrid: document.querySelector("#palette-grid"),
  previewGrid: document.querySelector("#preview-grid"),
  readFirmwareButton: document.querySelector("#read-firmware-button"),
  refreshMidiButton: document.querySelector("#refresh-midi-button"),
  selectedPreview: document.querySelector("#selected-preview"),
  syncTransposeCheckbox: document.querySelector("#sync-transpose-checkbox"),
  transposeTargetList: document.querySelector("#transpose-target-list"),
  writeDeviceButton: document.querySelector("#write-device-button"),
  selectedSwatch: document.querySelector("#selected-swatch"),
  rgbR: document.querySelector("#rgb-r"),
  rgbG: document.querySelector("#rgb-g"),
  rgbB: document.querySelector("#rgb-b"),
};

const midiManager = createMidiManager({
  log: appendMidiLog,
});

init();

function init() {
  elements.readFirmwareButton.addEventListener("click", () => {
    elements.firmwareFileInput.click();
  });

  elements.firmwareFileInput.addEventListener("change", async (event) => {
    const [file] = Array.from(event.target.files || []);
    if (!file) return;

    await withBusy(async () => {
      const info = await readFirmwareFile(file);
      state.stockFirmware = info.firmware;
      state.firmwareInfo = info;
      state.palette = extractPalette(info.firmware);
      state.table = extractNoteTable(info.firmware);
      state.paletteDirty = true;
      appendAppLog(`firmware loaded: ${info.name} (${info.kind}, ${info.size} bytes)`);
      render();
    });

    event.target.value = "";
  });

  elements.deviceSelect.addEventListener("change", () => {
    const index = Number(elements.deviceSelect.value);
    state.device = Number.isInteger(index) ? state.devices[index] || null : null;
    renderStatus();
  });

  elements.syncTransposeCheckbox.addEventListener("change", () => {
    state.syncTranspose = elements.syncTransposeCheckbox.checked;
    appendAppLog(
      state.syncTranspose
        ? "transpose sync enabled"
        : "transpose sync disabled"
    );
    render();
  });

  elements.importPaletteButton.addEventListener("click", () => {
    elements.paletteFileInput.click();
  });

  elements.paletteFileInput.addEventListener("change", async (event) => {
    const [file] = Array.from(event.target.files || []);
    if (!file) return;

    try {
      state.palette = await parsePaletteFile(file);
      state.paletteDirty = true;
      setNotice("Palette loaded.");
      render();
    } catch (error) {
      setNotice("Invalid palette file.");
    } finally {
      event.target.value = "";
    }
  });

  elements.exportPaletteButton.addEventListener("click", () => {
    const text = state.palette
      .map((rgb, index) => `${index}, ${rgb[0]} ${rgb[1]} ${rgb[2]};`)
      .join("\n");
    downloadBlob("palette.txt", new Blob([text], { type: "text/plain" }));
  });

  elements.downloadSyxButton.addEventListener("click", async () => {
    await withBusy(async () => {
      const firmware = await getPatchedFirmware();
      const syx = buildSysexFirmware(firmware);
      downloadBlob(
        "LPX-422-note-patched.syx",
        new Blob([syx], { type: "application/octet-stream" })
      );
      setNotice("SYX downloaded.");
    });
  });

  elements.refreshMidiButton.addEventListener("click", async () => {
    await withBusy(refreshMidi);
  });

  elements.writeDeviceButton.addEventListener("click", async () => {
    await withBusy(async () => {
      await refreshMidi();

      if (!state.device || state.device.type !== "BL_LPX") {
        throw new Error(
          "Launchpad X Bootloader was not found. Hold Capture MIDI while connecting the device."
        );
      }

      const firmware = await getPatchedFirmware();
      const syx = buildSysexFirmware(firmware);
      appendMidiLog(`flashing ${syx.length} bytes to ${state.device.output.name}`);
      await midiManager.flashToDevice(state.device.output, syx);
      setNotice("Firmware write complete.");
    });
  });

  [elements.rgbR, elements.rgbG, elements.rgbB].forEach((input) => {
    input.addEventListener("input", onRgbInput);
  });

  render();
}

function activePaletteIndex() {
  return getTargetPaletteIndex(targetById[state.activeTarget]);
}

function onRgbInput() {
  const clamp = (value) => Math.max(0, Math.min(63, Math.round(Number(value) || 0)));
  const index = activePaletteIndex();
  state.palette[index] = [
    clamp(elements.rgbR.value),
    clamp(elements.rgbG.value),
    clamp(elements.rgbB.value),
  ];
  state.paletteDirty = true;
  render();
}

function renderColorEditor() {
  const rgb = state.palette[activePaletteIndex()];
  elements.selectedSwatch.style.backgroundColor = colorHex(rgb);
  if (document.activeElement !== elements.rgbR) elements.rgbR.value = rgb[0];
  if (document.activeElement !== elements.rgbG) elements.rgbG.value = rgb[1];
  if (document.activeElement !== elements.rgbB) elements.rgbB.value = rgb[2];
}

function clonePalette(source) {
  return source.map((rgb) => [...rgb]);
}

function appendMidiLog(message) {
  const timestamp = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  console.log(`[midi ${timestamp}] ${message}`);
  appendAppLog(`[midi] ${message}`);
}

function appendAppLog(message) {
  const timestamp = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  state.logLines.push(`[${timestamp}] ${message}`);
  state.logLines = state.logLines.slice(-200);
  renderLog();
}

function setNotice(text) {
  state.noticeText = text;
  appendAppLog(text);
}

function withBusy(task) {
  if (state.busy) return Promise.resolve();

  state.busy = true;
  renderButtons();

  return task()
    .catch((error) => {
      setNotice(error.message || String(error));
    })
    .finally(() => {
      state.busy = false;
      renderButtons();
    });
}

function render() {
  renderStatus();
  renderButtons();
  renderActiveSlot();
  renderColorEditor();
  renderSlots();
  renderPreview();
  renderSelectedPreview();
  renderPalette();
  renderLog();
}

function renderLog() {
  elements.notice.value = state.logLines.join("\n") || state.noticeText;
  elements.notice.scrollTop = elements.notice.scrollHeight;
}

function renderStatus() {
  const firmwareLabel = state.firmwareInfo
    ? state.firmwareInfo.name
    : "No firmware loaded";

  elements.firmwareState.textContent = firmwareLabel;
  elements.firmwareCheck.textContent = getFirmwareCheckText();

  const midiState = midiManager.getState();
  if (!midiState.supported) {
    elements.midiState.textContent = "WebMIDI unsupported";
  } else if (!midiState.accessGranted) {
    elements.midiState.textContent = "Click Refresh MIDI";
  } else if (!state.device) {
    elements.midiState.textContent = "No Launchpad detected";
  } else if (state.device.type === "BL_LPX") {
    elements.midiState.textContent = "Launchpad X Bootloader ready";
  } else if (state.device.type === "LPX") {
    elements.midiState.textContent = "Launchpad X detected";
  } else {
    elements.midiState.textContent = state.device.type;
  }

  elements.bootloaderState.textContent =
    state.device && state.device.type === "BL_LPX" ? "Yes" : "No";
  renderDeviceSelect();
  elements.syncTransposeCheckbox.checked = state.syncTranspose;
}

function getFirmwareCheckText() {
  if (!state.stockFirmware) return "Not checked";
  if (!state.firmwareInfo) return "OK";
  if (state.firmwareInfo.hash === KNOWN_LPX_422_FIRMWARE_SHA256) {
    return "Official v2.0.1 ✓";
  }

  return "Loaded (custom)";
}

function renderDeviceSelect() {
  const selectedIndex = state.devices.indexOf(state.device);
  elements.deviceSelect.innerHTML = "";

  if (!state.devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No MIDI device";
    elements.deviceSelect.appendChild(option);
    return;
  }

  state.devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${device.type} - ${device.output.name || "unnamed output"}`;
    option.selected = index === selectedIndex;
    elements.deviceSelect.appendChild(option);
  });
}

function renderButtons() {
  const disabled = state.busy;
  const needsFirmwareDisabled = disabled || !state.stockFirmware;

  elements.downloadSyxButton.disabled = needsFirmwareDisabled;
  elements.writeDeviceButton.disabled = needsFirmwareDisabled;

  [
    elements.exportPaletteButton,
    elements.importPaletteButton,
    elements.readFirmwareButton,
    elements.refreshMidiButton,
  ].forEach((button) => {
    button.disabled = disabled;
  });
  elements.deviceSelect.disabled = disabled;
  elements.syncTransposeCheckbox.disabled = disabled;
}

function renderActiveSlot() {
  const target = targetById[state.activeTarget];
  const index = getTargetPaletteIndex(target);
  const rgb = state.palette[index];

  elements.activeTitle.textContent = TARGET_DISPLAY_LABELS[target.id] || target.label;

  if (target.kind === "note-role") {
    elements.activeMeta.innerHTML = `
      <div>index 0x${toHex(index)} / ${index}</div>
      <div>rgb ${rgb[0]} ${rgb[1]} ${rgb[2]}</div>
    `;
    return;
  }

  elements.activeMeta.innerHTML = `
    <div>slot 0x${toHex(index)} / ${index}</div>
    <div>rgb ${rgb[0]} ${rgb[1]} ${rgb[2]}</div>
    <div>${target.id.startsWith("transpose-") && state.syncTranspose ? "sync on" : ""}</div>
  `;
}

function renderSlots() {
  elements.noteTargetList.innerHTML = "";
  elements.transposeTargetList.innerHTML = "";
  elements.modeTargetList.innerHTML = "";

  SLOT_TARGETS.forEach((target) => {
    const index = getTargetPaletteIndex(target);
    const rgb = state.palette[index];
    const button = document.createElement("button");
    const container = getTargetContainer(target);

    button.type = "button";
    button.className =
      state.activeTarget === target.id ? "border px-2 py-1 font-bold" : "border px-2 py-1";

    const swatch = document.createElement("span");
    swatch.style.cssText =
      "display:inline-block;width:12px;height:12px;border:1px solid #000;margin-right:6px;vertical-align:middle;";
    swatch.style.backgroundColor = colorHex(rgb);
    button.appendChild(swatch);
    button.appendChild(
      document.createTextNode(TARGET_DISPLAY_LABELS[target.id] || target.label)
    );

    button.addEventListener("click", () => {
      state.activeTarget = target.id;
      render();
    });

    container.appendChild(button);
  });
}

function getTargetContainer(target) {
  if (target.kind === "note-role") return elements.noteTargetList;
  if (target.id.startsWith("transpose-")) return elements.transposeTargetList;
  return elements.modeTargetList;
}

function renderPreview() {
  elements.previewGrid.innerHTML = "";
  const tbody = document.createElement("tbody");

  for (let row = 0; row < 9; row++) {
    const tr = document.createElement("tr");

    for (let col = 0; col < 9; col++) {
      const preview = getPreviewCell(col, row);
      const td = document.createElement("td");

      td.width = 24;
      td.height = 24;
      td.align = "center";
      td.style.borderStyle = "solid";
      td.style.borderWidth = "2px";
      td.title = preview.title;
      td.textContent = preview.text || (preview.active ? "*" : " ");
      td.dataset.previewKind = preview.kind;
      if (preview.pitch !== undefined) {
        td.dataset.pitch = String(preview.pitch);
      }
      applyPreviewStyle(td, preview);

      if (!preview.empty) {
        td.addEventListener("mouseenter", () => {
          if (preview.kind === "note") {
            applyPushedPitchStyle(preview.pitch);
          } else {
            applyPreviewHoverStyle(td, preview);
          }
        });

        td.addEventListener("mouseleave", () => {
          if (preview.kind === "note") {
            resetPreviewNoteStyles();
          } else {
            applyPreviewStyle(td, preview);
          }
        });

        td.addEventListener("click", () => {
          if (!preview.targetId) return;
          state.activeTarget = preview.targetId;
          render();
        });
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  elements.previewGrid.appendChild(tbody);
}

function renderSelectedPreview() {
  elements.selectedPreview.innerHTML = "";
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  const preview = {
    active: state.activeTarget === "accent",
    color: colorHex(getOutputPalette()[state.table.accent]),
    empty: false,
    kind: "note",
    targetId: "accent",
    text: "",
    title: "Note push / accent",
  };

  td.width = 24;
  td.height = 24;
  td.align = "center";
  td.style.borderStyle = "solid";
  td.style.borderWidth = "2px";
  td.title = preview.title;
  td.textContent = preview.active ? "*" : " ";
  applyPreviewStyle(td, preview);
  td.addEventListener("mouseenter", () => {
    applyPreviewHoverStyle(td, preview);
  });
  td.addEventListener("mouseleave", () => {
    applyPreviewStyle(td, preview);
  });
  td.addEventListener("click", () => {
    state.activeTarget = "accent";
    render();
  });

  tr.appendChild(td);
  elements.selectedPreview.appendChild(tr);
}

function renderPalette() {
  elements.paletteGrid.innerHTML = "";
  const tbody = document.createElement("tbody");
  const usedIndices = new Set([
    ...Object.values(state.table),
    ...FIXED_PALETTE_TARGETS.map((target) => target.slot),
  ]);
  const activeTarget = targetById[state.activeTarget];
  const activeIndex = getTargetPaletteIndex(activeTarget);

  for (let row = 0; row < 8; row++) {
    const tr = document.createElement("tr");

    for (let col = 0; col < 16; col++) {
      const index = row * 16 + col;
      const rgb = state.palette[index];
      const td = document.createElement("td");

      td.width = 24;
      td.height = 24;
      td.align = "center";
      td.style.borderStyle = "solid";
      td.style.borderWidth = "1px";
      td.style.borderColor = "#999999";
      td.bgColor = colorHex(rgb);
      td.title = `0x${toHex(index)} / ${index} / rgb ${rgb.join(" ")}`;
      td.textContent = index === activeIndex ? "*" : usedIndices.has(index) ? "." : " ";

      td.addEventListener("mouseenter", () => {
        elements.paletteHover.textContent = `0x${toHex(index)} / ${index} / rgb ${rgb.join(" ")}`;
      });

      td.addEventListener("click", () => {
        if (activeTarget.kind === "note-role") {
          state.table[activeTarget.id] = index;
        } else {
          state.palette[activeTarget.slot] = [...state.palette[index]];
          state.paletteDirty = true;
        }
        render();
      });

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  elements.paletteGrid.appendChild(tbody);
}

function getGridPitch(x, y) {
  return x + (7 - y) * 5;
}

function getGridRole(x, y) {
  const note = getGridPitch(x, y);
  const pitchClass = ((note % 12) + 12) % 12;

  if (pitchClass === 0) return "root";
  if (SCALE_NOTES.has(pitchClass)) return "scale";
  return "off";
}

function getTargetPaletteIndex(target) {
  if (target.kind === "note-role") {
    return state.table[target.id];
  }

  return target.slot;
}

function getPreviewCell(col, row) {
  if (row === 0 && col === 8) {
    return {
      active: false,
      color: "#000000",
      empty: true,
      kind: "logo",
      targetId: null,
      text: "",
      title: "Logo",
    };
  }

  if (row === 0) {
    const targetId = TOP_PREVIEW_TARGETS[col];
    return targetId === "menu-disabled"
      ? disabledSurfacePreviewCell(TOP_PREVIEW_LABELS[col])
      : surfacePreviewCell(targetId, TOP_PREVIEW_LABELS[col]);
  }

  if (col === 8) {
    return surfacePreviewCell("tab-idle", ">");
  }

  const role = getGridRole(col, row - 1);
  const pitch = getGridPitch(col, row - 1);
  return {
    active: state.activeTarget === role,
    color: colorHex(getOutputPalette()[state.table[role]]),
    empty: false,
    kind: "note",
    pitch,
    targetId: role,
    text: "",
    title: `${targetById[role].label} / pitch ${pitch} / pushed cells ${getGridPitchCount(pitch)}`,
  };
}

function disabledSurfacePreviewCell(text = "") {
  return {
    active: false,
    color: "#000000",
    empty: true,
    kind: "logo",
    targetId: null,
    text,
    title: "Disabled",
  };
}

function surfacePreviewCell(targetId, text = "") {
  const index = getTargetPaletteIndex(targetById[targetId]);
  return {
    active: state.activeTarget === targetId,
    color: colorHex(getOutputPalette()[index]),
    empty: false,
    kind: "surface",
    targetId,
    text,
    title: targetById[targetId].label,
  };
}

function emptyPreviewCell() {
  return {
    active: false,
    color: "#000000",
    empty: true,
    targetId: null,
    text: "",
    title: "",
  };
}

function applyPreviewStyle(td, preview) {
  td.style.backgroundColor = preview.kind === "note" ? preview.color : "#000000";
  td.style.color = preview.kind === "note" ? "#ffffff" : preview.color;
  td.style.borderColor = preview.kind === "logo" ? "#000000" : preview.color;
}

function applyPreviewHoverStyle(td, preview) {
  const accent = colorHex(getOutputPalette()[state.table.accent]);
  td.style.backgroundColor = preview.kind === "note" ? accent : "#000000";
  td.style.color = preview.kind === "note" ? "#ffffff" : accent;
  td.style.borderColor = accent;
}

function applyPushedPitchStyle(pitch) {
  const accent = colorHex(getOutputPalette()[state.table.accent]);
  elements.previewGrid
    .querySelectorAll(`td[data-preview-kind="note"][data-pitch="${pitch}"]`)
    .forEach((td) => {
      td.style.backgroundColor = accent;
      td.style.color = "#ffffff";
      td.style.borderColor = accent;
    });
}

function resetPreviewNoteStyles() {
  elements.previewGrid
    .querySelectorAll('td[data-preview-kind="note"]')
    .forEach((td) => {
      const pitch = Number(td.dataset.pitch);
      const { x, y } = getFirstGridCellForPitch(pitch);
      const role = getGridRole(x, y);
      const preview = {
        color: colorHex(getOutputPalette()[state.table[role]]),
        kind: "note",
      };
      applyPreviewStyle(td, preview);
    });
}

function getGridPitchCount(pitch) {
  let count = 0;

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (getGridPitch(x, y) === pitch) count++;
    }
  }

  return count;
}

function getFirstGridCellForPitch(pitch) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (getGridPitch(x, y) === pitch) return { x, y };
    }
  }

  return { x: 0, y: 7 };
}

function colorHex([r, g, b]) {
  const scale = (channel) => Math.min(255, Math.round(channel * 4));
  return `#${scale(r).toString(16).padStart(2, "0")}${scale(g)
    .toString(16)
    .padStart(2, "0")}${scale(b).toString(16).padStart(2, "0")}`;
}

async function refreshMidi() {
  if (!midiManager.getState().supported) {
    renderStatus();
    setNotice("WebMIDI is not available in this browser. Use a Chromium-based browser.");
    return;
  }

  try {
    state.device = await midiManager.refresh();
    state.devices = midiManager.getDevices();
    renderStatus();

    if (state.device) {
      setNotice(`Launchpad detected: ${state.device.type}`);
    } else {
      setNotice(
        "Launchpad X not found. Check the MIDI log for port names and probe responses."
      );
    }
  } catch (error) {
    state.device = null;
    renderStatus();
    setNotice(error.message || "MIDI initialization failed.");
  }
}

async function getPatchedFirmware() {
  if (!state.stockFirmware) {
    throw new Error("Load the official 422 SYX/BIN with Read firmware file first.");
  }

  return buildPatchedFirmware({
    stockFirmware: state.stockFirmware,
    table: state.table,
    palette: getOutputPalette(),
  });
}

function getOutputPalette() {
  const palette = clonePalette(state.palette);

  if (state.syncTranspose) {
    palette[0x5e] = [...state.palette[state.table.root]];
    palette[0x5f] = [...state.palette[state.table.root]];
    palette[0x24] = [...state.palette[state.table.scale]];
    palette[0x2d] = [...state.palette[state.table.scale]];
  }

  return palette;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
