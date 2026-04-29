type MidiOutputLike = MIDIOutput;
type MidiInputLike = MIDIInput;
type MidiAccessLike = MIDIAccess;

interface InstrumentDefinition {
  name: string;
  theme: InstrumentTheme;
  sections: InstrumentSection[];
}

interface InstrumentTheme {
  name: string;
  colors: Record<string, string>;
}

interface InstrumentSection {
  name: string;
  gridColumn: string;
  controls: ControlItem[];
}

type ControlItem = ControlDefinition | VerticalSliderGroupDefinition;

interface ControlDefinition {
  cc: number;
  label: string;
  description: string;
  type: MidiControlType;
  positions: SwitchPosition[];
  onValue: number;
  offValue: number;
  min: number;
  max: number;
  value: number;
}

interface VerticalSliderGroupDefinition {
  type: "vertical-slider-group";
  description: string;
  controls: ControlDefinition[];
}

interface PatchDefinition {
  id: string;
  name: string;
  instrument: string;
  values: Record<string, number>;
  lfos?: Record<string, PatchLfoDefinition>;
  savedAt: string;
}

interface PatchLfoDefinition {
  enabled: boolean;
  depth: number;
  rate: number;
  waveform: LfoWaveform;
}

interface PresetManifestItem {
  file: string;
  name: string;
  yaml: string;
}

interface AppState {
  instrument: InstrumentDefinition | null;
  midiAccess: MidiAccessLike | null;
  midiInput: MidiInputLike | null;
  midiOutput: MidiOutputLike | null;
  incomingEventCount: number;
  loopTimer: number | null;
  lfoTimer: number | null;
  lfoModal: HTMLElement | null;
  reloadTimer: number | null;
  values: Map<string, number>;
  lfos: Map<string, LfoState>;
  highlightTimers: Map<number, number>;
  patches: Record<string, PatchDefinition[]>;
}

interface SwitchPosition {
  label: string;
  value: number;
  range?: string;
}

type MidiControlType =
  | "vertical-slider"
  | "horizontal-slider"
  | "switch"
  | "toggle-button";

type ControlType = MidiControlType | "vertical-slider-group";
type LfoWaveform = "triangle" | "saw" | "reverse-saw" | "square" | "sine";

interface LfoState {
  cc: number;
  enabled: boolean;
  depth: number;
  rate: number;
  waveform: LfoWaveform;
  baseValue: number;
  startedAt: number;
  lastSentAt: number;
  lastValue: number | null;
}

const DEFAULT_INSTRUMENT_YAML = "__DEFAULT_INSTRUMENT_YAML__" as string;
const PRESET_MANIFEST = "__PRESET_MANIFEST__" as unknown as PresetManifestItem[];
const MIDI_NOTE_MIDDLE_C = 60;
const MIDI_NOTE_VELOCITY = 96;
const LOOP_INTERVAL_MS = 3000;
const YAML_RELOAD_DELAY_MS = 220;
const MAX_INCOMING_LOG_EVENTS = 250;
const MIDI_START = 0xfa;
const MIDI_STOP = 0xfc;
const PATCH_STORAGE_KEY = "multimidi.patches.v1";
const CUSTOM_PRESET_VALUE = "__custom__";
const LFO_DEFAULT_RATE_HZ = 1;
const LFO_MIN_RATE_HZ = 0.1;
const LFO_MAX_RATE_HZ = 50;
const LFO_MIN_ENGINE_DELAY_MS = 4;
const LFO_MAX_ENGINE_DELAY_MS = 500;
const LFO_CLASSIC_MIDI_BAUD = 31250;
const LFO_BITS_PER_CONTROL_CHANGE = 30;
const LFO_BANDWIDTH_HEADROOM = 0.65;
const LFO_MAX_TOTAL_SENDS_PER_SECOND = Math.floor(
  (LFO_CLASSIC_MIDI_BAUD / LFO_BITS_PER_CONTROL_CHANGE) * LFO_BANDWIDTH_HEADROOM,
);
const LFO_MAX_CONTROL_SENDS_PER_SECOND = 240;
const LFO_MIN_CONTROL_SENDS_PER_SECOND = 2;
const LFO_TAU = Math.PI * 2;

const lfoWaveformOptions: { value: LfoWaveform; label: string }[] = [
  { value: "triangle", label: "Triangle" },
  { value: "saw", label: "Saw" },
  { value: "reverse-saw", label: "Reverse saw" },
  { value: "square", label: "Square" },
  { value: "sine", label: "Sine" },
];

const allowedControlTypes = new Set<ControlType>([
  "vertical-slider",
  "vertical-slider-group",
  "horizontal-slider",
  "switch",
  "toggle-button",
]);

const state: AppState = {
  instrument: null,
  midiAccess: null,
  midiInput: null,
  midiOutput: null,
  incomingEventCount: 0,
  loopTimer: null,
  lfoTimer: null,
  lfoModal: null,
  reloadTimer: null,
  values: new Map<string, number>(),
  lfos: new Map<string, LfoState>(),
  highlightTimers: new Map<number, number>(),
  patches: {},
};

const elements = {
  presetSelect: byId("preset-select"),
  yamlEditor: byId("yaml-editor"),
  yamlFile: byId("yaml-file"),
  parseStatus: byId("parse-status"),
  patchHeading: byId("patch-heading"),
  patchName: byId("patch-name"),
  patchList: byId("patch-list"),
  savePatch: byId("save-patch"),
  exportPatches: byId("export-patches"),
  patchStatus: byId("patch-status"),
  instrumentTitle: byId("instrument-title"),
  controlSummary: byId("control-summary"),
  controlsGrid: byId("controls-grid"),
  randomiseControls: byId("randomise-controls"),
  connectMidi: byId("connect-midi"),
  midiStatus: byId("midi-status"),
  midiChannel: byId("midi-channel"),
  midiInput: byId("midi-input"),
  midiOutput: byId("midi-output"),
  playNote: byId("play-note"),
  loopNote: byId("loop-note"),
  sendStart: byId("send-start"),
  sendStop: byId("send-stop"),
  eventLog: byId("event-log"),
  incomingEventCount: byId("incoming-event-count"),
  incomingEventLog: byId("incoming-event-log"),
  clearIncomingEvents: byId("clear-incoming-events"),
};

function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as any;
}

