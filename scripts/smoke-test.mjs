import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const indexHtml = await readFile(path.join(distDir, "index.html"), "utf8");
const monitorHtml = await readFile(path.join(distDir, "midi-monitor.html"), "utf8");
const appJs = await readFile(path.join(distDir, "app.js"), "utf8");
const monitorJs = await readFile(path.join(distDir, "midi-monitor.js"), "utf8");
const distFiles = await readdir(distDir, { recursive: true });

assertIndexHtml(indexHtml);
assertVisibleVersion(indexHtml, "dist/index.html");
assertVisibleVersion(monitorHtml, "dist/midi-monitor.html");
assertNoRuntimeUrls(appJs, monitorJs, distFiles);

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.eventListeners = new Map();
    this.parentElement = null;
    this.style = {
      properties: new Map(),
      setProperty: (name, value) => this.style.properties.set(name, value),
    };
    this.textContent = "";
    this.type = "";
    this.value = "";
    this._classNames = new Set();
    this._innerHTML = "";
    this.classList = {
      add: (...names) => names.forEach((name) => this._classNames.add(name)),
      remove: (...names) => names.forEach((name) => this._classNames.delete(name)),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !this._classNames.has(name) : Boolean(force);
        if (shouldAdd) {
          this._classNames.add(name);
        } else {
          this._classNames.delete(name);
        }
      },
      contains: (name) => this._classNames.has(name),
    };
  }

  get className() {
    return Array.from(this._classNames).join(" ");
  }

  set className(value) {
    this._classNames = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  addEventListener(type, handler) {
    this.eventListeners.set(type, handler);
  }

  removeEventListener(type, handler) {
    if (this.eventListeners.get(type) === handler) {
      this.eventListeners.delete(type);
    }
  }

  append(...children) {
    for (const child of children) {
      if (child instanceof FakeElement) {
        child.parentElement = this;
      }
      this.children.push(child);
    }
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    walk(this, (element) => {
      if (matchesSelector(element, selector)) {
        matches.push(element);
      }
    });
    return matches;
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }

  const dataMatch = selector.match(/^\[data-([a-z-]+)="([^"]+)"\]$/);
  if (dataMatch) {
    const key = dataMatch[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return element.dataset[key] === dataMatch[2];
  }

  const typeMatch = selector.match(/^([a-z]+)\[type="([^"]+)"\]$/i);
  if (typeMatch) {
    return element.tagName === typeMatch[1].toUpperCase() && element.type === typeMatch[2];
  }

  return false;
}

const ids = new Map();
const requiredIds = [
  "yaml-editor",
  "yaml-file",
  "preset-select",
  "parse-status",
  "patch-heading",
  "patch-name",
  "patch-list",
  "save-patch",
  "export-patches",
  "patch-status",
  "instrument-title",
  "control-summary",
  "controls-grid",
  "randomise-controls",
  "connect-midi",
  "midi-status",
  "midi-channel",
  "midi-input",
  "midi-output",
  "play-note",
  "loop-note",
  "send-start",
  "send-stop",
  "event-log",
  "incoming-event-count",
  "incoming-event-log",
  "clear-incoming-events",
];

for (const id of requiredIds) {
  ids.set(id, new FakeElement("div", id));
}

const localStorageValues = new Map();
const scheduledTimeouts = [];
let nextTimeoutId = 1;
let performanceNow = 0;

const context = {
  console,
  Date,
  Error,
  FileReader: class {},
  Map,
  Number,
  Promise,
  Set,
  String,
  URL,
  Array,
  Boolean,
  JSON,
  Math,
  performance: {
    now() {
      return performanceNow;
    },
  },
  RegExp,
  localStorage: {
    getItem(key) {
      return localStorageValues.get(key) || null;
    },
    setItem(key, value) {
      localStorageValues.set(key, String(value));
    },
  },
  document: {
    body: new FakeElement("body", "body"),
    documentElement: new FakeElement("html", "document-element"),
    addEventListener() {},
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => ids.get(id) || null,
    removeEventListener() {},
  },
  navigator: {},
  window: {
    addEventListener() {},
    clearInterval() {},
    clearTimeout(id) {
      const index = scheduledTimeouts.findIndex((timer) => timer.id === id);
      if (index >= 0) {
        scheduledTimeouts.splice(index, 1);
      }
    },
    setInterval() {
      return 1;
    },
    setTimeout(handler) {
      const id = nextTimeoutId;
      nextTimeoutId += 1;
      scheduledTimeouts.push({ id, handler });
      return id;
    },
  },
};

vm.createContext(context);
vm.runInContext(appJs, context, { filename: "dist/app.js" });

const title = ids.get("instrument-title").textContent;
const summary = ids.get("control-summary").textContent;
const parseStatus = ids.get("parse-status").textContent;
const controlsGrid = ids.get("controls-grid");
const sectionPanels = controlsGrid.querySelectorAll(".section-panel");
const controls = controlsGrid.querySelectorAll(".control");
const midiControls = collectMidiControls(controlsGrid);
const verticalSliderGroups = controlsGrid.querySelectorAll(".vertical-slider-group");
const lfoButtons = controlsGrid.querySelectorAll(".lfo-button");
const lfoPanels = controlsGrid.querySelectorAll(".lfo-inline-controls");
const sliderLanes = controlsGrid.querySelectorAll(".slider-lane");
const valueMeters = controlsGrid.querySelectorAll(".value-meter");
const presetOptions = ids.get("preset-select").children;

if (title !== "Behringer JT Mini") {
  throw new Error(`Expected default title to render, got "${title}".`);
}
if (!ids.get("yaml-editor").hidden) {
  throw new Error("Expected preset YAML editor to be hidden for bundled presets.");
}
if (presetOptions[presetOptions.length - 1].textContent !== "Custom") {
  throw new Error("Expected custom preset option to be labelled Custom.");
}
if (ids.get("patch-heading").textContent !== "Patches for Behringer JT Mini") {
  throw new Error(`Expected instrument-scoped patch heading, got "${ids.get("patch-heading").textContent}".`);
}
if (!ids.get("export-patches").disabled) {
  throw new Error("Expected export button to be disabled when no patches are saved.");
}
if (parseStatus !== "") {
  throw new Error(`Expected successful instrument load status to be empty, got "${parseStatus}".`);
}
if (!summary.includes("15 MIDI CC controls")) {
  throw new Error(`Expected default control count, got "${summary}".`);
}
if (controls.length !== 12) {
  throw new Error(`Expected 12 rendered control panels, got ${controls.length}.`);
}
if (midiControls.length !== 15) {
  throw new Error(`Expected 15 rendered MIDI controls, got ${midiControls.length}.`);
}
if (verticalSliderGroups.length !== 1) {
  throw new Error(`Expected one vertical slider group, got ${verticalSliderGroups.length}.`);
}
if (lfoButtons.length !== 13) {
  throw new Error(`Expected one LFO button per slider, got ${lfoButtons.length}.`);
}
if (sliderLanes.length !== 13) {
  throw new Error(`Expected one LFO ghost lane per slider, got ${sliderLanes.length}.`);
}
if (lfoPanels.length !== 13) {
  throw new Error(`Expected one inline LFO panel per slider, got ${lfoPanels.length}.`);
}
if (!lfoPanels[0].hidden) {
  throw new Error("Expected inline LFO controls to be hidden while the LFO is off.");
}
if (lfoButtons[0].title !== "LFO for Modulation is off") {
  throw new Error(`Expected off-state LFO button title, got "${lfoButtons[0].title}".`);
}
fireEvent(lfoButtons[0], "click");
if (lfoButtons[0].getAttribute("aria-pressed") !== "true" || lfoButtons[0].title !== "LFO for Modulation is on") {
  throw new Error("Expected LFO button to toggle on and expose on-state title text.");
}
if (lfoPanels[0].hidden) {
  throw new Error("Expected inline LFO controls to be visible after toggling the LFO on.");
}
if (lfoPanels[0].querySelectorAll(".lfo-field").length !== 3) {
  throw new Error("Expected inline LFO controls to render depth, rate, and waveform fields.");
}
const lfoInputs = collectElements(lfoPanels[0], (element) => element.tagName === "INPUT");
const lfoRanges = lfoInputs.filter((element) => element.type === "range");
const lfoWaveformButtons = lfoPanels[0].querySelectorAll(".lfo-waveform-button");
const sineWaveform = lfoWaveformButtons.find((button) => button.dataset.lfoWaveform === "sine");
const randomWaveform = lfoWaveformButtons.find((button) => button.dataset.lfoWaveform === "random");
if (lfoRanges.length !== 2 || lfoWaveformButtons.length !== 6 || !sineWaveform || !randomWaveform) {
  throw new Error("Expected inline LFO controls to expose depth, rate, and six waveform buttons.");
}
if (randomWaveform.title !== "Random") {
  throw new Error(`Expected Random waveform button title, got "${randomWaveform.title}".`);
}
lfoRanges[0].value = "17";
fireEvent(lfoRanges[0], "input");
lfoRanges[1].value = "2.5";
fireEvent(lfoRanges[1], "input");
fireEvent(sineWaveform, "click");
if (sineWaveform.getAttribute("aria-pressed") !== "true") {
  throw new Error("Expected clicking a waveform button to mark it active.");
}
if (!sliderLanes[0].classList.contains("has-lfo")) {
  throw new Error("Expected enabling an LFO to reveal the ghost lane marker.");
}
const modulationSlider = collectElements(sliderLanes[0], (element) => element.tagName === "INPUT")[0];
performanceNow = 100;
runNextTimeout();
if (modulationSlider.value !== "0") {
  throw new Error(`Expected LFO tick to leave the fader at its base value, got ${modulationSlider.value}.`);
}
if (Number(sliderLanes[0].style.properties.get("--lfo-position")) <= 0) {
  throw new Error("Expected LFO tick to move the ghost marker behind the fader.");
}
fireEvent(randomWaveform, "click");
if (randomWaveform.getAttribute("aria-pressed") !== "true") {
  throw new Error("Expected Random waveform button to mark itself active.");
}
ids.get("patch-name").value = "Moving LFO";
fireEvent(ids.get("save-patch"), "click");
const savedLfoPatchLibrary = JSON.parse(localStorageValues.get("midi-patchpilot.patches.v1"));
const savedLfoPatch = savedLfoPatchLibrary["Behringer JT Mini"].find((patch) => patch.name === "Moving LFO");
const movingPatchRow = findPatchRow("Moving LFO");
const movingPatchSave = findPatchAction(movingPatchRow, "save");
if (!movingPatchRow.classList.contains("is-active") || !movingPatchSave) {
  throw new Error("Expected the newly saved patch to be highlighted with an overwrite save action.");
}
if (!savedLfoPatch?.lfos?.["1"]?.enabled) {
  throw new Error("Expected saved patch to persist enabled LFO state for CC 1.");
}
if (
  savedLfoPatch.lfos["1"].depth !== 17 ||
  savedLfoPatch.lfos["1"].rate !== 2.5 ||
  savedLfoPatch.lfos["1"].waveform !== "random"
) {
  throw new Error("Expected saved patch to persist LFO depth, rate, and waveform.");
}
lfoRanges[0].value = "21";
fireEvent(lfoRanges[0], "input");
fireEvent(movingPatchSave, "click");
const overwrittenPatchLibrary = JSON.parse(localStorageValues.get("midi-patchpilot.patches.v1"));
const overwrittenPatch = overwrittenPatchLibrary["Behringer JT Mini"].find((patch) => patch.name === "Moving LFO");
if (overwrittenPatch.lfos["1"].depth !== 21) {
  throw new Error("Expected active patch save action to overwrite the saved LFO depth.");
}
fireEvent(lfoButtons[0], "click");
if (!lfoPanels[0].hidden || lfoButtons[0].title !== "LFO for Modulation is off") {
  throw new Error("Expected toggling LFO off to hide inline controls and expose off-state title text.");
}
ids.get("patch-name").value = "Dry";
fireEvent(ids.get("save-patch"), "click");
fireEvent(lfoButtons[0], "click");
const dryPatchRow = findPatchRow("Dry");
const dryPatchLoad = findPatchAction(dryPatchRow, "load");
fireEvent(dryPatchLoad, "click");
if (lfoButtons[0].getAttribute("aria-pressed") !== "false") {
  throw new Error("Expected loading a patch to clear the previously running LFO.");
}
if (sliderLanes[0].classList.contains("has-lfo")) {
  throw new Error("Expected loading a dry patch to hide the LFO ghost marker.");
}
if (!lfoPanels[0].hidden) {
  throw new Error("Expected loading a dry patch to hide inline LFO controls.");
}
if (!verticalSliderGroups[0].firstElementChild?.classList.contains("vertical-slider-group-controls")) {
  throw new Error("Expected vertical slider group to render without its own label header.");
}
if (!sectionPanels.some((sectionPanel) => sectionPanel.style.gridColumn === "span 2")) {
  throw new Error("Expected a rendered section to use grid-column: span 2.");
}
if (valueMeters.length !== 0) {
  throw new Error(`Expected no value meter elements, got ${valueMeters.length}.`);
}

runMonitorSmokeTest(monitorJs);

console.log("Smoke test passed");

function assertIndexHtml(source) {
  const requiredSnippets = [
    'title="Load a YAML file from your device that configures Midi PatchPilot for your MIDI instrument"',
    'title="Ransomises the value of all controls"',
    'title="loop every 3 seconds"',
    'id="patch-list"',
    "Save as new patch",
    "export all patches",
    "https://gavindavieslimited.com/",
    "Brought to you by",
    "Licensed under the GNU GPL.",
  ];

  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      throw new Error(`dist/index.html is missing ${snippet}.`);
    }
  }
}

