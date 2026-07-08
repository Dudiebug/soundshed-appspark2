import {
    AI_TONE_SCHEMA_VERSION,
    aiToneConfigToSparkPreset,
    parseAiToneConfigJson,
    sparkPresetToAiToneConfig
} from "../src/core/aiToneConfig";

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

const validConfig = {
    schema: AI_TONE_SCHEMA_VERSION,
    targetDevice: "spark-2",
    metadata: {
        name: "Smoke Test Spark 2",
        description: "Safe stock Spark 2 validation fixture.",
        bpm: 120,
        guitar: "HSS Strat"
    },
    requirements: {
        expansions: []
    },
    slots: [
        {
            slot: "gate",
            dspId: "bias.noisegate",
            enabled: true,
            knobs: {
                Threshold: 2,
                Decay: 1
            }
        },
        {
            slot: "comp",
            dspId: "LA2AComp",
            enabled: false,
            knobs: {
                Gain: 7,
                "Peak Reduction": 5,
                "Limit/Compress": 0
            }
        },
        {
            slot: "drive",
            dspId: "DistortionTS9",
            enabled: true,
            knobs: {
                Overdrive: 3.5,
                Tone: 5.5,
                Level: 6
            }
        },
        {
            slot: "amp",
            dspId: "RolandJC120",
            enabled: true,
            knobs: {
                Gain: 4,
                Bass: 4.5,
                Middle: 5,
                Treble: 6.5,
                Master: 6
            }
        },
        {
            slot: "modulation",
            dspId: "Tremolo",
            enabled: false,
            knobs: {
                Speed: 5,
                Depth: 3,
                Level: 5
            }
        },
        {
            slot: "delay",
            dspId: "VintageDelay",
            enabled: true,
            knobs: {
                "Repeat Rate": 3,
                Intensity: 4,
                Echo: 3.5,
                BPM: 10
            }
        },
        {
            slot: "reverb",
            dspId: "bias.reverb.3",
            enabled: true,
            knobs: {
                Level: 3,
                Damping: 5,
                "Low Cut": 4,
                "High Cut": 6,
                Dwell: 4,
                Time: 5
            }
        }
    ]
};

function runValidRoundTrip() {
    const parsed = parseAiToneConfigJson(JSON.stringify(validConfig), { modelId: "spark-2" });
    assert(parsed.validation.valid, `Expected valid config, got: ${parsed.validation.issues.map(i => i.message).join("; ")}`);
    assert(parsed.config != null, "Expected parsed config to be returned.");

    const preset = aiToneConfigToSparkPreset(parsed.config!, { modelId: "spark-2" });
    assert(preset.sigpath?.length === 7, "Generated preset must have exactly 7 signal-chain slots.");
    assert(preset.sigpath?.[2]?.params?.[0]?.value === 0.35, "Drive knob must convert from 3.5 to 0.35.");
    assert(preset.sigpath?.[6]?.dspId === "bias.reverb", "Reverb protocol DSP ID should collapse to bias.reverb.");

    const exported = sparkPresetToAiToneConfig(preset, { modelId: "spark-2" });
    assert(exported.targetDevice === "spark-2", "Exported config must target Spark 2.");
    assert(exported.slots.length === 7, "Exported config must have 7 slots.");
    assert(exported.slots[2].knobs.Overdrive === 3.5, "Export must convert 0.35 back to 3.5.");
}

function runInvalidConfigChecks() {
    const unknownDsp = JSON.parse(JSON.stringify(validConfig));
    unknownDsp.slots[2].dspId = "DefinitelyNotARealSparkEffect";
    const unknownResult = parseAiToneConfigJson(JSON.stringify(unknownDsp), { modelId: "spark-2" });
    assert(!unknownResult.validation.valid, "Unknown DSP IDs must be rejected.");

    const outOfRange = JSON.parse(JSON.stringify(validConfig));
    outOfRange.slots[3].knobs.Gain = 11;
    const outOfRangeResult = parseAiToneConfigJson(JSON.stringify(outOfRange), { modelId: "spark-2" });
    assert(!outOfRangeResult.validation.valid, "0–10 knob range violations must be rejected.");

    const jimi = JSON.parse(JSON.stringify(validConfig));
    jimi.slots[3].dspId = "JH.SuperLead100";
    const jimiResult = parseAiToneConfigJson(JSON.stringify(jimi), { modelId: "spark-2" });
    assert(!jimiResult.validation.valid, "Jimi Hendrix expansion effects must be rejected by default.");
}

runValidRoundTrip();
runInvalidConfigChecks();
console.log("AI tone config smoke tests passed.");
