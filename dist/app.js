const DEFAULT_INSTRUMENT_YAML = "name: Behringer JT Mini\ntheme:\n  name: JT Mini\n  colors:\n    background: \"#101112\"\n    panel: \"#1a1c1d\"\n    panelAlt: \"#222627\"\n    text: \"#f4f1e8\"\n    muted: \"#aeb4ad\"\n    primary: \"#17c9b2\"\n    accent: \"#f0bc4d\"\n    danger: \"#ff6b6b\"\nsections:\n  - name: Performance\n    controls:\n      - cc: 1\n        label: Modulation\n        description: Modulation amount.\n        type: vertical-slider\n      - cc: 40\n        label: Voice Mode\n        description: Selects poly, unison, and arpeggiator voice modes.\n        type: switch\n        positions:\n          - label: Poly\n            value: 6\n          - label: Unison\n            value: 20\n          - label: Arp up\n            value: 40\n          - label: Arp down\n            value: 70\n          - label: Arp up and down\n            value: 100\n          - label: Random\n            value: 120\n      - cc: 41\n        label: Octave\n        description: Oscillator octave range.\n        type: switch\n        positions:\n          - label: 32'\n            value: 10\n          - label: 16'\n            value: 32\n          - label: 8'\n            value: 54\n          - label: 4'\n            value: 76\n          - label: 2'\n            value: 98\n          - label: 1'\n            value: 118\n  - name: VCO\n    controls:\n      - cc: 36\n        label: VCO PWM Modulation\n        description: Pulse width modulation depth.\n        type: horizontal-slider\n      - cc: 42\n        label: VCO Detune\n        description: Detunes the oscillator.\n        type: horizontal-slider\n      - cc: 47\n        label: VCO Pitch Modulation\n        description: Pitch modulation amount.\n        type: horizontal-slider\n  - name: LFO\n    controls:\n      - cc: 37\n        label: LFO Delay Time\n        description: Delay before LFO modulation fades in.\n        type: horizontal-slider\n      - cc: 46\n        label: LFO Rate\n        description: LFO speed.\n        type: horizontal-slider\n      - cc: 48\n        label: VCF LFO Modulation\n        description: LFO depth routed to the filter.\n        type: horizontal-slider\n  - name: VCF\n    controls:\n      - cc: 44\n        label: VCF Cutoff\n        description: Filter cutoff frequency.\n        type: vertical-slider\n      - cc: 45\n        label: VCF Envelope Modulation\n        description: Envelope depth routed to the filter.\n        type: horizontal-slider\n  - name: Envelope\n    controls:\n      - cc: 39\n        label: Envelope Release\n        description: Envelope release time.\n        type: horizontal-slider\n      - cc: 49\n        label: Envelope Attack Time\n        description: Envelope attack time.\n        type: horizontal-slider\n      - cc: 50\n        label: Envelope Decay Time\n        description: Envelope decay time.\n        type: horizontal-slider\n      - cc: 51\n        label: Envelope Sustain Level\n        description: Envelope sustain level.\n        type: horizontal-slider\n";
const MIDI_NOTE_MIDDLE_C = 60;
const MIDI_NOTE_VELOCITY = 96;
const LOOP_INTERVAL_MS = 3000;
const YAML_RELOAD_DELAY_MS = 220;

const allowedControlTypes = new Set([
  "vertical-slider",
  "horizontal-slider",
  "switch",
  "toggle-button",
]);

const state = {
  instrument: null,
  midiAccess: null,
  midiOutput: null,
  loopTimer: null,
  reloadTimer: null,
  values: new Map(),
};

const elements = {
  yamlEditor: byId("yaml-editor"),
  yamlFile: byId("yaml-file"),
  parseStatus: byId("parse-status"),
  instrumentTitle: byId("instrument-title"),
  controlSummary: byId("control-summary"),
  controlsGrid: byId("controls-grid"),
  themeName: byId("theme-name"),
  connectMidi: byId("connect-midi"),
  midiStatus: byId("midi-status"),
  midiChannel: byId("midi-channel"),
  midiOutput: byId("midi-output"),
  playNote: byId("play-note"),
  loopNote: byId("loop-note"),
  eventLog: byId("event-log"),
};

function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}

