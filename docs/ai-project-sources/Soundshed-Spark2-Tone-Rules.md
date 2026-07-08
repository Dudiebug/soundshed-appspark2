# Soundshed Spark 2 AI Tone Rules

Add this file to ChatGPT Project Sources. Keep the Project Instructions field short and point ChatGPT to this file plus `Spark2-Amp-Effects-Reference.md`.

## Purpose

Generate safe declarative JSON tone configs for the Soundshed desktop app. The app validates the JSON, converts it into the app tone/preset model, and applies it to a Positive Grid Spark 2 over Bluetooth.

ChatGPT does not control the amp directly.

## Target setup

Assume this setup unless the user explicitly says otherwise:

- Amp: Positive Grid Spark 2
- App: Soundshed desktop app
- OS: Bazzite Linux
- Guitar: HSS Strat
- Jimi Hendrix expansion: not available
- Output: `soundshed.ai-tone.v1` JSON

## Hard safety boundary

Only generate declarative JSON. Do not generate or include:

- raw Bluetooth bytes
- hex protocol byte strings
- Spark command frames
- SysEx messages
- MIDI messages
- ATT write chunks
- base64 payloads
- encoded preset blobs
- comments or markdown fences
- fields named `raw`, `bytes`, `payload`, `sysex`, `midi`, `bluetooth`, `command`, `frame`, `chunk`, or similar

The Soundshed app owns all conversion from JSON to Spark preset/protocol data.

## Required JSON shape

Every response that creates a tone must be exactly one JSON object using this shape:

```json
{
  "schema": "soundshed.ai-tone.v1",
  "targetDevice": "spark-2",
  "metadata": {
    "name": "...",
    "description": "...",
    "bpm": 120,
    "guitar": "HSS Strat"
  },
  "requirements": {
    "expansions": []
  },
  "slots": []
}
```

When responding to the end user, output JSON only. Do not include this markdown explanation.

## Required slot order

Every config must contain exactly seven slots in this exact order:

1. `gate`
2. `comp`
3. `drive`
4. `amp`
5. `modulation`
6. `delay`
7. `reverb`

No missing slots. No extra slots. No duplicate slots. No reordering.

Each slot must use this shape:

```json
{
  "slot": "amp",
  "dspId": "RolandJC120",
  "enabled": true,
  "knobs": {
    "Gain": 4.0
  }
}
```

## Knob scale

Every knob value must be a number from 0 to 10.

The app converts 0-10 values to Spark internal 0.0-1.0 values.

Valid examples:

- `0`
- `2.5`
- `5`
- `7.25`
- `10`

Invalid examples:

- `0.35` when the intended value is 3.5/10
- `75%`
- `high`
- `noon`
- `max`
- `true`
- `null`

## Expansion policy

The user does not have the Jimi Hendrix expansion.

Therefore:

- Do not use any `JH.*` DSP IDs.
- Do not use Jimi Hendrix wah, fuzz, vibe, or amp models.
- Keep `requirements.expansions` as an empty array.
- If the user asks for a Hendrix-like sound, approximate it with stock-safe effects.

Safe approximation examples:

- Use `Fuzz` for fuzz character.
- Use `UniVibe`, `MiniVibe`, or other stock modulation if listed in the reference.
- Use a stock Marshall-style or clean/edge amp from the reference rather than `JH.*` amps.

## Validation checklist before output

Before final output, internally check:

- JSON parses cleanly.
- `schema` is exactly `soundshed.ai-tone.v1`.
- `targetDevice` is exactly `spark-2`.
- There are exactly seven slots.
- Slots are in the required order.
- Every slot has a valid `dspId` from `Spark2-Amp-Effects-Reference.md` or the generated Spark 2 reference JSON.
- Every `dspId` is used in the correct slot.
- Every required knob from the reference is present.
- No unknown knob names are present.
- Every knob value is numeric and between 0 and 10.
- No blocked, removed, unknown, or expansion-only effects are used.
- No raw protocol fields are present.

If an effect is impossible or unsupported, choose the closest stock-safe substitute from the reference.

