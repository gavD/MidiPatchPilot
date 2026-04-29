# MultiMIDI

MultiMIDI is a runtime-free Web MIDI patch editor. Instrument panels are generated from YAML, MIDI CC changes are sent immediately, and the generated site is plain HTML, CSS, and JavaScript.

## Run

```sh
npm run dev
```

Open `http://127.0.0.1:4173`. The dev server builds once, watches `src/` and `presets/`, rebuilds on change, and reloads open browser windows after a successful rebuild.

For a one-shot static build and server:

```sh
npm run build
npm run serve -- --port 4173
```

Web MIDI usually requires a secure browser context; localhost is accepted by Chromium-based browsers. The app includes a preset selector for the bundled YAML presets; choose `Custom` or load YAML from disk to edit an instrument definition directly.

Saved patches are stored locally per instrument in browser `localStorage`. The Patches panel can save the current CC values, apply or delete saved patches, and export the current instrument's patches as YAML.

The static bundle is emitted to `dist/` and does not load third-party runtime scripts, styles, or packages.

For isolated incoming MIDI testing, open `http://127.0.0.1:4173/midi-monitor.html`. That page only listens to MIDI input events and never sends MIDI messages.

## Publishing a Version

The app version is managed in `package.json` and rendered into the app header during `npm run build`.

Start from a clean working tree, then create the version tag from that clean state:

```sh
git status --short
npm test
npm version patch
git push
git push --tags
```

Use `npm version minor` or `npm version major` instead of `patch` when appropriate. Avoid tagging with uncommitted changes; the tag should correspond to the exact source that produces the visible app version.

## Instrument YAML

Controls must be grouped into sections. MIDI values are always clamped to `0-127`.

```yaml
name: Example Synth
theme:
  name: High Contrast
  colors:
    background: "#101112"
    panel: "#1a1c1d"
    panelAlt: "#222627"
    text: "#f4f1e8"
    muted: "#aeb4ad"
    primary: "#17c9b2"
    accent: "#f0bc4d"
    danger: "#ff6b6b"
sections:
  - name: LFO
    grid-column: span 2
    controls:
      - cc: 46
        label: LFO Rate
        description: LFO speed.
        type: horizontal-slider
        max: 99
      - cc: 47
        label: LFO Enable
        type: toggle-button
        offValue: 0
        onValue: 127
      - cc: 48
        label: LFO Shape
        type: switch
        positions:
          - label: Triangle
            value: 0
          - label: Square
            value: 64
          - label: Random
            value: 127
      - type: vertical-slider-group
        controls:
          - cc: 49
            label: A
            description: Envelope attack time.
          - cc: 50
            label: D
            description: Envelope decay time.
          - cc: 51
            label: S
            description: Envelope sustain level.
          - cc: 52
            label: R
            description: Envelope release time.
```

Supported control types are `vertical-slider`, `vertical-slider-group`, `horizontal-slider`, `toggle-button`, and `switch`. Presets live in `presets/`; sliders can optionally define `min` and `max`. A section can optionally define `grid-column`, such as `span 2`, to control its panel width. A `vertical-slider-group` contains vertical slider controls in its nested `controls` list.

Included presets:

- `behringer-jt-mini.yaml`
- `behringer-pro-vs-mini.yaml`
- `behringer-jt-4000m-micro.yaml`