function initialize() {
  populateMidiChannels();
  elements.yamlEditor.value = DEFAULT_INSTRUMENT_YAML;
  elements.yamlEditor.addEventListener("input", queueYamlReload);
  elements.yamlFile.addEventListener("change", handleYamlFile);
  elements.connectMidi.addEventListener("click", connectMidi);
  elements.midiOutput.addEventListener("change", selectMidiOutput);
  elements.playNote.addEventListener("click", playMiddleC);
  elements.loopNote.addEventListener("change", syncLoopPlayback);
  window.addEventListener("beforeunload", stopLoopPlayback);
  loadYaml(DEFAULT_INSTRUMENT_YAML);
}

function populateMidiChannels() {
  elements.midiChannel.innerHTML = "";
  for (let channel = 1; channel <= 16; channel += 1) {
    const option = document.createElement("option");
    option.value = String(channel);
    option.textContent = `Channel ${channel}`;
    elements.midiChannel.append(option);
  }
}

function queueYamlReload() {
  window.clearTimeout(state.reloadTimer);
  state.reloadTimer = window.setTimeout(() => {
    loadYaml(elements.yamlEditor.value);
  }, YAML_RELOAD_DELAY_MS);
}

function handleYamlFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    elements.yamlEditor.value = String(reader.result || "");
    loadYaml(elements.yamlEditor.value);
  });
  reader.addEventListener("error", () => {
    setParseStatus(`Could not read ${file.name}.`, "error");
  });
  reader.readAsText(file);
}

