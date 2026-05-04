type MidiInputLike = MIDIInput;
type MidiAccessLike = MIDIAccess;

interface MonitorState {
  access: MidiAccessLike | null;
  input: MidiInputLike | null;
  eventCount: number;
  ccValues: Map<string, CcValue>;
}

interface CcValue {
  channel: number;
  controller: number;
  value: number;
}

const MAX_LOG_EVENTS = 160;

const monitorState: MonitorState = {
  access: null,
  input: null,
  eventCount: 0,
  ccValues: new Map<string, CcValue>(),
};

const monitorElements = {
  status: byMonitorId("monitor-status"),
  inputSelect: byMonitorId("midi-input"),
  includeSysex: byMonitorId("include-sysex"),
  connectButton: byMonitorId("connect-midi-input"),
  eventCount: byMonitorId("event-count"),
  eventLog: byMonitorId("incoming-events"),
  clearEvents: byMonitorId("clear-events"),
  ccValues: byMonitorId("cc-values"),
  lastType: byMonitorId("last-type"),
  lastChannel: byMonitorId("last-channel"),
  lastData: byMonitorId("last-data"),
  lastRaw: byMonitorId("last-raw"),
};

function byMonitorId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as any;
}

function initializeMonitor() {
  monitorElements.connectButton.addEventListener("click", connectMidiInput);
  monitorElements.inputSelect.addEventListener("change", selectMidiInput);
  monitorElements.clearEvents.addEventListener("click", clearEvents);
  renderEmptyInputSelect("Connect MIDI first");
  renderCcValues();
}

async function connectMidiInput() {
  if (!navigator.requestMIDIAccess) {
    setMonitorStatus("Web MIDI is not available in this browser.", "error");
    return;
  }

  try {
    setMonitorStatus("Requesting MIDI access...", "");
    monitorState.access = await navigator.requestMIDIAccess({ sysex: monitorElements.includeSysex.checked });
    monitorState.access.onstatechange = refreshMidiInputs;
    refreshMidiInputs();
  } catch (error) {
    const message = error instanceof Error ? error.message : "MIDI access was denied.";
    setMonitorStatus(message, "error");
  }
}

function refreshMidiInputs() {
  detachCurrentInput();

  if (!monitorState.access) {
    renderEmptyInputSelect("Connect MIDI first");
    return;
  }

  const inputs = Array.from(monitorState.access.inputs.values());
  monitorElements.inputSelect.innerHTML = "";
  monitorElements.inputSelect.disabled = inputs.length === 0;

  if (!inputs.length) {
    renderEmptyInputSelect("No inputs found");
    setMonitorStatus("MIDI connected, but no inputs were found.", "error");
    return;
  }

  for (const input of inputs) {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.manufacturer
      ? `${input.name || input.id} - ${input.manufacturer}`
      : input.name || input.id;
    monitorElements.inputSelect.append(option);
  }

  const preferredInput = inputs.find((input) => /jt|behringer/i.test(`${input.name || ""} ${input.manufacturer || ""}`));
  const selectedInput = preferredInput || inputs[0];
  monitorElements.inputSelect.value = selectedInput.id;
  attachInput(selectedInput);
}

function renderEmptyInputSelect(label) {
  monitorElements.inputSelect.innerHTML = "";
  monitorElements.inputSelect.disabled = true;
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  monitorElements.inputSelect.append(option);
}

function selectMidiInput() {
  if (!monitorState.access) {
    return;
  }

  const inputId = monitorElements.inputSelect.value;
  const input = Array.from(monitorState.access.inputs.values()).find((candidate) => candidate.id === inputId);
  if (input) {
    attachInput(input);
  }
}

function attachInput(input) {
  detachCurrentInput();
  monitorState.input = input;
  input.onmidimessage = handleMidiMessage;
  setMonitorStatus(`Listening: ${input.name || input.id}`, "ok");
}

function detachCurrentInput() {
  if (monitorState.input) {
    monitorState.input.onmidimessage = null;
    monitorState.input = null;
  }
}

function handleMidiMessage(event) {
  const bytes = Array.from(event.data || []);
  const decoded = decodeMidiMessage(bytes);
  monitorState.eventCount += 1;
  monitorElements.eventCount.textContent =
    `${monitorState.eventCount} event${monitorState.eventCount === 1 ? "" : "s"} received`;

  if (decoded.kind === "Control Change") {
    monitorState.ccValues.set(ccKey(decoded.channel, decoded.data1), {
      channel: decoded.channel,
      controller: decoded.data1,
      value: decoded.data2,
    });
    renderCcValues();
  }

  renderLastEvent(decoded, bytes);
  prependEvent(decoded, bytes, event.timeStamp);
}

