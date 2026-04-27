import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const appJs = await readFile(path.join(distDir, "app.js"), "utf8");
const monitorJs = await readFile(path.join(distDir, "midi-monitor.js"), "utf8");
const distFiles = await readdir(distDir, { recursive: true });

assertNoRuntimeUrls(appJs, monitorJs, distFiles);

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
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
  "instrument-title",
  "control-summary",
  "controls-grid",
  "theme-name",
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
  document: {
    documentElement: new FakeElement("html", "document-element"),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => ids.get(id) || null,
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

vm.createContext(context);
vm.runInContext(appJs, context, { filename: "dist/app.js" });

const title = ids.get("instrument-title").textContent;
const summary = ids.get("control-summary").textContent;
const controlsGrid = ids.get("controls-grid");
const sectionPanels = controlsGrid.querySelectorAll(".section-panel");
const controls = controlsGrid.querySelectorAll(".control");
const midiControls = collectMidiControls(controlsGrid);
const verticalSliderGroups = controlsGrid.querySelectorAll(".vertical-slider-group");
const valueMeters = controlsGrid.querySelectorAll(".value-meter");

if (title !== "Behringer JT Mini") {
  throw new Error(`Expected default title to render, got "${title}".`);
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