function loadYaml(source) {
  try {
    const parsed = parseYaml(source);
    const instrument = validateInstrument(parsed);
    state.instrument = instrument;
    renderInstrument(instrument);
    applyTheme(instrument.theme);
    setParseStatus(
      `Loaded ${instrument.name}: ${countControls(instrument)} controls in ${instrument.sections.length} sections.`,
      "ok",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setParseStatus(message, "error");
  }
}

function setParseStatus(message, stateName) {
  elements.parseStatus.textContent = message;
  elements.parseStatus.classList.toggle("is-error", stateName === "error");
  elements.parseStatus.classList.toggle("is-ok", stateName === "ok");
}

function countControls(instrument) {
  return instrument.sections.reduce((count, section) => count + section.controls.length, 0);
}

function renderInstrument(instrument) {
  elements.instrumentTitle.textContent = instrument.name;
  elements.controlSummary.textContent = `${countControls(instrument)} MIDI CC controls`;
  elements.themeName.textContent = instrument.theme.name ? `Theme: ${instrument.theme.name}` : "";
  elements.controlsGrid.innerHTML = "";

  if (!instrument.sections.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "Add at least one section with controls to the YAML definition.";
    elements.controlsGrid.append(emptyState);
    return;
  }

  for (const section of instrument.sections) {
    const sectionElement = document.createElement("section");
    sectionElement.className = "section-panel";

    const heading = document.createElement("h3");
    heading.textContent = section.name;
    sectionElement.append(heading);

    const controls = document.createElement("div");
    controls.className = "section-controls";
    for (const control of section.controls) {
      controls.append(renderControl(control));
    }

    sectionElement.append(controls);
    elements.controlsGrid.append(sectionElement);
  }
}

function renderControl(control) {
  const wrapper = document.createElement("article");
  wrapper.className = "control";
  wrapper.dataset.cc = String(control.cc);

  const header = document.createElement("div");
  header.className = "control-header";

  const title = document.createElement("div");
  title.className = "control-title";
  const label = document.createElement("strong");
  label.textContent = control.label;
  title.append(label);
  if (control.description) {
    const description = document.createElement("span");
    description.textContent = control.description;
    title.append(description);
  }

  const badge = document.createElement("div");
  badge.className = "cc-badge";
  badge.textContent = `CC ${control.cc}`;

  header.append(title, badge);
  wrapper.append(header);

  if (control.type === "vertical-slider" || control.type === "horizontal-slider") {
    wrapper.append(renderSliderControl(control));
  } else if (control.type === "toggle-button") {
    wrapper.append(renderToggleControl(control));
  } else {
    wrapper.append(renderSwitchControl(control));
  }

  return wrapper;
}

function renderSliderControl(control) {
  const currentValue = getControlValue(control);
  const shell = document.createElement("div");
  shell.className = `slider-shell ${control.type === "vertical-slider" ? "is-vertical" : ""}`;

  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "127";
  range.value = String(currentValue);
  range.setAttribute("aria-label", control.label);

  const meter = document.createElement("div");
  meter.className = "value-meter";
  meter.textContent = String(currentValue);

  const number = document.createElement("input");
  number.type = "number";
  number.min = "0";
  number.max = "127";
  number.value = String(currentValue);
  number.setAttribute("aria-label", `${control.label} value`);

  const syncValue = (value) => {
    const midiValue = coerceMidiValue(value);
    range.value = String(midiValue);
    number.value = String(midiValue);
    meter.textContent = String(midiValue);
    updateControlValue(control, midiValue);
  };

  range.addEventListener("input", () => syncValue(range.value));
  number.addEventListener("input", () => syncValue(number.value));

  if (control.type === "vertical-slider") {
    shell.append(range, meter, number);
  } else {
    shell.append(range, number);
  }

  return shell;
}

function renderToggleControl(control) {
  const currentValue = getControlValue(control);
  const button = document.createElement("button");
  button.className = "toggle-button";
  button.type = "button";

  const applyToggleState = (value) => {
    const isOn = value === control.onValue;
    button.setAttribute("aria-pressed", String(isOn));
    button.textContent = isOn ? `On (${control.onValue})` : `Off (${control.offValue})`;
    updateControlValue(control, value);
  };

  applyToggleState(currentValue === control.onValue ? control.onValue : control.offValue);
  button.addEventListener("click", () => {
    const isOn = button.getAttribute("aria-pressed") === "true";
    applyToggleState(isOn ? control.offValue : control.onValue);
  });

  return button;
}

function renderSwitchControl(control) {
  const row = document.createElement("div");
  row.className = "switch-row";
  const currentValue = getControlValue(control);

  for (const position of control.positions) {
    const option = document.createElement("button");
    option.className = "switch-option";
    option.type = "button";
    option.dataset.value = String(position.value);
    option.textContent = position.label;

    if (position.range) {
      const range = document.createElement("span");
      range.className = "option-range";
      range.textContent = position.range;
      option.append(range);
    }

    if (position.value === currentValue) {
      option.classList.add("is-active");
    }

    option.addEventListener("click", () => {
      for (const sibling of row.querySelectorAll(".switch-option")) {
        sibling.classList.remove("is-active");
      }
      option.classList.add("is-active");
      updateControlValue(control, position.value);
    });

    row.append(option);
  }

  if (!row.querySelector(".is-active") && row.firstElementChild) {
    row.firstElementChild.classList.add("is-active");
  }

  return row;
}

function updateControlValue(control, value) {
  const midiValue = coerceMidiValue(value);
  state.values.set(String(control.cc), midiValue);
  sendControlChange(control.cc, midiValue);
}

function getControlValue(control) {
  const storedValue = state.values.get(String(control.cc));
  if (Number.isFinite(storedValue)) {
    return storedValue;
  }
  if (Number.isFinite(control.value)) {
    return coerceMidiValue(control.value);
  }
  if (control.type === "switch" && control.positions.length) {
    return control.positions[0].value;
  }
  if (control.type === "toggle-button") {
    return control.offValue;
  }
  return 0;
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    setMidiStatus("Web MIDI is not available in this browser.", "error");
    return;
  }

  try {
    setMidiStatus("Requesting MIDI access...", "");
    state.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    state.midiAccess.onstatechange = refreshMidiOutputs;
    refreshMidiOutputs();
  } catch (error) {
    const message = error instanceof Error ? error.message : "MIDI access was denied.";
    setMidiStatus(message, "error");
  }
}