function initialize() {
  state.patches = loadPatchLibrary();
  populateMidiChannels();
  populatePresetSelect();
  elements.yamlEditor.value = DEFAULT_INSTRUMENT_YAML;
  updateYamlEditorVisibility();
  elements.presetSelect.addEventListener("change", handlePresetSelection);
  elements.yamlEditor.addEventListener("input", queueYamlReload);
  elements.yamlFile.addEventListener("change", handleYamlFile);
  elements.savePatch.addEventListener("click", saveCurrentPatch);
  elements.exportPatches.addEventListener("click", exportCurrentInstrumentPatches);
  elements.connectMidi.addEventListener("click", connectMidi);
  elements.midiInput.addEventListener("change", selectMidiInput);
  elements.midiOutput.addEventListener("change", selectMidiOutput);
  elements.playNote.addEventListener("click", playMiddleC);
  elements.loopNote.addEventListener("change", syncLoopPlayback);
  elements.sendStart.addEventListener("click", sendMidiStart);
  elements.sendStop.addEventListener("click", sendMidiStop);
  elements.randomiseControls.addEventListener("click", randomiseControls);
  elements.clearIncomingEvents.addEventListener("click", clearIncomingEvents);
  window.addEventListener("beforeunload", stopLoopPlayback);
  window.addEventListener("beforeunload", stopAllLfos);
  renderEmptyMidiSelect(elements.midiInput, "Connect MIDI first");
  renderEmptyMidiSelect(elements.midiOutput, "Connect MIDI first");
  loadYaml(DEFAULT_INSTRUMENT_YAML);
}

function populatePresetSelect() {
  elements.presetSelect.innerHTML = "";

  for (const preset of PRESET_MANIFEST) {
    const option = document.createElement("option");
    option.value = preset.file;
    option.textContent = preset.name;
    elements.presetSelect.append(option);
  }

  const customOption = document.createElement("option");
  customOption.value = CUSTOM_PRESET_VALUE;
  customOption.textContent = "Custom";
  elements.presetSelect.append(customOption);

  const defaultPreset = PRESET_MANIFEST.find((preset) => preset.yaml === DEFAULT_INSTRUMENT_YAML) || PRESET_MANIFEST[0];
  if (defaultPreset) {
    elements.presetSelect.value = defaultPreset.file;
  } else {
    elements.presetSelect.value = CUSTOM_PRESET_VALUE;
  }
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
  elements.presetSelect.value = CUSTOM_PRESET_VALUE;
  updateYamlEditorVisibility();
  window.clearTimeout(state.reloadTimer);
  state.reloadTimer = window.setTimeout(() => {
    loadYaml(elements.yamlEditor.value);
  }, YAML_RELOAD_DELAY_MS);
}

function handlePresetSelection() {
  updateYamlEditorVisibility();
  if (elements.presetSelect.value === CUSTOM_PRESET_VALUE) {
    return;
  }

  const preset = PRESET_MANIFEST.find((candidate) => candidate.file === elements.presetSelect.value);
  if (!preset) {
    return;
  }

  elements.yamlEditor.value = preset.yaml;
  loadYaml(preset.yaml);
}

function handleYamlFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    elements.presetSelect.value = CUSTOM_PRESET_VALUE;
    updateYamlEditorVisibility();
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
    stopAllLfos();
    state.instrument = instrument;
    renderInstrument(instrument);
    renderPatches();
    applyTheme(instrument.theme);
    setParseStatus("", "");
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
  return instrument.sections.reduce(
    (count, section) => count + section.controls.reduce((sectionCount, control) => {
      if (isVerticalSliderGroup(control)) {
        return sectionCount + control.controls.length;
      }
      return sectionCount + 1;
    }, 0),
    0,
  );
}

function instrumentKey() {
  return state.instrument ? state.instrument.name : "";
}

function getInstrumentControls(instrument = state.instrument) {
  if (!instrument) {
    return [];
  }

  const controls = [];
  for (const section of instrument.sections) {
    for (const control of section.controls) {
      if (isVerticalSliderGroup(control)) {
        controls.push(...control.controls);
      } else {
        controls.push(control);
      }
    }
  }
  return controls;
}

function updateYamlEditorVisibility() {
  elements.yamlEditor.hidden = elements.presetSelect.value !== CUSTOM_PRESET_VALUE;
}

function renderInstrument(instrument) {
  elements.instrumentTitle.textContent = instrument.name;
  elements.controlSummary.textContent = `${countControls(instrument)} MIDI CC controls`;
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
    if (section.gridColumn) {
      sectionElement.style.gridColumn = section.gridColumn;
    }

    const heading = document.createElement("h3");
    heading.textContent = section.name;
    sectionElement.append(heading);

    const controls = document.createElement("div");
    controls.className = "section-controls";
    for (const control of section.controls) {
      controls.append(renderControlItem(control));
    }

    sectionElement.append(controls);
    elements.controlsGrid.append(sectionElement);
  }
}

function renderPatches() {
  const patches = getCurrentInstrumentPatches();
  elements.patchHeading.textContent = state.instrument ? `Patches for ${state.instrument.name}` : "Patches";
  elements.patchList.innerHTML = "";
  const hasPatches = patches.length > 0;

  if (!hasPatches) {
    const empty = document.createElement("li");
    empty.className = "patch-empty";
    empty.textContent = state.instrument ? "No patches saved" : "Load an instrument first";
    elements.patchList.append(empty);
    elements.patchStatus.textContent = state.instrument ? "No patches saved." : "Load an instrument to save patches.";
  } else {
    for (const patch of patches) {
      elements.patchList.append(renderPatchRow(patch));
    }
    elements.patchStatus.textContent = `${patches.length} saved patch${patches.length === 1 ? "" : "es"}.`;
  }

  elements.exportPatches.disabled = !hasPatches;
  elements.savePatch.disabled = !state.instrument;
}

function renderPatchRow(patch) {
  const row = document.createElement("li");
  row.className = "patch-row";

  const name = document.createElement("div");
  name.className = "patch-row-name";
  name.textContent = patch.name;

  const actions = document.createElement("div");
  actions.className = "patch-row-actions";

  const load = document.createElement("button");
  load.className = "ghost-action";
  load.type = "button";
  load.textContent = "load";
  load.addEventListener("click", () => loadPatch(patch));

  const deleteButton = document.createElement("button");
  deleteButton.className = "ghost-action";
  deleteButton.type = "button";
  deleteButton.textContent = "delete";
  deleteButton.addEventListener("click", () => deletePatch(patch));

  actions.append(load, deleteButton);
  row.append(name, actions);
  return row;
}

function getCurrentInstrumentPatches() {
  const key = instrumentKey();
  if (!key || !Array.isArray(state.patches[key])) {
    return [];
  }
  return state.patches[key];
}

