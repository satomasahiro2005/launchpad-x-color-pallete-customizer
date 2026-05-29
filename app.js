import {
  DEFAULT_NOTE_TABLE,
  DEFAULT_PALETTE,
  buildPatchedFirmware,
  buildSysexFirmware,
  extractNoteTable,
  extractPalette,
  parsePaletteFile,
  readFirmwareFile,
  toHex,
} from "./firmware.js";
import { createMidiManager } from "./midi.js";
import { DEVICE_BEZEL, deviceColorHex, deviceGlow } from "./devicelook.js";
import {
  FIXED_PALETTE_TARGETS,
  SLOT_TARGETS,
  targetById,
  TARGET_DISPLAY_LABELS,
  TOP_PREVIEW_LABELS,
  TOP_PREVIEW_TARGETS,
  getGridPitch,
  getGridRole,
  getGridPitchCount,
  getFirstGridCellForPitch,
  getTargetPaletteIndex as getTargetPaletteIndexPure,
  isSyncedTransposeBase as isSyncedTransposeBasePure,
  getOutputPalette as getOutputPalettePure,
} from "./editor-logic.js";

// Fill for cells outside the 8x8 (top controls, scene column, logo). Dark grey
// rather than black so they stay visible next to palette-0 (black) note pads.
const SURFACE_BG = "#2b2b2b";
const KNOWN_LPX_422_FIRMWARE_SHA256 =
  "9cbb359292aeb93affc50d9b6a7b80449e034686927fc5e2e5f6572cf3ddee8e";

const state = {
  activeTarget: "root",
  busy: false,
  device: null,
  devices: [],
  outputs: [],
  selectedOutputId: null,
  firmwareInfo: null,
  logLines: [],
  noticeText: "Click Refresh MIDI to request MIDI access.",
  palette: clonePalette(DEFAULT_PALETTE),
  paletteDirty: false,
  stockFirmware: null,
  syncTranspose: false,
  deviceLook: false,
  table: { ...DEFAULT_NOTE_TABLE },
};

// State-bound wrappers around the pure editor-logic helpers, so call sites stay
// simple. The pure versions (…Pure) are unit-tested in test/editor-logic.test.mjs.
function isSyncedTransposeBase(id) {
  return isSyncedTransposeBasePure(id, state.syncTranspose);
}
function getTargetPaletteIndex(target) {
  return getTargetPaletteIndexPure(target, state.table);
}
function getOutputPalette() {
  return getOutputPalettePure(state.palette, state.table, state.syncTranspose);
}

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
  deviceLookCheckbox: document.querySelector("#device-look-checkbox"),
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
    state.selectedOutputId = elements.deviceSelect.value || null;
  });

  elements.syncTransposeCheckbox.addEventListener("change", () => {
    state.syncTranspose = elements.syncTransposeCheckbox.checked;
    // Synced transpose targets are not editable, so don't leave one selected.
    if (isSyncedTransposeBase(state.activeTarget)) {
      state.activeTarget = "root";
    }
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

      const output = selectedOutput();
      if (deviceTypeForOutput(output.id) !== "BL_LPX") {
        appendMidiLog(
          `note: "${output.name}" isn't a detected bootloader — flashing only works in bootloader mode (hold Capture MIDI while connecting).`
        );
      }
      const firmware = await getPatchedFirmware();
      const syx = buildSysexFirmware(firmware);
      appendMidiLog(`flashing ${syx.length} bytes to ${output.name}`);
      await midiManager.flashToDevice(output, syx);
      setNotice("Firmware write complete.");
    });
  });

  [elements.rgbR, elements.rgbG, elements.rgbB].forEach((input) => {
    input.addEventListener("input", onRgbInput);
  });

  elements.deviceLookCheckbox.addEventListener("change", () => {
    state.deviceLook = elements.deviceLookCheckbox.checked;
    render();
  });

  render();
}

// The bootloader (BL_LPX) and the normal-mode (LPX) device are different MIDI
// ports, so look each up by type instead of sharing one selected device.
function deviceOfType(type) {
  return state.devices.find((device) => device.type === type && device.output) || null;
}