function refreshMidiOutputs() {
  const previousOutputId = state.midiOutput ? state.midiOutput.id : "";
  elements.midiOutput.innerHTML = "";

  if (!state.midiAccess) {
    const option = document.createElement("option");
    option.textContent = "Connect MIDI first";
    option.value = "";
    elements.midiOutput.append(option);
    elements.midiOutput.disabled = true;
    return;
  }

  const outputs = Array.from(state.midiAccess.outputs.values());
  elements.midiOutput.disabled = outputs.length === 0;

  if (!outputs.length) {
    const option = document.createElement("option");
    option.textContent = "No outputs found";
    option.value = "";
    elements.midiOutput.append(option);
    state.midiOutput = null;
    setMidiStatus("MIDI connected, but no outputs were found.", "error");
    return;
  }

  for (const output of outputs) {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.manufacturer
      ? `${output.name || output.id} - ${output.manufacturer}`
      : output.name || output.id;
    elements.midiOutput.append(option);
  }

  const targetOutput = outputs.find((output) => output.id === previousOutputId) || outputs[0];
  elements.midiOutput.value = targetOutput.id;
  state.midiOutput = targetOutput;
  setMidiStatus(`Output: ${targetOutput.name || targetOutput.id}`, "ok");
}

function selectMidiOutput() {
  if (!state.midiAccess) {
    return;
  }

  const outputId = elements.midiOutput.value;
  const output = Array.from(state.midiAccess.outputs.values()).find((candidate) => candidate.id === outputId);
  state.midiOutput = output || null;

  if (state.midiOutput) {
    setMidiStatus(`Output: ${state.midiOutput.name || state.midiOutput.id}`, "ok");
  } else {
    setMidiStatus("No MIDI output selected.", "error");
  }
}

function sendControlChange(cc, value) {
  const output = state.midiOutput;
  const channel = selectedChannelIndex();
  const midiValue = coerceMidiValue(value);
  if (!output) {
    logEvent(`CC ${cc} = ${midiValue} queued: no output selected.`);
    return;
  }

  output.send([0xb0 + channel, cc, midiValue]);
  logEvent(`Sent CC ${cc} = ${midiValue} on channel ${channel + 1}.`);
}

function playMiddleC() {
  const output = state.midiOutput;
  const channel = selectedChannelIndex();
  if (!output) {
    logEvent("Middle C not sent: no output selected.");
    return;
  }

  output.send([0x90 + channel, MIDI_NOTE_MIDDLE_C, MIDI_NOTE_VELOCITY]);
  window.setTimeout(() => {
    output.send([0x80 + channel, MIDI_NOTE_MIDDLE_C, 0]);
  }, 420);
  logEvent(`Sent middle C on channel ${channel + 1}.`);
}

function syncLoopPlayback() {
  if (elements.loopNote.checked) {
    stopLoopPlayback();
    playMiddleC();
    state.loopTimer = window.setInterval(playMiddleC, LOOP_INTERVAL_MS);
    return;
  }
  stopLoopPlayback();
}

function stopLoopPlayback() {
  if (state.loopTimer) {
    window.clearInterval(state.loopTimer);
    state.loopTimer = null;
  }
}

function selectedChannelIndex() {
  const channel = Number.parseInt(elements.midiChannel.value, 10);
  if (!Number.isFinite(channel)) {
    return 0;
  }
  return Math.min(15, Math.max(0, channel - 1));
}

function setMidiStatus(message, stateName) {
  elements.midiStatus.textContent = message;
  elements.midiStatus.classList.toggle("is-error", stateName === "error");
  elements.midiStatus.classList.toggle("is-ok", stateName === "ok");
}

function logEvent(message) {
  const now = new Date();
  elements.eventLog.textContent = `${now.toLocaleTimeString()} - ${message}`;
}

function validateInstrument(raw) {
  if (!isPlainObject(raw)) {
    throw new Error("Instrument YAML must be a mapping.");
  }

  const name = stringOr(raw.name, "").trim();
  if (!name) {
    throw new Error("Instrument YAML needs a name.");
  }

  const sections = raw.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error("Instrument YAML needs at least one section.");
  }
  if (!isPlainObject(raw.theme) || !isPlainObject(raw.theme.colors)) {
    throw new Error("Instrument YAML needs a theme with colors.");
  }

  const instrument = {
    name,
    theme: normalizeTheme(raw.theme, name),
    sections: [],
  };

  for (const section of sections) {
    instrument.sections.push(validateSection(section));
  }

  return instrument;
}

function validateSection(rawSection) {
  if (!isPlainObject(rawSection)) {
    throw new Error("Each section must be a mapping.");
  }

  const name = stringOr(rawSection.name, "").trim();
  if (!name) {
    throw new Error("Each section needs a name.");
  }

  if (!Array.isArray(rawSection.controls) || rawSection.controls.length === 0) {
    throw new Error(`Section "${name}" needs at least one control.`);
  }

  return {
    name,
    controls: rawSection.controls.map((control) => validateControl(control, name)),
  };
}