function decodeMidiMessage(bytes) {
  const status = bytes[0] || 0;
  if (status >= 0xf0) {
    return decodeSystemMessage(status, bytes);
  }

  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const data1 = bytes[1] ?? 0;
  const data2 = bytes[2] ?? 0;
  const names = {
    0x80: "Note Off",
    0x90: data2 === 0 ? "Note Off" : "Note On",
    0xa0: "Poly Aftertouch",
    0xb0: "Control Change",
    0xc0: "Program Change",
    0xd0: "Channel Pressure",
    0xe0: "Pitch Bend",
  };

  return {
    kind: names[command] || `Channel Message 0x${hex(status)}`,
    channel,
    data1,
    data2,
    detail: describeChannelData(command, data1, data2),
  };
}

function decodeSystemMessage(status, bytes) {
  const names = {
    0xf0: "SysEx",
    0xf1: "MIDI Time Code Quarter Frame",
    0xf2: "Song Position Pointer",
    0xf3: "Song Select",
    0xf6: "Tune Request",
    0xf8: "Clock",
    0xfa: "Start",
    0xfb: "Continue",
    0xfc: "Stop",
    0xfe: "Active Sensing",
    0xff: "Reset",
  };

  return {
    kind: names[status] || `System Message 0x${hex(status)}`,
    channel: null,
    data1: bytes[1] ?? null,
    data2: bytes[2] ?? null,
    detail: bytes.length > 1 ? `${bytes.length} bytes` : "System real-time",
  };
}

function describeChannelData(command, data1, data2) {
  if (command === 0xb0) {
    return `CC ${data1} = ${data2}`;
  }
  if (command === 0x90 || command === 0x80) {
    return `Note ${data1}, velocity ${data2}`;
  }
  if (command === 0xc0) {
    return `Program ${data1}`;
  }
  if (command === 0xd0) {
    return `Pressure ${data1}`;
  }
  if (command === 0xe0) {
    const bend = ((data2 << 7) | data1) - 8192;
    return `Bend ${bend}`;
  }
  return [data1, data2].filter((value) => value !== null).join(", ");
}

function renderLastEvent(decoded, bytes) {
  monitorElements.lastType.textContent = decoded.kind;
  monitorElements.lastChannel.textContent = decoded.channel ? String(decoded.channel) : "-";
  monitorElements.lastData.textContent = decoded.detail;
  monitorElements.lastRaw.textContent = bytes.map((byte) => `0x${hex(byte)}`).join(" ");
}

function prependEvent(decoded, bytes, timestamp) {
  const row = document.createElement("div");
  row.className = "midi-event-row";

  const time = document.createElement("span");
  time.className = "midi-event-time";
  time.textContent = formatTimestamp(timestamp);

  const type = document.createElement("strong");
  type.textContent = decoded.kind;

  const detail = document.createElement("span");
  detail.textContent = decoded.channel
    ? `Ch ${decoded.channel} - ${decoded.detail}`
    : decoded.detail;

  const raw = document.createElement("code");
  raw.textContent = bytes.map((byte) => hex(byte)).join(" ");

  row.append(time, type, detail, raw);
  monitorElements.eventLog.prepend(row);

  while (monitorElements.eventLog.children.length > MAX_LOG_EVENTS) {
    monitorElements.eventLog.removeChild(monitorElements.eventLog.lastElementChild);
  }
}

function renderCcValues() {
  monitorElements.ccValues.innerHTML = "";

  if (!monitorState.ccValues.size) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact";
    empty.textContent = "Move a CC-capable control on the synth to see values here.";
    monitorElements.ccValues.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Channel</th><th>CC</th><th>Value</th></tr></thead>";
  const body = document.createElement("tbody");
  const values = Array.from(monitorState.ccValues.values()).sort((left, right) => {
    return left.channel - right.channel || left.controller - right.controller;
  });

  for (const item of values) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${item.channel}</td><td>${item.controller}</td><td>${item.value}</td>`;
    body.append(row);
  }

  table.append(body);
  monitorElements.ccValues.append(table);
}

function clearEvents() {
  monitorState.eventCount = 0;
  monitorState.ccValues.clear();
  monitorElements.eventCount.textContent = "0 events received";
  monitorElements.eventLog.innerHTML = "";
  monitorElements.lastType.textContent = "-";
  monitorElements.lastChannel.textContent = "-";
  monitorElements.lastData.textContent = "-";
  monitorElements.lastRaw.textContent = "-";
  renderCcValues();
}

function ccKey(channel, controller) {
  return `${channel}:${controller}`;
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return new Date().toLocaleTimeString();
  }
  return `${Math.round(timestamp)} ms`;
}

function hex(value) {
  return Number(value).toString(16).padStart(2, "0").toUpperCase();
}

function setMonitorStatus(message, stateName) {
  monitorElements.status.textContent = message;
  monitorElements.status.classList.toggle("is-error", stateName === "error");
  monitorElements.status.classList.toggle("is-ok", stateName === "ok");
}

initializeMonitor();
