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
  outputs: [],
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

// Any MIDI output — the identity scan may miss or misclassify a Launchpad, so
// the user can send to whatever output they choose. A Launchpad/MIDI-named port
// is preferred by default.
function selectedOutput() {
  if (!state.outputs.length) {
    throw new Error("No MIDI output found. Connect a device, then Refresh MIDI.");
  }
  return state.outputs.find((output) => output.id === state.selectedOutputId) || state.outputs[0];
}

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
    const preferred =
      list.find((o) => /daw/i.test(o.name || "")) ||
      list.find((o) => /launchpad|lpx/i.test(o.name || "")) ||
      list[0];
    state.selectedOutputId = preferred.id;
  }
  list.forEach((output) => {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name || "MIDI output";
    option.selected = output.id === state.selectedOutputId;
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
    state.outputs = midiManager.getOutputs();
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
    elements.midiState.textContent = state.outputs.length
      ? `${state.outputs.length} MIDI output(s)`
      : "No outputs";
  }
  renderDeviceSelect();
}

async function showPaletteOnDevice(page) {
  try {
    await refreshMidi();
    const output = selectedOutput();
    // DAW mode keeps the device in normal use: Session-layout lighting shows on
    // the Session tab, no Programmer mode needed.
    midiManager.sendSysex(output, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x10, 0x01, 0xf7]); // DAW mode on
    midiManager.sendSysex(output, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x00, 0x00, 0xf7]); // Session layout
    // Static colour on Session layout: Note On ch1 (0x90), note = pad,
    // velocity = palette index (device shows its palette colour; vel 0 = off).
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const note = (8 - row) * 10 + (col + 1);
        const index = page * 64 + row * 8 + col;
        output.send([0x90, note, index]);
      }
    }
    setNotice(`Palette ${page ? "64–127" : "0–63"} shown on the Session tab (DAW mode).`);
  } catch (error) {
    setNotice(error.message || String(error));
  }
}

async function restoreDeviceLayout() {
  try {
    await refreshMidi();
    const output = selectedOutput();
    // Revert to Standalone so the device behaves normally again.
    midiManager.sendSysex(output, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x10, 0x00, 0xf7]); // DAW mode off
    setNotice("Exited DAW mode (Standalone).");
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