function validateControl(rawControl, sectionName) {
  if (!isPlainObject(rawControl)) {
    throw new Error(`A control in section "${sectionName}" must be a mapping.`);
  }

  const cc = Number(rawControl.cc);
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) {
    throw new Error(`Control "${rawControl.label || "unnamed"}" needs a CC number from 0 to 127.`);
  }

  const label = stringOr(rawControl.label || rawControl.description, "").trim();
  if (!label) {
    throw new Error(`CC ${cc} needs a label.`);
  }

  const type = normalizeControlType(rawControl.type);
  if (!allowedControlTypes.has(type)) {
    throw new Error(`CC ${cc} "${label}" has unsupported type "${rawControl.type}".`);
  }

  const control = {
    cc,
    label,
    description: stringOr(rawControl.description, ""),
    type,
    positions: [],
    onValue: coerceMidiValue(rawControl.onValue ?? 127),
    offValue: coerceMidiValue(rawControl.offValue ?? 0),
  };

  if (type === "switch") {
    if (!Array.isArray(rawControl.positions) || rawControl.positions.length === 0) {
      throw new Error(`Switch CC ${cc} "${label}" needs positions.`);
    }
    control.positions = rawControl.positions.map((position) => validatePosition(position, cc, label));
  }

  return control;
}

function validatePosition(rawPosition, cc, controlLabel) {
  if (!isPlainObject(rawPosition)) {
    throw new Error(`A position for CC ${cc} "${controlLabel}" must be a mapping.`);
  }

  const label = stringOr(rawPosition.label, "").trim();
  const value = Number(rawPosition.value);
  if (!label) {
    throw new Error(`A position for CC ${cc} "${controlLabel}" needs a label.`);
  }
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new Error(`Position "${label}" for CC ${cc} needs a value from 0 to 127.`);
  }

  const position = {
    label,
    value,
  };

  if (rawPosition.range !== undefined) {
    position.range = String(rawPosition.range);
  }

  return position;
}

function normalizeTheme(rawTheme, fallbackName) {
  const theme = isPlainObject(rawTheme) ? rawTheme : {};
  const colors = isPlainObject(theme.colors) ? theme.colors : {};
  return {
    name: stringOr(theme.name, fallbackName),
    colors,
  };
}

function normalizeControlType(type) {
  const normalized = String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (normalized === "vertical" || normalized === "vertical-slider") {
    return "vertical-slider";
  }
  if (normalized === "horizontal" || normalized === "horizontal-slider" || normalized === "slider") {
    return "horizontal-slider";
  }
  if (normalized === "toggle" || normalized === "toggle-button") {
    return "toggle-button";
  }
  if (normalized === "multi-position-switch" || normalized === "position-switch") {
    return "switch";
  }
  return normalized;
}

function applyTheme(theme) {
  const colorMap = {
    background: "--background",
    panel: "--panel",
    panelAlt: "--panel-alt",
    panel_alt: "--panel-alt",
    text: "--text",
    muted: "--muted",
    primary: "--primary",
    accent: "--accent",
    danger: "--danger",
  };

  for (const [key, cssVariable] of Object.entries(colorMap)) {
    const value = theme.colors[key];
    if (isSafeCssColor(value)) {
      document.documentElement.style.setProperty(cssVariable, value);
    }
  }
}

function isSafeCssColor(value) {
  if (typeof value !== "string" || value.length > 80) {
    return false;
  }
  const trimmed = value.trim();
  return (
    /^#[0-9a-f]{3,8}$/i.test(trimmed) ||
    /^rgb(a)?\([0-9%,.\s]+\)$/i.test(trimmed) ||
    /^hsl(a)?\([0-9%,.\s]+\)$/i.test(trimmed) ||
    /^[a-z]+$/i.test(trimmed)
  );
}

function coerceMidiValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(127, Math.max(0, Math.round(parsed)));
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseYaml(source) {
  const lines = prepareYamlLines(source);
  if (!lines.length) {
    return {};
  }
  const [value, index] = parseYamlBlock(lines, 0, lines[0].indent);
  if (index < lines.length) {
    throw new Error(`Unexpected YAML content on line ${lines[index].lineNumber}.`);
  }
  return value;
}

