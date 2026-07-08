# Spark 2 Amp and Effects Reference for AI Tone Configs

Add this file to ChatGPT Project Sources together with `Soundshed-Spark2-Tone-Rules.md`.

This reference is a human-readable source document for generating `soundshed.ai-tone.v1` JSON. The app source and generated `spark-2-ai-tone-reference.json` remain the authority for exact DSP IDs and knob names.

## Target output constraints

- Target device: `spark-2`
- Signal chain: exactly seven slots
- Knob values: 0-10 only
- No Jimi Hendrix expansion effects by default
- No raw Bluetooth bytes or protocol data

## Required slot order

1. `gate`
2. `comp`
3. `drive`
4. `amp`
5. `modulation`
6. `delay`
7. `reverb`

## Safe fallback DSP IDs and knobs

Use these when a generated app reference JSON is unavailable.

### Gate slot

#### Noise Gate

- `dspId`: `bias.noisegate`
- knobs:
  - `Threshold`
  - `Decay`

### Comp slot

#### LA Comp

- `dspId`: `LA2AComp`
- knobs:
  - `Limit/Compress`
  - `Gain`
  - `Peak Reduction`

#### Sustain Comp

- `dspId`: `BlueComp`
- knobs:
  - `Level`
  - `Tone`
  - `Attack`
  - `Sustain`

#### Red Comp

- `dspId`: `Compressor`
- knobs:
  - `Output`
  - `Sensitivity`

#### Bass Comp

- `dspId`: `BassComp`
- knobs:
  - `Comp`
  - `Gain`

#### Optical Comp

- `dspId`: `BBEOpticalComp`
- knobs:
  - `Volume`
  - `Comp`
  - `Pad`

### Drive slot

#### Booster

- `dspId`: `Booster`
- knobs:
  - `Gain`

#### Tube Drive

- `dspId`: `DistortionTS9`
- knobs:
  - `Overdrive`
  - `Tone`
  - `Level`

#### Over Drive

- `dspId`: `Overdrive`
- knobs:
  - `Level`
  - `Tone`
  - `Drive`

#### Fuzz Face

- `dspId`: `Fuzz`
- knobs:
  - `Volume`
  - `Fuzz`

#### Black Op

- `dspId`: `ProCoRat`
- knobs:
  - `Distortion`
  - `Filter`
  - `Volume`

#### Bass Muff

- `dspId`: `BassBigMuff`
- knobs:
  - `Volume`
  - `Tone`
  - `Sustain`

#### Guitar Muff

- `dspId`: `GuitarMuff`
- knobs:
  - `Volume`
  - `Tone`
  - `Sustain`

#### Bassmaster

- `dspId`: `MaestroBassmaster`
- knobs:
  - `Brass Vol`
  - `Sensitivity`
  - `Bass Vol`

#### SAB Driver

- `dspId`: `SABdriver`
- knobs:
  - `Volume`
  - `Tone`
  - `Drive`
  - `HP/LP`

#### Clone Drive

- `dspId`: `KlonCentaurSilver`
- knobs:
  - `Output`
  - `Treble`
  - `Gain`

### Amp slot

#### Clean and glassy

- `RolandJC120` — Silver 120 / Roland JC120 style
- `Twin` — Black Duo / Fender Twin-style
- `ADClean` — AD Clean / Orange AD-style clean
- `94MatchDCV2` — Match DC / Matchless-style
- `Bassman` — Tweed Bass / Fender Bassman-style
- `AC Boost` — Vox AC30-style
- `Checkmate` — Teisco Checkmate-style
- `TwoStoneSP50` — Two Rock-style

Typical knobs for these amp DSP IDs:

- `Gain`
- `Treble`
- `Middle`
- `Bass`
- `Master`

#### Crunch and classic rock

- `Deluxe65` — American Deluxe / Fender Deluxe-style
- `Plexi` — Plexiglas / Marshall Super Lead-style
- `OverDrivenJM45` — JM45 / Marshall JTM45-style
- `OverDrivenLuxVerb` — Lux Verb / Fender Deluxe Reverb-style
- `BluesJrTweed` — Blues Boy / Fender Blues Junior-style

Typical knobs:

- `Gain`
- `Treble`
- `Middle`
- `Bass`
- `Master`

#### High gain and metal

- `Bogner` — RB 101 / Bogner-style
- `OrangeAD30` — British 30 / Orange AD30-style
- `AmericanHighGain` — American High Gain / Mesa-style
- `SLO100` — SLO 100 / Soldano-style
- `YJM100` — YJM100 / Marshall YJM-style
- `Rectifier` — Treadplate / Mesa Rectifier-style
- `EVH` — Insane / EVH 5150-style
- `SwitchAxeLead` — SwitchAxe / H&K-style
- `Invader` — Rocker V / Orange Rockerverb-style
- `BE101` — BE 101 / Friedman-style
- `6505Plus` — Insane 6508 / Peavey 6505-style