function assertVisibleVersion(source, filename) {
  const expectedVersion = `v${packageJson.version}`;
  if (!source.includes(expectedVersion)) {
    throw new Error(`${filename} is missing visible app version ${expectedVersion}.`);
  }
  if (source.includes("__APP_VERSION__")) {
    throw new Error(`${filename} still contains the app version placeholder.`);
  }
}

function assertNoRuntimeUrls(appSource, monitorSource, files) {
  const forbiddenPattern = /https?:\/\/|cdn|unpkg|fonts\.googleapis|@import|import\s/;
  if (forbiddenPattern.test(appSource)) {
    throw new Error("dist/app.js contains a forbidden runtime import or URL.");
  }
  if (forbiddenPattern.test(monitorSource)) {
    throw new Error("dist/midi-monitor.js contains a forbidden runtime import or URL.");
  }

  const requiredFiles = [
    "index.html",
    "midi-monitor.html",
    "styles.css",
    "app.js",
    "midi-monitor.js",
    "presets/behringer-jt-mini.yaml",
    "presets/behringer-pro-vs-mini.yaml",
    "presets/behringer-jt-4000m-micro.yaml",
  ];
  for (const file of requiredFiles) {
    if (!files.includes(file)) {
      throw new Error(`dist/ is missing ${file}.`);
    }
  }
}