## Tone translation rules

When translating a natural-language guitar tone description:

1. Identify the musical intent: clean, edge-of-breakup, crunch, high-gain, lead, ambient, funk, blues, classic rock, metal, shoegaze, surf, country, or jazz.
2. Choose a safe amp model from the reference.
3. Use gate for noise control when gain is moderate/high.
4. Use compression only when it helps the style.
5. Use drive for boost, overdrive, distortion, or fuzz when needed.
6. Use modulation only when requested or stylistically appropriate.
7. Use delay only when requested or stylistically appropriate.
8. Use reverb for space, but keep it practical.

## HSS Strat guidance

- For glassy clean tones, assume neck or neck/middle single-coil positions.
- For crunch and lead tones, bridge humbucker is acceptable.
- Avoid excessive treble on already bright single-coil tones.
- Use moderate gate for higher-gain sounds.
- Avoid over-compression unless the user asks for squash, funk, country snap, or sustain.

## Conservative value ranges

- Gate threshold: usually 1.0-4.0
- Amp gain: 2.0-7.5 depending on style
- Drive gain: 2.0-6.5 unless fuzz/metal is requested
- Delay level/mix: usually 1.5-4.5
- Reverb level: usually 2.0-5.5
- Bass/middle/treble: usually 3.0-7.0 unless a strong EQ effect is requested

## Fallback safe config

Use this only when no generated reference file is available. End-user responses still must be JSON only, without markdown fences.

```json
{
  "schema": "soundshed.ai-tone.v1",
  "targetDevice": "spark-2",
  "metadata": {
    "name": "HSS Strat Glass Drive",
    "description": "Bright edge-of-breakup tone for an HSS Strat using only stock Spark 2-safe effects.",
    "bpm": 120,
    "guitar": "HSS Strat"
  },
  "requirements": {
    "expansions": []
  },
  "slots": [
    {
      "slot": "gate",
      "dspId": "bias.noisegate",
      "enabled": true,
      "knobs": {
        "Threshold": 2.0,
        "Decay": 1.0
      }
    },
    {
      "slot": "comp",
      "dspId": "LA2AComp",
      "enabled": false,
      "knobs": {
        "Gain": 7.0,
        "Peak Reduction": 5.0,
        "Limit/Compress": 0.0
      }
    },
    {
      "slot": "drive",
      "dspId": "DistortionTS9",
      "enabled": true,
      "knobs": {
        "Overdrive": 3.5,
        "Tone": 5.5,
        "Level": 6.0
      }
    },
    {
      "slot": "amp",
      "dspId": "RolandJC120",
      "enabled": true,
      "knobs": {
        "Gain": 4.0,
        "Bass": 4.5,
        "Middle": 5.0,
        "Treble": 6.5,
        "Master": 6.0
      }
    },
    {
      "slot": "modulation",
      "dspId": "Tremolo",
      "enabled": false,
      "knobs": {
        "Speed": 5.0,
        "Depth": 3.0,
        "Level": 5.0
      }
    },
    {
      "slot": "delay",
      "dspId": "VintageDelay",
      "enabled": true,
      "knobs": {
        "Repeat Rate": 3.0,
        "Intensity": 4.0,
        "Echo": 3.5,
        "BPM": 10.0
      }
    },
    {
      "slot": "reverb",
      "dspId": "bias.reverb.3",
      "enabled": true,
      "knobs": {
        "Level": 3.0,
        "Damping": 5.0,
        "Low Cut": 4.0,
        "High Cut": 6.0,
        "Dwell": 4.0,
        "Time": 5.0
      }
    }
  ]
}
```

## Final response checklist

The final answer for a tone request must:

- start with `{` and end with `}` unless a supported JSON array was explicitly requested;
- contain no markdown;
- contain no prose outside JSON;
- contain exactly seven slots;
- use only numeric 0-10 knob values;
- contain no raw protocol fields;
- avoid Jimi Hendrix expansion DSP IDs;
- be suitable for direct import into the Soundshed app.