function prepareYamlLines(source) {
  return source
    .replace(/\t/g, "  ")
    .split(/\r?\n/)
    .map((raw, index) => {
      const clean = stripYamlComment(raw).replace(/\s+$/g, "");
      return {
        indent: clean.match(/^ */)[0].length,
        content: clean.trim(),
        lineNumber: index + 1,
      };
    })
    .filter((line) => line.content.length > 0);
}

function stripYamlComment(line) {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = index === 0 ? " " : line[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && /\s/.test(previous)) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseYamlBlock(lines, index, indent) {
  const line = lines[index];
  if (!line || line.indent < indent) {
    return [null, index];
  }
  if (line.indent !== indent) {
    throw new Error(`Unexpected indentation on line ${line.lineNumber}.`);
  }
  return line.content.startsWith("- ")
    ? parseYamlArray(lines, index, indent)
    : parseYamlObject(lines, index, indent);
}

function parseYamlObject(lines, index, indent) {
  const result = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation on line ${line.lineNumber}.`);
    }
    if (line.content.startsWith("- ")) {
      break;
    }

    const pair = splitYamlPair(line.content, line.lineNumber);
    cursor += 1;

    if (pair.rawValue === "") {
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseYamlBlock(lines, cursor, lines[cursor].indent);
        result[pair.key] = parsed[0];
        cursor = parsed[1];
      } else {
        result[pair.key] = null;
      }
    } else {
      result[pair.key] = parseYamlScalar(pair.rawValue);
    }
  }

  return [result, cursor];
}

function parseYamlArray(lines, index, indent) {
  const result = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation on line ${line.lineNumber}.`);
    }
    if (!line.content.startsWith("- ")) {
      break;
    }

    const itemText = line.content.slice(2).trim();
    cursor += 1;

    if (itemText === "") {
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseYamlBlock(lines, cursor, lines[cursor].indent);
        result.push(parsed[0]);
        cursor = parsed[1];
      } else {
        result.push(null);
      }
      continue;
    }

    if (isYamlPair(itemText)) {
      const item = {};
      const pair = splitYamlPair(itemText, line.lineNumber);
      if (pair.rawValue === "") {
        if (cursor < lines.length && lines[cursor].indent > indent) {
          const parsed = parseYamlBlock(lines, cursor, lines[cursor].indent);
          item[pair.key] = parsed[0];
          cursor = parsed[1];
        } else {
          item[pair.key] = null;
        }
      } else {
        item[pair.key] = parseYamlScalar(pair.rawValue);
      }

      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseYamlObject(lines, cursor, lines[cursor].indent);
        Object.assign(item, parsed[0]);
        cursor = parsed[1];
      }

      result.push(item);
      continue;
    }

    result.push(parseYamlScalar(itemText));
  }

  return [result, cursor];
}

function isYamlPair(content) {
  return findYamlColon(content) > 0;
}

function splitYamlPair(content, lineNumber) {
  const colon = findYamlColon(content);
  if (colon <= 0) {
    throw new Error(`Expected "key: value" on line ${lineNumber}.`);
  }
  const key = content.slice(0, colon).trim();
  if (!key) {
    throw new Error(`Missing YAML key on line ${lineNumber}.`);
  }
  return {
    key,
    rawValue: content.slice(colon + 1).trim(),
  };
}

function findYamlColon(content) {
  let quote = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const previous = index === 0 ? "" : content[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ":") {
      return index;
    }
  }
  return -1;
}

function parseYamlScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "") {
    return "";
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null" || value === "~") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (isWrapped(value, "\"")) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (isWrapped(value, "'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (isWrapped(value, "[")) {
    return parseInlineArray(value);
  }
  return value;
}

function parseInlineArray(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  const parts = [];
  let quote = "";
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    const previous = index === 0 ? "" : inner[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      parts.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts.map(parseYamlScalar);
}

function isWrapped(value, token) {
  if (token === "[") {
    return value.startsWith("[") && value.endsWith("]");
  }
  return value.startsWith(token) && value.endsWith(token);
}

initialize();