function saveCurrentPatch() {
  if (!state.instrument) {
    elements.patchStatus.textContent = "Load an instrument before saving a patch.";
    return;
  }

  const name = elements.patchName.value.trim();
  if (!name) {
    elements.patchStatus.textContent = "Name the patch before saving it.";
    elements.patchName.focus();
    return;
  }

  const key = instrumentKey();
  const patch = {
    id: createPatchId(),
    name,
    instrument: key,
    values: serializeCurrentPatchValues(),
    lfos: serializeCurrentPatchLfos(),
    savedAt: new Date().toISOString(),
  };
  state.patches[key] = [...getCurrentInstrumentPatches().filter((candidate) => candidate.name !== name), patch];
  const didPersist = savePatchLibrary();
  elements.patchName.value = "";
  renderPatches();
  elements.patchStatus.textContent = didPersist
    ? `Saved "${patch.name}".`
    : `Saved "${patch.name}" for this session, but browser storage failed.`;
}

function serializeCurrentPatchValues() {
  const values = {};
  for (const control of getInstrumentControls()) {
    values[String(control.cc)] = getPatchControlValue(control);
  }
  return values;
}

function loadPatch(patch) {
  stopAllLfos();
  applyPatchValues(patch.values);
  applyPatchLfos(patch.lfos);
  elements.patchStatus.textContent = `Loaded "${patch.name}".`;
}

function applyPatchValues(values) {
  for (const control of getInstrumentControls()) {
    const value = values[String(control.cc)];
    if (Number.isFinite(Number(value))) {
      updateControlValue(control, value);
    }
  }
}

function serializeCurrentPatchLfos() {
  const lfos = {};
  for (const control of getInstrumentControls()) {
    if (!isSliderControl(control)) {
      continue;
    }

    const lfo = state.lfos.get(String(control.cc));
    if (lfo) {
      lfos[String(control.cc)] = serializeLfoState(control, lfo);
    }
  }
  return lfos;
}

function serializeLfoState(control, lfo): PatchLfoDefinition {
  return {
    enabled: lfo.enabled,
    depth: normalizeLfoDepth(control, lfo.depth),
    rate: normalizeLfoRate(lfo.rate),
    waveform: normalizeLfoWaveform(lfo.waveform),
  };
}

function getPatchControlValue(control) {
  const lfo = state.lfos.get(String(control.cc));
  if (lfo?.enabled && isSliderControl(control)) {
    return normalizeControlValue(control, lfo.baseValue);
  }
  return getControlValue(control);
}

function applyPatchLfos(lfos) {
  if (!isPlainObject(lfos)) {
    return;
  }

  for (const [cc, rawLfo] of Object.entries(lfos)) {
    const control = findControlByCc(Number(cc));
    if (!control || !isSliderControl(control)) {
      continue;
    }

    const lfo = normalizePatchLfo(control, rawLfo);
    if (!lfo) {
      continue;
    }

    state.lfos.set(String(control.cc), {
      cc: control.cc,
      enabled: lfo.enabled,
      depth: lfo.depth,
      rate: lfo.rate,
      waveform: lfo.waveform,
      baseValue: getControlValue(control),
      startedAt: lfoNow(),
      lastSentAt: 0,
      lastValue: null,
    });
    syncLfoPresentation(control);
  }

  if (hasActiveLfos()) {
    startLfoEngine();
  }
}

function normalizePatchLfo(control, rawLfo): PatchLfoDefinition | null {
  if (!isPlainObject(rawLfo)) {
    return null;
  }

  return {
    enabled: rawLfo.enabled === true,
    depth: normalizeLfoDepth(control, rawLfo.depth),
    rate: normalizeLfoRate(rawLfo.rate),
    waveform: normalizeLfoWaveform(rawLfo.waveform),
  };
}

function deletePatch(patch) {
  const key = instrumentKey();
  state.patches[key] = getCurrentInstrumentPatches().filter((candidate) => candidate.id !== patch.id);
  const didPersist = savePatchLibrary();
  renderPatches();
  elements.patchStatus.textContent = didPersist
    ? `Deleted "${patch.name}".`
    : `Deleted "${patch.name}" for this session, but browser storage failed.`;
}

function exportCurrentInstrumentPatches() {
  const patches = getCurrentInstrumentPatches();
  if (!patches.length || !state.instrument) {
    return;
  }

  const yaml = formatPatchesYaml(state.instrument.name, patches);
  downloadText(`${safeFilename(state.instrument.name)}-patches.yaml`, yaml);
  elements.patchStatus.textContent = `Exported ${patches.length} patch${patches.length === 1 ? "" : "es"}.`;
}

/**
 * @param {string} instrumentName
 * @param {PatchDefinition[]} patches
 */
