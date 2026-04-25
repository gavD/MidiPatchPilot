# MultiMIDI

MultiMIDI is a runtime-free Web MIDI patch editor. Instrument panels are generated from YAML, MIDI CC changes are sent immediately, and the generated site is plain HTML, CSS, and JavaScript.

## Run

```sh
npm run build
npm run serve -- --port 4173
```

Open `http://127.0.0.1:4173`. Web MIDI usually requires a secure browser context; localhost is accepted by Chromium-based browsers.

The static bundle is emitted to `dist/` and does not load third-party runtime scripts, styles, or packages.

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
    controls:
      - cc: 46
        label: LFO Rate
        description: LFO speed.
        type: horizontal-slider
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
```

Supported control types are `vertical-slider`, `horizontal-slider`, `toggle-button`, and `switch`. The starter Behringer JT Mini definition lives in `examples/behringer-jt-mini.yaml`.
