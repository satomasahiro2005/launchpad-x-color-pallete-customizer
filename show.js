// Separate "Show palette on device" page. The normal-mode Launchpad X is a
// different MIDI device from the bootloader (used for flashing on the main
// page), so this lives on its own page to avoid confusion.
//
// Palette source: the editor (index.html) saves its current colours to
// localStorage; this page reads them. You can also Import a palette file here.
import { DEFAULT_PALETTE, parsePaletteFile } from "./firmware.js";
import { createMidiManager } from "./midi.js";

const PALETTE_KEY = "lpx-palette";

const elements = {
  refreshMidiButton: document.querySelector("#refresh-midi-button"),
  reloadPaletteButton: document.querySelector("#reload-palette-button"),
  importPaletteButton: document.querySelector("#import-palette-button"),
  paletteFileInput: document.querySelector("#palette-file-input"),
  midiState: document.querySelector("#midi-state"),
  showPalette0Button: document.querySelector("#show-palette-0-button"),
  showPalette1Button: document.querySelector("#show-palette-1-button"),
  deviceRestoreButton: document.querySelector("#device-restore-button"),
  deviceSelect: document.querySelector("#device-select"),
  page0Grid: document.querySelector("#page0-grid"),
  page1Grid: document.querySelector("#page1-grid"),
  notice: document.querySelector("#notice"),
};

const state = {
  palette: loadPalette(),
  devices: [],
  selectedOutputId: null,
  logLines: [],
};

const midiManager = createMidiManager({ log: appendLog });

init();

function init() {
  elements.refreshMidiButton.addEventListener("click", refreshMidi);
  elements.reloadPaletteButton.addEventListener("click", () => {
    state.palette = loadPalette();
    renderGrids();
    setNotice("Palette reloaded from the editor.");
  });
  elements.importPaletteButton.addEventListener("click", () => elements.paletteFileInput.click());
  elements.paletteFileInput.addEventListener("change", async (event) => {
    const [file] = Array.from(event.target.files || []);
    if (!file) return;
    try {
      state.palette = await parsePaletteFile(file);
      renderGrids();
      setNotice("Palette imported.");
    } catch (error) {
      setNotice("Invalid palette file.");
    } finally {
      event.target.value = "";
    }
  });
  elements.showPalette0Button.addEventListener("click", () => showPaletteOnDevice(0));
  elements.showPalette1Button.addEventListener("click", () => showPaletteOnDevice(1));
  elements.deviceRestoreButton.addEventListener("click", restoreDeviceLayout);
  elements.deviceSelect.addEventListener("change", () => {
    state.selectedOutputId = elements.deviceSelect.value || null;
  });

  renderGrids();
  renderStatus();
}

function loadPalette() {
  try {
    const raw = localStorage.getItem(PALETTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 128) return parsed;
    }
  } catch (error) {
    /* fall through to default */
  }
  return DEFAULT_PALETTE.map((rgb) => [...rgb]);
}

function colorHex([r, g, b]) {
  const scale = (channel) => Math.min(255, Math.round(channel * 4));
  return `#${scale(r).toString(16).padStart(2, "0")}${scale(g)
    .toString(16)
    .padStart(2, "0")}${scale(b).toString(16).padStart(2, "0")}`;
}

function renderGrids() {
  renderPage(elements.page0Grid, 0);
  renderPage(elements.page1Grid, 1);
}

function renderPage(table, page) {
  table.innerHTML = "";
  const tbody = document.createElement("tbody");
  for (let row = 0; row < 8; row++) {
    const tr = document.createElement("tr");
    for (let col = 0; col < 8; col++) {
      const index = page * 64 + row * 8 + col;
      const td = document.createElement("td");
      td.width = 24;
      td.height = 24;
      td.bgColor = colorHex(state.palette[index]);
      td.title = `0x${index.toString(16).padStart(2, "0")} / ${index}`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

// Normal-mode Launchpad X ports. A unit can expose more than one ("LPX DAW"
// and "LPX MIDI"), and multiple units may be connected, so the user picks one.
function lpxDevices() {
  return state.devices.filter((device) => device.type === "LPX" && device.output);
}

function findLpxOutput() {
  const list = lpxDevices();
  if (!list.length) {
    throw new Error(
      "Launchpad X (normal mode) not found. Use the device normally (not bootloader), then Refresh MIDI."
    );
  }
  const chosen = list.find((device) => device.output.id === state.selectedOutputId);
  return (chosen || list[0]).output;
}

function renderDeviceSelect() {
  const list = lpxDevices();
  elements.deviceSelect.innerHTML = "";
  if (!list.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No Launchpad X";
    elements.deviceSelect.appendChild(option);
    return;
  }
  // Default to a "MIDI"-named port (best for Programmer-mode lighting) if the
  // current selection is gone.
  if (!list.some((device) => device.output.id === state.selectedOutputId)) {
    const preferred = list.find((device) => /midi/i.test(device.output.name || "")) || list[0];
    state.selectedOutputId = preferred.output.id;
  }
  list.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.output.id;
    option.textContent = device.output.name || "Launchpad X";
    option.selected = device.output.id === state.selectedOutputId;
    elements.deviceSelect.appendChild(option);
  });
}

async function refreshMidi() {
  if (!midiManager.getState().supported) {
    setNotice("WebMIDI is not available. Use a Chromium-based browser.");
    return;
  }
  try {
    await midiManager.refresh();
    state.devices = midiManager.getDevices();
    renderStatus();
  } catch (error) {
    setNotice(error.message || "MIDI initialization failed.");
  }
}

function renderStatus() {
  const midi = midiManager.getState();
  if (!midi.supported) {
    elements.midiState.textContent = "WebMIDI unsupported";
  } else if (!midi.accessGranted) {
    elements.midiState.textContent = "Click Refresh MIDI";
  } else {
    elements.midiState.textContent = lpxDevices().length ? "Connected (normal mode)" : "Not connected";
  }
  renderDeviceSelect();
}

async function showPaletteOnDevice(page) {
  try {
    await refreshMidi();
    const output = findLpxOutput();
    midiManager.sendSysex(output, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7]); // Programmer mode
    const to7 = (channel) => Math.min(127, channel * 2);
    const specs = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const led = (8 - row) * 10 + (col + 1);
        const rgb = state.palette[page * 64 + row * 8 + col];
        specs.push(0x03, led, to7(rgb[0]), to7(rgb[1]), to7(rgb[2]));
      }
    }
    midiManager.sendSysex(output, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x03, ...specs, 0xf7]);
    setNotice(`Palette ${page ? "64–127" : "0–63"} shown on Launchpad X.`);
  } catch (error) {
    setNotice(error.message || String(error));
  }
}

async function restoreDeviceLayout() {
  try {
    await refreshMidi();
    const output = findLpxOutput();
    midiManager.sendSysex(output, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x00, 0xf7]); // Live mode
    setNotice("Launchpad X returned to Live mode.");
  } catch (error) {
    setNotice(error.message || String(error));
  }
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  state.logLines.push(`[${timestamp}] ${message}`);
  state.logLines = state.logLines.slice(-200);
  elements.notice.value = state.logLines.join("\n");
  elements.notice.scrollTop = elements.notice.scrollHeight;
}

function setNotice(text) {
  appendLog(text);
}