function formatPatchesYaml(instrumentName, patches) {
  const lines = [
    `instrument: ${quoteYamlString(instrumentName)}`,
    "patches:",
  ];

  for (const patch of patches) {
    lines.push(`  - name: ${quoteYamlString(patch.name)}`);
    lines.push(`    savedAt: ${quoteYamlString(patch.savedAt)}`);
    lines.push("    values:");
    for (const [cc, value] of Object.entries(patch.values).sort((left, right) => Number(left[0]) - Number(right[0]))) {
      lines.push(`      ${quoteYamlString(cc)}: ${coerceMidiValue(value)}`);
    }
    const lfoEntries = Object.entries(patch.lfos || {}).sort((left, right) => Number(left[0]) - Number(right[0]));
    if (lfoEntries.length) {
      lines.push("    lfos:");
      for (const [cc, rawLfo] of lfoEntries) {
        if (!isPlainObject(rawLfo)) {
          continue;
        }
        const lfo = rawLfo as Record<string, unknown>;
        lines.push(`      ${quoteYamlString(cc)}:`);
        lines.push(`        enabled: ${lfo.enabled === true ? "true" : "false"}`);
        lines.push(`        depth: ${coerceMidiValue(lfo.depth)}`);
        lines.push(`        rate: ${formatYamlNumber(normalizeLfoRate(lfo.rate))}`);
        lines.push(`        waveform: ${quoteYamlString(normalizeLfoWaveform(lfo.waveform))}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatYamlNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function loadPatchLibrary() {
  try {
    if (typeof localStorage === "undefined") {
      return {};
    }
    const raw = localStorage.getItem(PATCH_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savePatchLibrary() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PATCH_STORAGE_KEY, JSON.stringify(state.patches));
    }
    return true;
  } catch {
    elements.patchStatus.textContent = "Could not persist patches in this browser.";
    return false;
  }
}

function createPatchId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function quoteYamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function safeFilename(value) {
  const safe = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return safe || "multimidi";
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderControlItem(control) {
  if (isVerticalSliderGroup(control)) {
    return renderVerticalSliderGroup(control);
  }
  return renderControl(control);
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
    label.title = control.description;
  }

  const actions = document.createElement("div");
  actions.className = "control-actions";

  const badge = document.createElement("div");
  badge.className = "cc-badge";
  badge.textContent = `CC ${control.cc}`;

  actions.append(badge);
  if (isSliderControl(control)) {
    actions.append(renderLfoButton(control));
  }

  header.append(title, actions);
  wrapper.append(header);

  if (isSliderControl(control)) {
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
  range.min = String(control.min);
  range.max = String(control.max);
  range.value = String(currentValue);
  range.setAttribute("aria-label", control.label);

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(control.min);
  number.max = String(control.max);
  number.value = String(currentValue);
  number.setAttribute("aria-label", `${control.label} value`);

  const syncValue = (value) => {
    const midiValue = normalizeControlValue(control, value);
    range.value = String(midiValue);
    number.value = String(midiValue);
    updateControlValue(control, midiValue);
  };

  range.addEventListener("input", () => syncValue(range.value));
  number.addEventListener("input", () => syncValue(number.value));

  shell.append(renderSliderLane(control, range, currentValue), number);

  return shell;
}

function renderVerticalSliderGroup(group) {
  const wrapper = document.createElement("article");
  wrapper.className = "control vertical-slider-group";

  const sliders = document.createElement("div");
  sliders.className = "vertical-slider-group-controls";
  if (group.description) {
    sliders.title = group.description;
  }
  for (const control of group.controls) {
    sliders.append(renderGroupedVerticalSlider(control));
  }

  wrapper.append(sliders);
  return wrapper;
}

function renderGroupedVerticalSlider(control) {
  const currentValue = getControlValue(control);
  const item = document.createElement("div");
  item.className = "vertical-slider-control";
  item.dataset.cc = String(control.cc);

  const label = document.createElement("div");
  label.className = "vertical-slider-label";
  label.textContent = control.label;
  if (control.description) {
    label.title = control.description;
  }

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(control.min);
  range.max = String(control.max);
  range.value = String(currentValue);
  range.setAttribute("aria-label", control.label);

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(control.min);
  number.max = String(control.max);
  number.value = String(currentValue);
  number.setAttribute("aria-label", `${control.label} value`);

  const cc = document.createElement("div");
  cc.className = "vertical-slider-cc";
  cc.textContent = `CC ${control.cc}`;

  const meta = document.createElement("div");
  meta.className = "vertical-slider-meta";
  meta.append(cc, renderLfoButton(control));

  const syncValue = (value) => {
    const midiValue = normalizeControlValue(control, value);
    range.value = String(midiValue);
    number.value = String(midiValue);
    updateControlValue(control, midiValue);
  };

  range.addEventListener("input", () => syncValue(range.value));
  number.addEventListener("input", () => syncValue(number.value));

  item.append(label, renderSliderLane(control, range, currentValue), number, meta);
  return item;
}

function renderSliderLane(control, range, value) {
  const lane = document.createElement("div");
  lane.className = `slider-lane ${control.type === "vertical-slider" ? "is-vertical" : "is-horizontal"}`;
  lane.dataset.lfoLaneCc = String(control.cc);

  const ghost = document.createElement("div");
  ghost.className = "lfo-ghost";
  ghost.setAttribute("aria-hidden", "true");

  lane.append(ghost, range);
  updateLfoLane(lane, control, value, isLfoEnabled(control));
  return lane;
}

function renderLfoButton(control) {
  const button = document.createElement("button");
  button.className = "lfo-button";
  button.type = "button";
  button.textContent = "LFO";
  button.dataset.lfoCc = String(control.cc);
  button.setAttribute("aria-label", `${control.label} LFO`);
  button.setAttribute("aria-pressed", String(isLfoEnabled(control)));
  button.addEventListener("click", () => openLfoModal(control));
  return button;
}

function openLfoModal(control) {
  const lfo = getOrCreateLfo(control);
  const modal = ensureLfoModal();
  modal.innerHTML = "";
  modal.hidden = false;
  modal.classList.add("is-open");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "lfo-modal-title");

  const dialog = document.createElement("div");
  dialog.className = "lfo-dialog";

  const header = document.createElement("div");
  header.className = "lfo-dialog-header";

  const title = document.createElement("h2");
  title.id = "lfo-modal-title";
  title.textContent = `${control.label} LFO`;

  const close = document.createElement("button");
  close.className = "lfo-close";
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", closeLfoModal);

  header.append(title, close);

  const form = document.createElement("div");
  form.className = "lfo-form";

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "lfo-toggle-row";

  const enabledText = document.createElement("span");
  enabledText.textContent = "On/off";

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = lfo.enabled;
  enabled.setAttribute("aria-label", `${control.label} LFO on/off`);

  enabledLabel.append(enabledText, enabled);

  const depthValue = document.createElement("output");
  const depth = createLfoRange(
    "Depth",
    0,
    maxLfoDepth(control),
    1,
    lfo.depth,
    `${control.label} LFO depth`,
    depthValue,
  );

  const rateValue = document.createElement("output");
  const rate = createLfoRange(
    "Rate",
    LFO_MIN_RATE_HZ,
    LFO_MAX_RATE_HZ,
    0.1,
    lfo.rate,
    `${control.label} LFO rate`,
    rateValue,
  );

  const waveformField = document.createElement("label");
  waveformField.className = "lfo-field";

  const waveformHeader = document.createElement("span");
  waveformHeader.className = "lfo-field-header";
  waveformHeader.textContent = "Waveform";

  const waveform = document.createElement("select");
  waveform.setAttribute("aria-label", `${control.label} LFO waveform`);
  for (const optionDefinition of lfoWaveformOptions) {
    const option = document.createElement("option");
    option.value = optionDefinition.value;
    option.textContent = optionDefinition.label;
    waveform.append(option);
  }
  waveform.value = lfo.waveform;

  waveformField.append(waveformHeader, waveform);
  form.append(enabledLabel, depth.field, rate.field, waveformField);
  dialog.append(header, form);
  modal.append(dialog);

  const syncModalValues = () => {
    depthValue.textContent = String(lfo.depth);
    rateValue.textContent = formatLfoRateLabel(control, lfo);
  };

  syncModalValues();

  enabled.addEventListener("change", () => {
    setLfoEnabled(control, enabled.checked);
    syncModalValues();
  });

  depth.input.addEventListener("input", () => {
    lfo.depth = normalizeLfoDepth(control, depth.input.value);
    lfo.lastValue = null;
    depth.input.value = String(lfo.depth);
    syncModalValues();
  });

  rate.input.addEventListener("input", () => {
    lfo.rate = normalizeLfoRate(rate.input.value);
    rate.input.value = String(lfo.rate);
    syncModalValues();
  });

  waveform.addEventListener("change", () => {
    lfo.waveform = normalizeLfoWaveform(waveform.value);
    lfo.lastValue = null;
    syncModalValues();
  });

  modal.addEventListener("click", closeLfoModalFromBackdrop);
  document.addEventListener("keydown", closeLfoModalFromKeyboard);
}

function ensureLfoModal() {
  if (state.lfoModal) {
    return state.lfoModal;
  }

  const modal = document.createElement("div");
  modal.className = "lfo-modal";
  modal.hidden = true;
  document.body.append(modal);
  state.lfoModal = modal;
  return modal;
}

function closeLfoModal() {
  if (!state.lfoModal) {
    return;
  }

  state.lfoModal.hidden = true;
  state.lfoModal.classList.remove("is-open");
  state.lfoModal.removeEventListener("click", closeLfoModalFromBackdrop);
  document.removeEventListener("keydown", closeLfoModalFromKeyboard);
}

function closeLfoModalFromBackdrop(event) {
  if (event.target === state.lfoModal) {
    closeLfoModal();
  }
}

function closeLfoModalFromKeyboard(event) {
  if (event.key === "Escape") {
    closeLfoModal();
  }
}

function createLfoRange(labelText, min, max, step, value, ariaLabel, valueElement) {
  const field = document.createElement("label");
  field.className = "lfo-field";

  const header = document.createElement("span");
  header.className = "lfo-field-header";

  const label = document.createElement("span");
  label.textContent = labelText;

  valueElement.className = "lfo-value";
  header.append(label, valueElement);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute("aria-label", ariaLabel);

  field.append(header, input);
  return { field, input };
}

function getOrCreateLfo(control) {
  const key = String(control.cc);
  const existing = state.lfos.get(key);
  if (existing) {
    existing.depth = normalizeLfoDepth(control, existing.depth);
    existing.rate = normalizeLfoRate(existing.rate);
    existing.waveform = normalizeLfoWaveform(existing.waveform);
    return existing;
  }

  const lfo: LfoState = {
    cc: control.cc,
    enabled: false,
    depth: normalizeLfoDepth(control, Math.round(maxLfoDepth(control) / 2)),
    rate: LFO_DEFAULT_RATE_HZ,
    waveform: "triangle",
    baseValue: getControlValue(control),
    startedAt: lfoNow(),
    lastSentAt: 0,
    lastValue: null,
  };
  state.lfos.set(key, lfo);
  return lfo;
}

function setLfoEnabled(control, shouldEnable) {
  const lfo = getOrCreateLfo(control);
  if (shouldEnable) {
    lfo.enabled = true;
    lfo.baseValue = getControlValue(control);
    lfo.startedAt = lfoNow();
    lfo.lastSentAt = 0;
    lfo.lastValue = null;
    startLfoEngine();
    logEvent(`${control.label} LFO on at ${formatHz(getEffectiveLfoRate(control, lfo))}.`);
  } else {
    lfo.enabled = false;
    lfo.lastValue = null;
    stopLfoEngineIfIdle();
    logEvent(`${control.label} LFO off.`);
  }
  syncLfoPresentation(control);
}

function startLfoEngine() {
  if (state.lfoTimer) {
    return;
  }
  scheduleLfoTick(0);
}

function stopLfoEngineIfIdle() {
  if (hasActiveLfos()) {
    return;
  }
  stopLfoEngine();
}

function stopLfoEngine() {
  if (!state.lfoTimer) {
    return;
  }
  window.clearTimeout(state.lfoTimer);
  state.lfoTimer = null;
}

function stopAllLfos() {
  for (const lfo of state.lfos.values()) {
    lfo.enabled = false;
    lfo.lastValue = null;
  }
  syncAllLfoPresentations();
  state.lfos.clear();
  stopLfoEngine();
  closeLfoModal();
}

function runLfoTick() {
  state.lfoTimer = null;
  const activeLfos = Array.from(state.lfos.values()).filter((lfo) => lfo.enabled);
  if (!activeLfos.length) {
    return;
  }

  const now = lfoNow();
  let nextDelay = LFO_MAX_ENGINE_DELAY_MS;
  for (const lfo of activeLfos) {
    const control = findControlByCc(lfo.cc);
    if (!control || !isSliderControl(control)) {
      lfo.enabled = false;
      continue;
    }

    const timing = calculateLfoTiming(control, lfo, activeLfos.length);
    const sendInterval = 1000 / timing.updateHz;
    const elapsedSinceSend = now - lfo.lastSentAt;
    if (elapsedSinceSend < sendInterval) {
      nextDelay = Math.min(nextDelay, sendInterval - elapsedSinceSend);
      continue;
    }

    const value = calculateLfoValue(control, lfo, now, timing.effectiveRate);
    lfo.lastSentAt = now;
    nextDelay = Math.min(nextDelay, sendInterval);
    if (value === lfo.lastValue) {
      continue;
    }

    lfo.lastValue = value;
    applyLfoControlValue(control, value);
  }

  if (hasActiveLfos()) {
    scheduleLfoTick(nextDelay);
  }
}

function scheduleLfoTick(delayMs) {
  if (state.lfoTimer) {
    return;
  }

  const delay = clampNumber(delayMs, LFO_MIN_ENGINE_DELAY_MS, LFO_MAX_ENGINE_DELAY_MS);
  state.lfoTimer = window.setTimeout(runLfoTick, delay);
}

function applyLfoControlValue(control, value) {
  const midiValue = normalizeControlValue(control, value);
  syncLfoGhost(control, midiValue);
  sendControlChange(control.cc, midiValue, false);
}

function calculateLfoValue(control, lfo, now, effectiveRate) {
  const elapsedSeconds = Math.max(0, (now - lfo.startedAt) / 1000);
  const phase = (elapsedSeconds * effectiveRate) % 1;
  const amplitude = normalizeLfoDepth(control, lfo.depth) / 2;
  const value = lfo.baseValue + sampleLfoWaveform(lfo.waveform, phase) * amplitude;
  return normalizeControlValue(control, value);
}

function calculateLfoTiming(control, lfo, activeCount) {
  const samplesPerCycle = samplesPerLfoCycle(lfo.waveform);
  const perControlBudget = Math.max(
    LFO_MIN_CONTROL_SENDS_PER_SECOND,
    Math.floor(LFO_MAX_TOTAL_SENDS_PER_SECOND / Math.max(1, activeCount)),
  );
  const maxUpdateHz = Math.min(LFO_MAX_CONTROL_SENDS_PER_SECOND, perControlBudget);
  const depthRatio = maxLfoDepth(control) > 0 ? lfo.depth / maxLfoDepth(control) : 0;
  const depthScaledSamples = Math.max(samplesPerCycle, Math.ceil(samplesPerCycle * (0.5 + depthRatio)));
  const requestedUpdateHz = lfo.rate * depthScaledSamples;
  const updateHz = clampNumber(requestedUpdateHz, LFO_MIN_CONTROL_SENDS_PER_SECOND, maxUpdateHz);
  return {
    updateHz,
    effectiveRate: Math.min(lfo.rate, updateHz / depthScaledSamples),
  };
}

function getEffectiveLfoRate(control, lfo) {
  const activeCount = Math.max(1, activeLfoCount() + (lfo.enabled ? 0 : 1));
  return calculateLfoTiming(control, lfo, activeCount).effectiveRate;
}

function sampleLfoWaveform(waveform, phase) {
  if (waveform === "sine") {
    return Math.sin(phase * LFO_TAU);
  }
  if (waveform === "square") {
    return phase < 0.5 ? 1 : -1;
  }
  if (waveform === "saw") {
    return (((phase + 0.5) % 1) * 2) - 1;
  }
  if (waveform === "reverse-saw") {
    return 1 - (((phase + 0.5) % 1) * 2);
  }
  if (phase < 0.25) {
    return phase * 4;
  }
  if (phase < 0.75) {
    return 2 - (phase * 4);
  }
  return (phase * 4) - 4;
}

function samplesPerLfoCycle(waveform) {
  if (waveform === "square") {
    return 2;
  }
  if (waveform === "saw" || waveform === "reverse-saw") {
    return 4;
  }
  return 6;
}

function maxLfoDepth(control) {
  return Math.max(0, control.max - control.min);
}

function normalizeLfoDepth(control, value) {
  return Math.round(clampNumber(Number(value), 0, maxLfoDepth(control)));
}

function normalizeLfoRate(value) {
  return Math.round(clampNumber(Number(value), LFO_MIN_RATE_HZ, LFO_MAX_RATE_HZ) * 10) / 10;
}

function normalizeLfoWaveform(value): LfoWaveform {
  return lfoWaveformOptions.some((option) => option.value === value) ? value as LfoWaveform : "triangle";
}

function formatLfoRateLabel(control, lfo) {
  const requestedRate = lfo.rate;
  const effectiveRate = getEffectiveLfoRate(control, lfo);
  if (Math.abs(requestedRate - effectiveRate) < 0.05) {
    return formatHz(requestedRate);
  }
  return `${formatHz(requestedRate)} / safe ${formatHz(effectiveRate)}`;
}

function formatHz(value) {
  return `${value.toFixed(value < 10 ? 1 : 0)} Hz`;
}

function recenterActiveLfo(control, midiValue) {
  const lfo = state.lfos.get(String(control.cc));
  if (!lfo || !lfo.enabled) {
    return;
  }
  lfo.baseValue = midiValue;
  lfo.startedAt = lfoNow();
  lfo.lastSentAt = 0;
  lfo.lastValue = null;
  syncLfoGhost(control, midiValue);
}

function syncLfoButton(control) {
  const isEnabled = isLfoEnabled(control);
  for (const button of elements.controlsGrid.querySelectorAll(".lfo-button")) {
    if (button.dataset.lfoCc !== String(control.cc)) {
      continue;
    }
    button.setAttribute("aria-pressed", String(isEnabled));
    button.classList.toggle("is-active", isEnabled);
  }
}

function syncLfoGhost(control, value = getControlValue(control)) {
  const wrapper = elements.controlsGrid.querySelector(`[data-cc="${control.cc}"]`);
  if (!wrapper) {
    return;
  }

  const lane = wrapper.querySelector(".slider-lane");
  if (!lane) {
    return;
  }

  updateLfoLane(lane, control, value, isLfoEnabled(control));
}

function updateLfoLane(lane, control, value, isVisible) {
  lane.style.setProperty("--lfo-position", String(normalizeLfoPosition(control, value)));
  lane.classList.toggle("has-lfo", isVisible);
}

function normalizeLfoPosition(control, value) {
  const range = control.max - control.min;
  if (range <= 0) {
    return 0;
  }
  return clampNumber((normalizeControlValue(control, value) - control.min) / range, 0, 1);
}

function syncLfoPresentation(control) {
  const lfo = state.lfos.get(String(control.cc));
  syncLfoButton(control);
  syncLfoGhost(control, lfo?.lastValue ?? lfo?.baseValue ?? getControlValue(control));
}

function syncAllLfoPresentations() {
  for (const control of getInstrumentControls()) {
    if (isSliderControl(control)) {
      syncLfoPresentation(control);
    }
  }
}

function isLfoEnabled(control) {
  return Boolean(state.lfos.get(String(control.cc))?.enabled);
}

function hasActiveLfos() {
  return activeLfoCount() > 0;
}

function activeLfoCount() {
  return Array.from(state.lfos.values()).filter((lfo) => lfo.enabled).length;
}

function isSliderControl(control) {
  return control.type === "vertical-slider" || control.type === "horizontal-slider";
}

function lfoNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function renderToggleControl(control) {
  const currentValue = getControlValue(control);
  const button = document.createElement("button");
  button.className = "toggle-button";
  button.type = "button";

  const applyToggleState = (value, shouldSend) => {
    const isOn = value === control.onValue;
    button.setAttribute("aria-pressed", String(isOn));
    button.textContent = isOn ? `On (${control.onValue})` : `Off (${control.offValue})`;
    if (shouldSend) {
      updateControlValue(control, value);
    }
  };

  applyToggleState(currentValue === control.onValue ? control.onValue : control.offValue, false);
  button.addEventListener("click", () => {
    const isOn = button.getAttribute("aria-pressed") === "true";
    applyToggleState(isOn ? control.offValue : control.onValue, true);
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
  const midiValue = normalizeControlValue(control, value);
  state.values.set(String(control.cc), midiValue);
  syncRenderedControl(control, midiValue);
  recenterActiveLfo(control, midiValue);
  sendControlChange(control.cc, midiValue);
}

function randomiseControls() {
  const controls = getInstrumentControls();
  for (const control of controls) {
    updateControlValue(control, randomControlValue(control));
  }
  if (controls.length) {
    logEvent(`Randomised ${controls.length} controls.`);
  }
}

function randomControlValue(control) {
  if (control.type === "switch" && control.positions.length) {
    const index = Math.floor(Math.random() * control.positions.length);
    return control.positions[index].value;
  }
  if (control.type === "toggle-button") {
    return Math.random() >= 0.5 ? control.onValue : control.offValue;
  }
  return control.min + Math.floor(Math.random() * (control.max - control.min + 1));
}

function getControlValue(control) {
  const storedValue = state.values.get(String(control.cc));
  if (Number.isFinite(storedValue)) {
    return normalizeControlValue(control, storedValue);
  }
  if (Number.isFinite(control.value)) {
    return normalizeControlValue(control, control.value);
  }
  if (control.type === "switch" && control.positions.length) {
    return control.positions[0].value;
  }
  if (control.type === "toggle-button") {
    return control.offValue;
  }
  return 0;
}

function applyIncomingControlChange(cc, value) {
  const control = findControlByCc(cc);
  if (!control) {
    return;
  }

  const midiValue = normalizeControlValue(control, value);
  state.values.set(String(control.cc), midiValue);
  syncRenderedControl(control, midiValue);
  recenterActiveLfo(control, midiValue);
}

function syncRenderedControl(control, value) {
  const wrapper = elements.controlsGrid.querySelector(`[data-cc="${control.cc}"]`);
  if (!wrapper) {
    return;
  }

  highlightControl(wrapper);

  if (isSliderControl(control)) {
    const range = wrapper.querySelector('input[type="range"]');
    const number = wrapper.querySelector('input[type="number"]');
    if (range) {
      range.value = String(value);
    }
    if (number) {
      number.value = String(value);
    }
    return;
  }

  if (control.type === "toggle-button") {
    const button = wrapper.querySelector(".toggle-button");
    if (!button) {
      return;
    }
    const isOn = value === control.onValue;
    button.setAttribute("aria-pressed", String(isOn));
    button.textContent = isOn ? `On (${control.onValue})` : `Off (${control.offValue})`;
    return;
  }

  for (const option of wrapper.querySelectorAll(".switch-option")) {
    option.classList.toggle("is-active", Number(option.dataset.value) === value);
  }
}

function highlightControl(wrapper) {
  const cc = wrapper.dataset.cc;
  const existingTimer = state.highlightTimers.get(cc);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  wrapper.classList.add("is-midi-updated");
  state.highlightTimers.set(
    cc,
    window.setTimeout(() => {
      wrapper.classList.remove("is-midi-updated");
      state.highlightTimers.delete(cc);
    }, 360),
  );
}

function findControlByCc(cc) {
  if (!state.instrument) {
    return null;
  }

  for (const section of state.instrument.sections) {
    const control = findSectionControlByCc(section, cc);
    if (control) {
      return control;
    }
  }
  return null;
}

function findSectionControlByCc(section, cc) {
  for (const candidate of section.controls) {
    if (isVerticalSliderGroup(candidate)) {
      const nestedControl = candidate.controls.find((control) => control.cc === cc);
      if (nestedControl) {
        return nestedControl;
      }
    } else if (candidate.cc === cc) {
      return candidate;
    }
  }
  return null;
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    setMidiStatus("Web MIDI is not available in this browser.", "error");
    return;
  }

  try {
    setMidiStatus("Requesting MIDI access...", "");
    state.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    state.midiAccess.onstatechange = refreshMidiDevices;
    refreshMidiDevices();
  } catch (error) {
    const message = error instanceof Error ? error.message : "MIDI access was denied.";
    setMidiStatus(message, "error");
  }
}

function refreshMidiDevices() {
  refreshMidiOutputs();
  refreshMidiInputs();
}

function refreshMidiOutputs() {
  const previousOutputId = state.midiOutput ? state.midiOutput.id : "";
  elements.midiOutput.innerHTML = "";

  if (!state.midiAccess) {
    renderEmptyMidiSelect(elements.midiOutput, "Connect MIDI first");
    return;
  }

  const outputs = Array.from(state.midiAccess.outputs.values());
  elements.midiOutput.disabled = outputs.length === 0;

  if (!outputs.length) {
    renderEmptyMidiSelect(elements.midiOutput, "No outputs found");
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

function refreshMidiInputs() {
  const previousInputId = state.midiInput ? state.midiInput.id : "";
  detachMidiInput();
  elements.midiInput.innerHTML = "";

  if (!state.midiAccess) {
    renderEmptyMidiSelect(elements.midiInput, "Connect MIDI first");
    return;
  }

  const inputs = Array.from(state.midiAccess.inputs.values());
  elements.midiInput.disabled = inputs.length === 0;

  if (!inputs.length) {
    renderEmptyMidiSelect(elements.midiInput, "No inputs found");
    return;
  }

  for (const input of inputs) {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.manufacturer
      ? `${input.name || input.id} - ${input.manufacturer}`
      : input.name || input.id;
    elements.midiInput.append(option);
  }

  const preferredInput = inputs.find((input) => /behringer|jt|pro vs/i.test(`${input.name || ""} ${input.manufacturer || ""}`));
  const targetInput = inputs.find((input) => input.id === previousInputId) || preferredInput || inputs[0];
  elements.midiInput.value = targetInput.id;
  attachMidiInput(targetInput);
}

function renderEmptyMidiSelect(select, label) {
  select.innerHTML = "";
  select.disabled = true;
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  select.append(option);
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

function selectMidiInput() {
  if (!state.midiAccess) {
    return;
  }

  const inputId = elements.midiInput.value;
  const input = Array.from(state.midiAccess.inputs.values()).find((candidate) => candidate.id === inputId);
  if (input) {
    attachMidiInput(input);
  } else {
    detachMidiInput();
  }
}

function attachMidiInput(input) {
  detachMidiInput();
  state.midiInput = input;
  input.onmidimessage = handleIncomingMidiMessage;
}

function detachMidiInput() {
  if (state.midiInput) {
    state.midiInput.onmidimessage = null;
    state.midiInput = null;
  }
}

function handleIncomingMidiMessage(event) {
  const bytes = Array.from(event.data || []);
  const decoded = decodeMidiMessage(bytes);

  if (decoded.kind === "Control Change") {
    applyIncomingControlChange(decoded.data1, decoded.data2);
  }

  addIncomingEvent(decoded, bytes);
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

function addIncomingEvent(decoded, bytes) {
  state.incomingEventCount += 1;
  elements.incomingEventCount.textContent =
    `${state.incomingEventCount} message${state.incomingEventCount === 1 ? "" : "s"}`;

  const row = document.createElement("div");
  row.className = "compact-midi-row";

  const type = document.createElement("strong");
  type.textContent = decoded.kind;

  const channel = document.createElement("span");
  channel.textContent = decoded.channel ? `Ch ${decoded.channel}` : "-";

  const detail = document.createElement("span");
  detail.textContent = decoded.detail;

  const raw = document.createElement("code");
  raw.textContent = bytes.length ? bytes.map((byte) => hex(byte)).join(" ") : "";

  row.append(channel, type, detail);
  if (raw.textContent) {
    row.append(raw);
  }
  elements.incomingEventLog.prepend(row);

  while (elements.incomingEventLog.children.length > MAX_INCOMING_LOG_EVENTS) {
    elements.incomingEventLog.removeChild(elements.incomingEventLog.lastElementChild);
  }
}

function clearIncomingEvents() {
  state.incomingEventCount = 0;
  elements.incomingEventCount.textContent = "0 messages";
  elements.incomingEventLog.innerHTML = "";
}

function sendControlChange(cc, value, shouldLog = true) {
  const output = state.midiOutput;
  const channel = selectedChannelIndex();
  const midiValue = coerceMidiValue(value);
  if (!output) {
    if (shouldLog) {
      logEvent(`CC ${cc} = ${midiValue} queued: no output selected.`);
    }
    return;
  }

  output.send([0xb0 + channel, cc, midiValue]);
  if (shouldLog) {
    logEvent(`Sent CC ${cc} = ${midiValue} on channel ${channel + 1}.`);
  }
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

function sendMidiStart() {
  sendSystemRealtime(MIDI_START, "MIDI Start");
}

function sendMidiStop() {
  sendSystemRealtime(MIDI_STOP, "MIDI Stop");
}

function sendSystemRealtime(status, label) {
  const output = state.midiOutput;
  if (!output) {
    logEvent(`${label} not sent: no output selected.`);
    return;
  }

  output.send([status]);
  logEvent(`Sent ${label}.`);
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
    gridColumn: stringOr(rawSection["grid-column"] ?? rawSection.gridColumn, "").trim(),
    controls: rawSection.controls.map((control) => validateControl(control, name)),
  };
}

function validateControl(rawControl, sectionName) {
  if (!isPlainObject(rawControl)) {
    throw new Error(`A control in section "${sectionName}" must be a mapping.`);
  }

  const type = normalizeControlType(rawControl.type);
  if (type === "vertical-slider-group") {
    return validateVerticalSliderGroup(rawControl, sectionName);
  }
  if (!isControlType(type)) {
    throw new Error(`Control "${rawControl.label || "unnamed"}" has unsupported type "${rawControl.type}".`);
  }

  return validateMidiControl(rawControl, sectionName, type);
}

function validateVerticalSliderGroup(rawGroup, sectionName) {
  if (!Array.isArray(rawGroup.controls) || rawGroup.controls.length === 0) {
    throw new Error(`A vertical slider group in section "${sectionName}" needs at least one control.`);
  }

  const controls = rawGroup.controls.map((rawControl) => {
    const control = validateControl({ type: "vertical-slider", ...rawControl }, sectionName);
    if (isVerticalSliderGroup(control) || control.type !== "vertical-slider") {
      throw new Error(`A vertical slider group in section "${sectionName}" only supports vertical-slider controls.`);
    }
    return control;
  });

  return {
    type: "vertical-slider-group",
    description: stringOr(rawGroup.description, ""),
    controls,
  };
}

function validateMidiControl(rawControl, sectionName, type) {
  const cc = Number(rawControl.cc);
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) {
    throw new Error(`Control "${rawControl.label || "unnamed"}" needs a CC number from 0 to 127.`);
  }

  const label = stringOr(rawControl.label || rawControl.description, "").trim();
  if (!label) {
    throw new Error(`CC ${cc} needs a label.`);
  }

  const min = Number(rawControl.min ?? 0);
  const max = Number(rawControl.max ?? 127);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 127 || min > max) {
    throw new Error(`CC ${cc} "${label}" needs min/max values between 0 and 127.`);
  }

  const control = {
    cc,
    label,
    description: stringOr(rawControl.description, ""),
    type,
    positions: [],
    onValue: coerceMidiValue(rawControl.onValue ?? 127),
    offValue: coerceMidiValue(rawControl.offValue ?? 0),
    min,
    max,
    value: normalizeRawControlValue(rawControl.value, min),
  };

  if (type === "switch") {
    if (!Array.isArray(rawControl.positions) || rawControl.positions.length === 0) {
      throw new Error(`Switch CC ${cc} "${label}" needs positions.`);
    }
    control.positions = rawControl.positions.map((position) => validatePosition(position, cc, label));
  }

  return control;
}

function isVerticalSliderGroup(control): control is VerticalSliderGroupDefinition {
  return control.type === "vertical-slider-group";
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

  const position: SwitchPosition = {
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
  if (
    normalized === "vertical-group" ||
    normalized === "vertical-slider-group" ||
    normalized === "vertical-sliders"
  ) {
    return "vertical-slider-group";
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

function isControlType(type): type is ControlType {
  return allowedControlTypes.has(type as ControlType);
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

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeRawControlValue(value, fallback) {
  if (!Number.isFinite(Number(value))) {
    return fallback;
  }
  return coerceMidiValue(value);
}

function normalizeControlValue(control, value) {
  if (control.type === "switch") {
    return nearestSwitchValue(control, value);
  }
  if (control.type === "toggle-button") {
    const midpoint = (control.onValue + control.offValue) / 2;
    return Number(value) >= midpoint ? control.onValue : control.offValue;
  }

  const midiValue = coerceMidiValue(value);
  return Math.min(control.max, Math.max(control.min, midiValue));
}

function nearestSwitchValue(control, value) {
  const midiValue = coerceMidiValue(value);
  if (!control.positions.length) {
    return midiValue;
  }

  return control.positions.reduce((nearest, position) => {
    const nearestDistance = Math.abs(nearest.value - midiValue);
    const positionDistance = Math.abs(position.value - midiValue);
    return positionDistance < nearestDistance ? position : nearest;
  }, control.positions[0]).value;
}

function hex(value) {
  return Number(value).toString(16).padStart(2, "0").toUpperCase();
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