Typical knobs:

- `Gain`
- `Treble`
- `Middle`
- `Bass`
- `Master`

#### Acoustic and bass

Use only when the user asks for acoustic or bass-style tones.

- `Acoustic`
- `AcousticAmpV2`
- `FatAcousticV2`
- `FlatAcoustic`
- `GK800`
- `Sunny3000`
- `W600`
- `Hammer500`

Typical knobs:

- `Gain`
- `Treble`
- `Middle`
- `Bass`
- `Master`

### Modulation slot

#### Tremolo

- `dspId`: `Tremolo`
- knobs:
  - `Speed`
  - `Depth`
  - `Level`

#### Chorus

- `dspId`: `ChorusAnalog`
- knobs:
  - `E.Level`
  - `Rate`
  - `Depth`
  - `Tone`

#### Flanger

- `dspId`: `Flanger`
- knobs:
  - `Rate`
  - `Mix`
  - `Depth`

#### Phaser

- `dspId`: `Phaser`
- knobs:
  - `Speed`
  - `Intensity`

#### Vibrato

- `dspId`: `Vibrato01`
- knobs:
  - `Speed`
  - `Depth`

#### UniVibe

- `dspId`: `UniVibe`
- knobs:
  - `Speed`
  - `Chorus / Vibrato`
  - `Intensity`

#### Cloner Chorus

- `dspId`: `Cloner`
- knobs:
  - `Rate`
  - `Depth (High / Low)`

#### Classic Vibe

- `dspId`: `MiniVibe`
- knobs:
  - `Speed`
  - `Intensity`

#### Tremolator

- `dspId`: `Tremolator`
- knobs:
  - `Depth`
  - `Speed`
  - `BPM`

#### Tremolo Square

- `dspId`: `TremoloSquare`
- knobs:
  - `Speed`
  - `Depth`
  - `Level`

#### Guitar EQ

- `dspId`: `GuitarEQ6`
- knobs:
  - `Level`
  - `100`
  - `200`
  - `400`
  - `800`
  - `1.6K`
  - `3.2K`

### Delay slot

#### Digital Delay

- `dspId`: `DelayMono`
- knobs:
  - `E.Level`
  - `F.Back`
  - `D.Time`
  - `Mode`
  - `BPM`

#### Echo Filt

- `dspId`: `DelayEchoFilt`
- knobs:
  - `Delay`
  - `Feedback`
  - `Level`
  - `Tone`
  - `BPM`

#### Vintage Delay

- `dspId`: `VintageDelay`
- knobs:
  - `Repeat Rate`
  - `Intensity`
  - `Echo`
  - `BPM`

#### Reverse Delay

- `dspId`: `DelayReverse`
- knobs:
  - `Mix`
  - `Decay`
  - `Filter`
  - `Time`
  - `BPM`

#### Multi Head

- `dspId`: `DelayMultiHead`
- knobs:
  - `Repeat Rate`
  - `Intensity`
  - `Echo Vol`
  - `Mode Selector`
  - `BPM`

#### Echo Tape

- `dspId`: `DelayRe201`
- knobs:
  - `Sustain`
  - `Volume`
  - `Tone`
  - `Short -> Long`
  - `BPM`

### Reverb slot

Use one of these reverb variant DSP IDs in AI configs. The app maps the selected variant to Spark protocol reverb parameters.

- `bias.reverb.0` — Room Studio A
- `bias.reverb.1` — Room Studio B
- `bias.reverb.2` — Chamber
- `bias.reverb.3` — Hall Natural
- `bias.reverb.4` — Hall Medium
- `bias.reverb.5` — Hall Ambient
- `bias.reverb.6` — Plate Short
- `bias.reverb.7` — Plate Rich
- `bias.reverb.8` — Plate Long

Reverb knobs:

- `Level`
- `Damping`
- `Low Cut`
- `High Cut`
- `Dwell`
- `Time`

## Blocked by default

Do not use Jimi Hendrix expansion effects or amps unless the app later detects support and the user explicitly allows them. This includes any DSP ID beginning with `JH.`.

Do not use removed or experimental-dangerous effects marked as removed in the app catalog.

## Prompting hints

- For glassy clean: use `RolandJC120`, `Twin`, or another clean amp; low drive; optional light chorus/reverb.
- For blues edge: use `Deluxe65`, `Bassman`, or `BluesJrTweed`; modest drive; spring/plate-like reverb.
- For classic rock: use `Plexi` or `OverDrivenJM45`; moderate gain; optional tape delay.
- For high gain: use `SLO100`, `Rectifier`, `BE101`, `EVH`, or `6505Plus`; use gate; keep delay/reverb moderate.
- For Hendrix-like without expansion: use `Fuzz` plus `UniVibe` or `MiniVibe`, but avoid all `JH.*` IDs.