function runMonitorSmokeTest(source) {
  const monitorIds = new Map();
  const requiredMonitorIds = [
    "monitor-status",
    "midi-input",
    "include-sysex",
    "connect-midi-input",
    "event-count",
    "incoming-events",
    "clear-events",
    "cc-values",
    "last-type",
    "last-channel",
    "last-data",
    "last-raw",
  ];

  for (const id of requiredMonitorIds) {
    monitorIds.set(id, new FakeElement("div", id));
  }

  const monitorContext = {
    console,
    Date,
    Error,
    Map,
    Number,
    Promise,
    Set,
    String,
    URL,
    Array,
    Boolean,
    JSON,
    Math,
    RegExp,
    document: {
      documentElement: new FakeElement("html", "document-element"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => monitorIds.get(id) || null,
    },
    navigator: {},
    window: {
      addEventListener() {},
      clearInterval,
      clearTimeout,
      setInterval,
      setTimeout,
    },
  };

  vm.createContext(monitorContext);
  vm.runInContext(source, monitorContext, { filename: "dist/midi-monitor.js" });

  if (!monitorIds.get("cc-values").children.length) {
    throw new Error("Expected MIDI monitor empty CC state to render.");
  }
}

function walk(element, callback) {
  for (const child of element.children) {
    if (!(child instanceof FakeElement)) {
      continue;
    }
    callback(child);
    walk(child, callback);
  }
}

function collectMidiControls(root) {
  const matches = [];
  walk(root, (element) => {
    if (element.dataset.cc !== undefined) {
      matches.push(element);
    }
  });
  return matches;
}

function collectElements(root, predicate) {
  const matches = [];
  walk(root, (element) => {
    if (predicate(element)) {
      matches.push(element);
    }
  });
  return matches;
}

function fireEvent(element, type) {
  const handler = element.eventListeners.get(type);
  if (!handler) {
    throw new Error(`Expected ${element.tagName}#${element.id || ""} to have a ${type} handler.`);
  }
  handler({ target: element });
}

function runNextTimeout() {
  const timer = scheduledTimeouts.shift();
  if (!timer) {
    throw new Error("Expected a scheduled timeout to run.");
  }
  timer.handler();
}

function findPatchRow(name) {
  const rows = ids.get("patch-list").querySelectorAll(".patch-row");
  const match = rows.find((row) => row.children.some((child) => child.textContent === name));
  if (!match) {
    throw new Error(`Could not find patch row for ${name}.`);
  }
  return match;
}

function findPatchAction(row, label) {
  const action = row.querySelectorAll(".ghost-action").find((button) => button.textContent === label);
  if (!action) {
    throw new Error(`Could not find ${label} patch action.`);
  }
  return action;
}