// The chosen flash target from the device dropdown (any connected output).
function selectedOutput() {
  if (!state.outputs.length) {
    throw new Error(
      "No MIDI output found. Connect the Launchpad X (hold Capture MIDI for bootloader), then Refresh MIDI."
    );
  }
  return state.outputs.find((output) => output.id === state.selectedOutputId) || state.outputs[0];
}

// Persist the current colours so the separate "Show on device" page can read
// them (the normal-mode device lives on show.html).
function persistPalette() {
  try {
    localStorage.setItem("lpx-palette", JSON.stringify(getOutputPalette()));
  } catch (error) {
    /* localStorage unavailable; ignore */
  }
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
  const target = targetById[state.activeTarget];
  const synced = isSyncedTransposeBase(target.id);
  const rgb = state.palette[activePaletteIndex()];
  elements.selectedSwatch.style.backgroundColor = colorHex(rgb);
  [elements.rgbR, elements.rgbG, elements.rgbB].forEach((el) => {
    el.disabled = synced;
  });
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
  persistPalette();
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

  const midi = midiManager.getState();
  const live = deviceOfType("LPX");
  const bootloader = deviceOfType("BL_LPX");
  if (!midi.supported) {
    elements.midiState.textContent = "WebMIDI unsupported";
  } else if (!midi.accessGranted) {
    elements.midiState.textContent = "Click Refresh MIDI";
  } else {
    elements.midiState.textContent = live ? "Connected (normal mode)" : "Not connected";
  }

  elements.bootloaderState.textContent = !midi.accessGranted
    ? "Unknown"
    : bootloader
    ? "Connected"
    : "Not connected";
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

function deviceTypeForOutput(outputId) {
  const device = state.devices.find((d) => d.output && d.output.id === outputId);
  return device ? device.type : null;
}

// List every connected MIDI output (detection can miss/misclassify the
// bootloader), annotated with the detected type. Used as the flash target.
function renderDeviceSelect() {
  const list = state.outputs;
  elements.deviceSelect.innerHTML = "";

  if (!list.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No MIDI output";
    elements.deviceSelect.appendChild(option);
    return;
  }

  if (!list.some((output) => output.id === state.selectedOutputId)) {
    const bl = state.devices.find((d) => d.type === "BL_LPX" && d.output);
    const lp = state.devices.find((d) => d.type === "LPX" && d.output);
    const preferred =
      (bl && bl.output) ||
      (lp && lp.output) ||
      list.find((o) => /bootloader|lpx|launchpad/i.test(o.name || "")) ||
      list[0];
    state.selectedOutputId = preferred.id;
  }

  list.forEach((output) => {
    const type = deviceTypeForOutput(output.id);
    const tag = type === "BL_LPX" ? " (bootloader)" : type === "LPX" ? " (Launchpad)" : "";
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = `${output.name || "MIDI output"}${tag}`;
    option.selected = output.id === state.selectedOutputId;
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
    <div>${isSyncedTransposeBase(target.id) ? "sync on" : ""}</div>
  `;
}

function renderSlots() {
  elements.noteTargetList.innerHTML = "";
  elements.transposeTargetList.innerHTML = "";
  elements.modeTargetList.innerHTML = "";

  const outPalette = getOutputPalette();

  SLOT_TARGETS.forEach((target) => {
    const synced = isSyncedTransposeBase(target.id);
    const index = getTargetPaletteIndex(target);
    const rgb = outPalette[index];
    const button = document.createElement("button");
    const container = getTargetContainer(target);

    button.type = "button";
    button.disabled = synced;
    button.className =
      state.activeTarget === target.id ? "border px-2 py-1 font-bold" : "border px-2 py-1";

    const swatch = document.createElement("span");
    swatch.style.cssText =
      "display:inline-block;width:12px;height:12px;border:1px solid #000;margin-right:6px;vertical-align:middle;";
    swatch.style.backgroundColor = colorHex(rgb);
    button.appendChild(swatch);

    let label = TARGET_DISPLAY_LABELS[target.id] || target.label;
    if (synced) label += target.id.startsWith("transpose-a") ? " (= Root)" : " (= Scale)";
    button.appendChild(document.createTextNode(label));

    if (!synced) {
      button.addEventListener("click", () => {
        state.activeTarget = target.id;
        render();
      });
    }

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
  elements.previewGrid.style.background = state.deviceLook ? DEVICE_BEZEL : "";
  const tbody = document.createElement("tbody");

  for (let row = 0; row < 9; row++) {
    const tr = document.createElement("tr");

    for (let col = 0; col < 9; col++) {
      const preview = getPreviewCell(col, row);
      const td = document.createElement("td");

      td.width = 24;
      td.height = 24;
      td.align = "center";
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
          // Locked (synced) transpose bases aren't editable; don't select them.
          if (isSyncedTransposeBase(preview.targetId)) return;
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
    rgb: getOutputPalette()[state.table.accent],
    empty: false,
    kind: "note",
    targetId: "accent",
    text: "",
    title: "Note push / accent",
  };

  td.width = 24;
  td.height = 24;
  td.align = "center";
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
  elements.paletteGrid.style.background = state.deviceLook ? DEVICE_BEZEL : "";
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
      td.style.background = cellFill(rgb);
      td.title = `0x${toHex(index)} / ${index} / rgb ${rgb.join(" ")}`;
      td.textContent = usedIndices.has(index) ? "." : "";
      if (index === activeIndex) {
        td.style.outline = "2px solid #ffffff";
        td.style.outlineOffset = "-2px";
      }

      td.addEventListener("mouseenter", () => {
        elements.paletteHover.textContent = `0x${toHex(index)} / ${index} / rgb ${rgb.join(" ")}`;
      });

      td.addEventListener("click", () => {
        // Note roles point at a palette index, so clicking re-points them.
        // Transpose/tab targets are FIXED palette indices; their colour is edited
        // with the R/G/B fields. Clicking the palette must NOT overwrite an entry
        // here — doing so corrupted shared colours (e.g. 0x00 off, 0x01, 0x24).
        if (activeTarget.kind === "note-role") {
          state.table[activeTarget.id] = index;
          render();
        }
      });

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  elements.paletteGrid.appendChild(tbody);
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
    rgb: getOutputPalette()[state.table[role]],
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
    rgb: getOutputPalette()[index],
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
  if (preview.kind === "note") {
    td.style.background = state.deviceLook && preview.rgb ? deviceGlow(preview.rgb) : preview.color;
    td.style.color = "#ffffff";
    td.style.boxShadow = "";
    return;
  }
  if (preview.kind === "surface") {
    // mode tab / transpose buttons are black-printed surfaces: the body stays
    // dark; only the label text and an inset border take the model colour.
    td.style.background = state.deviceLook ? DEVICE_BEZEL : SURFACE_BG;
    td.style.color = preview.color;
    td.style.boxShadow = `inset 0 0 0 2px ${preview.color}`;
    return;
  }
  // logo/disabled cells have no meaningful colour — dark frame, readable label.
  td.style.background = state.deviceLook ? DEVICE_BEZEL : SURFACE_BG;
  td.style.color = "#888888";
  td.style.boxShadow = "";
}

function applyPreviewHoverStyle(td, preview) {
  const accentRgb = getOutputPalette()[state.table.accent];
  if (preview.kind === "note") {
    td.style.background = cellFill(accentRgb);
    td.style.color = "#ffffff";
  } else {
    td.style.background = state.deviceLook ? DEVICE_BEZEL : SURFACE_BG;
    td.style.color = colorHex(accentRgb);
  }
}

function applyPushedPitchStyle(pitch) {
  const accentRgb = getOutputPalette()[state.table.accent];
  const accent = colorHex(accentRgb);
  elements.previewGrid
    .querySelectorAll(`td[data-preview-kind="note"][data-pitch="${pitch}"]`)
    .forEach((td) => {
      td.style.background = cellFill(accentRgb);
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
        rgb: getOutputPalette()[state.table[role]],
        kind: "note",
      };
      applyPreviewStyle(td, preview);
    });
}

function colorHex([r, g, b]) {
  if (state.deviceLook) return deviceColorHex(r, g, b);
  const scale = (channel) => Math.min(255, Math.round(channel * 4));
  return `#${scale(r).toString(16).padStart(2, "0")}${scale(g)
    .toString(16)
    .padStart(2, "0")}${scale(b).toString(16).padStart(2, "0")}`;
}

// Cell fill: glow gradient under device-look, otherwise a solid colour.
function cellFill(rgb) {
  return state.deviceLook ? deviceGlow(rgb) : colorHex(rgb);
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
    state.outputs = midiManager.getOutputs();
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

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
