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
    if (!selector.startsWith(".")) {
      return [];
    }

    const className = selector.slice(1);
    const matches = [];
    walk(this, (element) => {
      if (element.classList.contains(className)) {
        matches.push(element);
      }
    });
    return matches;
  }
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
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    setTimeout() {
      return 1;
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
const openLfoModal = lfoButtons[0].eventListeners.get("click");
if (!openLfoModal) {
  throw new Error("Expected LFO button to open a modal.");
}
openLfoModal();
const lfoModal = context.document.body.children.find((child) => child.classList.contains("lfo-modal"));
if (!lfoModal || lfoModal.hidden) {
  throw new Error("Expected LFO modal to be visible after clicking an LFO button.");
}
const lfoModalTitle = findById(lfoModal, "lfo-modal-title");
if (lfoModalTitle.textContent !== "Modulation LFO") {
  throw new Error(`Expected Modulation LFO modal title, got "${lfoModalTitle.textContent}".`);
}
if (lfoModal.querySelectorAll(".lfo-field").length !== 3) {
  throw new Error("Expected LFO modal to render depth, rate, and waveform fields.");
}
const lfoInputs = collectElements(lfoModal, (element) => element.tagName === "INPUT");
const lfoRanges = lfoInputs.filter((element) => element.type === "range");
const lfoEnabled = lfoInputs.find((element) => element.type === "checkbox");
const lfoWaveform = collectElements(lfoModal, (element) => element.tagName === "SELECT")[0];
if (!lfoEnabled || lfoRanges.length !== 2 || !lfoWaveform) {
  throw new Error("Expected LFO modal to expose on/off, depth, rate, and waveform inputs.");
}
lfoRanges[0].value = "17";
fireEvent(lfoRanges[0], "input");
lfoRanges[1].value = "2.5";
fireEvent(lfoRanges[1], "input");
lfoWaveform.value = "sine";
fireEvent(lfoWaveform, "change");
lfoEnabled.checked = true;
fireEvent(lfoEnabled, "change");
ids.get("patch-name").value = "Moving LFO";
fireEvent(ids.get("save-patch"), "click");
const savedLfoPatchLibrary = JSON.parse(localStorageValues.get("multimidi.patches.v1"));
const savedLfoPatch = savedLfoPatchLibrary["Behringer JT Mini"].find((patch) => patch.name === "Moving LFO");
if (!savedLfoPatch?.lfos?.["1"]?.enabled) {
  throw new Error("Expected saved patch to persist enabled LFO state for CC 1.");
}
if (
  savedLfoPatch.lfos["1"].depth !== 17 ||
  savedLfoPatch.lfos["1"].rate !== 2.5 ||
  savedLfoPatch.lfos["1"].waveform !== "sine"
) {
  throw new Error("Expected saved patch to persist LFO depth, rate, and waveform.");
}
lfoEnabled.checked = false;
fireEvent(lfoEnabled, "change");
ids.get("patch-name").value = "Dry";
fireEvent(ids.get("save-patch"), "click");
lfoEnabled.checked = true;
fireEvent(lfoEnabled, "change");
const dryPatchRow = findPatchRow("Dry");
const dryPatchLoad = dryPatchRow.querySelectorAll(".ghost-action")[0];
fireEvent(dryPatchLoad, "click");
if (lfoButtons[0].getAttribute("aria-pressed") !== "false") {
  throw new Error("Expected loading a patch to clear the previously running LFO.");
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
    'title="Load a YAML file from your device that confiigured MultiMidi for your MIDI instrument"',
    'title="Ransomises the value of all controls"',
    'title="loop every 3 seconds"',
    'id="patch-list"',
    "export all patches",
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

function findPatchRow(name) {
  const rows = ids.get("patch-list").querySelectorAll(".patch-row");
  const match = rows.find((row) => row.children.some((child) => child.textContent === name));
  if (!match) {
    throw new Error(`Could not find patch row for ${name}.`);
  }
  return match;
}

function findById(root, id) {
  let match = null;
  walk(root, (element) => {
    if (element.id === id) {
      match = element;
    }
  });
  if (!match) {
    throw new Error(`Could not find dynamic element #${id}.`);
  }
  return match;
}
