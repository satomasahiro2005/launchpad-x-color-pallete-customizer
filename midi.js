export function createMidiManager({ log }) {
  let midiAccess = null;
  let currentRefresh = null;
  let latestDevices = [];
  let stateChangeAttached = false;

  const supported = "requestMIDIAccess" in navigator;

  const appendLog = (message) => {
    log(message);
  };

  async function ensureAccess() {
    if (!supported) {
      throw new Error("WebMIDI unsupported");
    }

    if (midiAccess) return midiAccess;

    appendLog("requesting WebMIDI access with sysex=true");
    midiAccess = await navigator.requestMIDIAccess({ sysex: true });
    appendLog(`WebMIDI access granted (sysexEnabled=${String(midiAccess.sysexEnabled)})`);

    if (!stateChangeAttached) {
      midiAccess.onstatechange = () => {
        appendLog("MIDI state changed");
      };
      stateChangeAttached = true;
    }

    return midiAccess;
  }

  async function refresh() {
    if (currentRefresh) {
      appendLog("refresh already running; reusing current scan");
      return currentRefresh;
    }

    const access = await ensureAccess();
    currentRefresh = scanLaunchpads(access).finally(() => {
      currentRefresh = null;
    });

    return currentRefresh;
  }

  function getDevices() {
    return latestDevices;
  }

  function getState() {
    return {
      supported,
      accessGranted: Boolean(midiAccess),
    };
  }

  async function flashToDevice(output, syx) {
    const messages = splitSysexMessages(syx);
    appendLog(`prepared ${messages.length} sysex messages`);

    for (let index = 0; index < messages.length; index++) {
      output.send(messages[index]);
      if (index === 0 || index === messages.length - 1 || index % 200 === 0) {
        appendLog(`sent message ${index + 1}/${messages.length}`);
      }
      await wait(2);
    }
  }

  async function scanLaunchpads(access) {
    const { inputs, outputs } = snapshotPorts(access);
    logPortSnapshot("refresh", { inputs, outputs }, appendLog);

    latestDevices = [];

    if (!inputs.length || !outputs.length) {
      appendLog("no usable MIDI input/output ports in this snapshot");
      return null;
    }

    const replies = await requestIdentityOnce(inputs, outputs, appendLog);
    const devicesByKey = new Map();
    const recognizedInputIds = new Set();

    for (const reply of replies.values()) {
      const output = findBestOutputForInput(reply.input, outputs);

      const device = {
        input: reply.input,
        output,
        type: reply.type,
      };

      latestDevices.push(device);
      devicesByKey.set(`${reply.input.id}::${output?.id || ""}`, device);
      recognizedInputIds.add(reply.input.id);
    }

    const pairs = buildCandidatePairs(inputs, outputs);
    appendLog(`candidate pairs: ${pairs.length}`);

    for (const pair of pairs) {
      const key = `${pair.input.id}::${pair.output.id}`;
      if (devicesByKey.has(key) || recognizedInputIds.has(pair.input.id)) continue;

      latestDevices.push({
        input: pair.input,
        output: pair.output,
        type: "unknown",
      });
    }

    const bootloader = latestDevices.find((device) => device.type === "BL_LPX");
    if (bootloader) {
      appendLog("selected bootloader device");
      return bootloader;
    }

    const launchpad = latestDevices.find((device) => device.type === "LPX");
    if (launchpad) {
      appendLog("selected fallback device: LPX");
      return launchpad;
    }

    appendLog("no Launchpad X identity reply in this snapshot");
    return null;
  }

  return {
    flashToDevice,
    getDevices,
    getState,
    refresh,
  };
}

function snapshotPorts(access) {
  return {
    inputs: Array.from(access.inputs.values()),
    outputs: Array.from(access.outputs.values()),
  };
}

function logPortSnapshot(label, snapshot, log) {
  log(`${label} snapshot: inputs=${snapshot.inputs.length}, outputs=${snapshot.outputs.length}`);

  snapshot.inputs.forEach((input) => {
    log(
      `${label} input ${input.id} name="${input.name}" manufacturer="${input.manufacturer}" state=${input.state} connection=${input.connection}`
    );
  });

  snapshot.outputs.forEach((output) => {
    log(
      `${label} output ${output.id} name="${output.name}" manufacturer="${output.manufacturer}" state=${output.state} connection=${output.connection}`
    );
  });
}

function buildCandidatePairs(inputs, outputs) {
  const pairs = [];
  const seen = new Set();

  const pushPair = (input, output) => {
    const key = `${input.id}::${output.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ input, output });
  };

  inputs.forEach((input) => {
    outputs.forEach((output) => {
      if (normalizePortName(input.name) === normalizePortName(output.name)) {
        pushPair(input, output);
      }
    });
  });

  if (!pairs.length) {
    inputs.forEach((input) => {
      outputs.forEach((output) => {
        const combined = `${input.name} ${output.name}`.toUpperCase();
        if (
          combined.includes("LPX") ||
          combined.includes("BL_LPX") ||
          combined.includes("LAUNCHPAD X")
        ) {
          pushPair(input, output);
        }
      });
    });
  }

  if (!pairs.length && inputs.length === 1 && outputs.length === 1) {
    pushPair(inputs[0], outputs[0]);
  }

  return pairs;
}

function normalizePortName(name = "") {
  return name
    .toUpperCase()
    .split("IN")
    .join("")
    .split("OUT")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function requestIdentityOnce(inputs, outputs, log) {
  return new Promise((resolve) => {
    const replies = new Map();
    const handlers = [];
    const request = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

    const cleanup = () => {
      handlers.forEach(({ input, handler }) => {
        input.removeEventListener("midimessage", handler);
      });
    };

    inputs.forEach((input) => {
      const handler = (event) => {
        const bytes = [...event.data];
        log(`received from "${input.name}": ${formatBytes(bytes)}`);

        const type = identifyLaunchpadType(bytes);
        if (!type) {
          log(`ignored non-Launchpad identity reply from "${input.name}"`);
          return;
        }

        replies.set(input.id, { input, type });
        log(`identity match: input="${input.name}" type=${type}`);
      };

      input.addEventListener("midimessage", handler);
      handlers.push({ input, handler });
    });

    outputs.forEach((output) => {
      log(`sending identity request to "${output.name}": ${formatBytes(request)}`);
      output.send(request);
    });

    setTimeout(() => {
      cleanup();
      log(`identity scan complete: replies=${replies.size}`);
      resolve(replies);
    }, 900);
  });
}

function findBestOutputForInput(input, outputs) {
  const normalizedInput = normalizePortName(input.name);
  const matchingOutput = outputs.find(
    (output) => normalizePortName(output.name) === normalizedInput
  );

  if (matchingOutput) return matchingOutput;

  return outputs[0] || null;
}

function identifyLaunchpadType(data) {
  const body =
    data[0] === 0xf0 && data[data.length - 1] === 0xf7 ? data.slice(1, -1) : data;

  if (body.length < 9) return null;
  if (body[4] !== 0x00 || body[5] !== 0x20 || body[6] !== 0x29) return null;
  if (body[7] !== 0x03) return null;
  if (body[8] === 17) return "BL_LPX";
  if (body[8] === 1) return "LPX";
  return `unknown-lpx-mode-${body[8]}`;
}

function splitSysexMessages(syx) {
  const messages = [];
  let current = [];

  syx.forEach((byte) => {
    if (byte === 0xf0) {
      current = [0xf0];
      return;
    }

    if (!current.length) return;

    current.push(byte);

    if (byte === 0xf7) {
      messages.push(current);
      current = [];
    }
  });

  return messages;
}

function formatBytes(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
