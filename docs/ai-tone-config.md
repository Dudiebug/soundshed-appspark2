# AI Tone Config Import/Export

This document defines the safe boundary between ChatGPT-generated tone suggestions and Spark amp protocol writes.

## Safety boundary

ChatGPT must only generate declarative JSON tone config data. It must not generate raw Bluetooth bytes, SysEx frames, base64 protocol payloads, ATT chunks, or Spark command messages.

The app owns every lower-level step:

1. Parse the AI tone JSON.
2. Validate the schema and fixed Spark signal-chain shape.
3. Validate every DSP ID and knob against the app catalog and connected Spark model.
4. Reject unsupported, removed, unknown, malformed, and expansion-only effects before Bluetooth writes.
5. Convert 0–10 user/AI knob values to Spark internal 0.0–1.0 values.
6. Encode the validated Spark preset and send it to the amp.

## Schema

Supported schema: `soundshed.ai-tone.v1`

```json
{
  "schema": "soundshed.ai-tone.v1",
  "targetDevice": "spark-2",
  "metadata": {
    "name": "HSS Strat Glass Drive",
    "description": "Bright edge-of-breakup tone.",
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

## Required slot order

The Spark signal chain is fixed. AI configs must contain exactly seven slots in this order:

1. `gate`
2. `comp`
3. `drive`
4. `amp`
5. `modulation`
6. `delay`
7. `reverb`

The importer rejects missing slots, duplicate slots, extra slots, and wrong-order slots.

## Knob scale

AI-generated knob values must always use a 0–10 scale. The importer converts those values to Spark internal 0.0–1.0 values after validation.

Export reverses that conversion so the file remains AI-friendly.

## Expansion handling

The importer blocks Jimi Hendrix expansion DSP IDs by default because expansion ownership is not detected yet. In particular, `JH.*` DSP IDs are rejected unless future code explicitly detects and enables that expansion.

## Linux/Bazzite workflow

For Bazzite Linux, prefer the Electron desktop build. The app uses Web Bluetooth through Electron and the OS Bluetooth stack.

Recommended manual test flow:

1. Ensure the Positive Grid mobile app is disconnected from the amp.
2. Start the Electron app on Bazzite.
3. Scan and connect to Spark 2 from the Amp tab.
4. Refresh the current preset.
5. Import an AI tone JSON file.
6. Confirm validation passes.
7. Apply the imported tone temporarily.
8. Read back the current preset.
9. Save to a Spark 2 hardware slot only after readback looks correct.
10. Export the current tone JSON and confirm knob values are on the 0–10 scale.

If GATT discovery or writes stall on Linux, disconnect the amp from other devices, restart Bluetooth from the desktop/system settings, power-cycle the amp, then reconnect from inside the app.
