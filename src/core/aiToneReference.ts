import { FxCatalogItem } from "../spork/src/interfaces/preset";
import { FxCatalogProvider } from "../spork/src/devices/spark/sparkFxCatalog";
import { getSparkModelProfile, SparkModelId, SparkModelProfile } from "../spork/src/devices/spark/sparkModelProfile";
import { AI_TONE_SCHEMA_VERSION, AI_TONE_SLOT_ORDER, AiToneSlotName, normalizeSparkDspId } from "./aiToneConfig";

export interface AiToneReferenceOptions {
    modelId?: SparkModelId | string;
    allowedExpansionIds?: string[];
    includeBlockedEffects?: boolean;
}

export interface AiToneReferenceKnob {
    name: string;
    index: number;
    min: 0;
    max: 10;
    default: number;
    scale: "0-10";
}

export interface AiToneReferenceEffect {
    dspId: string;
    displayName: string;
    slot: AiToneSlotName;
    enabledByDefault: boolean;
    knobs: AiToneReferenceKnob[];
    requiresExpansion?: string;
    blocked?: boolean;
    blockReason?: string;
    experimental?: boolean;
}

export interface AiToneReferenceSlot {
    slot: AiToneSlotName;
    index: number;
    purpose: string;
    effects: AiToneReferenceEffect[];
}

export interface AiToneReferenceBundle {
    schema: "soundshed.ai-tone-reference.v1";
    generatedFor: SparkModelId | string;
    configSchema: typeof AI_TONE_SCHEMA_VERSION;
    knobScale: "0-10";
    outputRules: string[];
    slotOrder: readonly AiToneSlotName[];
    slots: AiToneReferenceSlot[];
}

export interface AiToneProjectPromptBundle {
    filename: string;
    content: string;
}

function normalizeExpansionId(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function getRequiredExpansion(item: FxCatalogItem): string | null {
    const anyItem = item as any;
    if (typeof anyItem.requiresExpansion === "string") {
        return normalizeExpansionId(anyItem.requiresExpansion);
    }
    if (typeof anyItem.expansionId === "string") {
        return normalizeExpansionId(anyItem.expansionId);
    }

    const dspId = normalizeSparkDspId(item.dspId);
    if (dspId.startsWith("JH.")) {
        return "jimi-hendrix";
    }

    return null;
}

function supportsModel(item: FxCatalogItem, profile: SparkModelProfile): boolean {
    const anyItem = item as any;
    if (Array.isArray(anyItem.unsupportedModels) && anyItem.unsupportedModels.includes(profile.id)) {
        return false;
    }
    if (Array.isArray(anyItem.supportedModels) && anyItem.supportedModels.length > 0) {
        return anyItem.supportedModels.includes(profile.id);
    }
    return true;
}

function defaultKnobValue(value: any): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 5;
    }
    return Math.round(Math.max(0, Math.min(10, value * 10)) * 100) / 100;
}

function slotPurpose(slot: AiToneSlotName): string {
    switch (slot) {
        case "gate": return "Noise gate";
        case "comp": return "Compressor or input dynamics";
        case "drive": return "Boost, overdrive, distortion, or fuzz";
        case "amp": return "Amplifier model";
        case "modulation": return "Modulation, EQ, vibe, tremolo, chorus, or similar";
        case "delay": return "Delay or echo";
        case "reverb": return "Reverb model";
        default: return slot;
    }
}

function formatDspIdForAiConfig(item: FxCatalogItem): string {
    const dspId = normalizeSparkDspId(item.dspId);
    if (dspId === "bias.reverb") {
        return "bias.reverb.0";
    }
    return dspId;
}

function buildEffectReference(item: FxCatalogItem, slot: AiToneSlotName, profile: SparkModelProfile, allowedExpansionIds: Set<string>): AiToneReferenceEffect {
    const requiredExpansion = getRequiredExpansion(item);
    const blockedReasons: string[] = [];

    if (item.isRemoved === true) {
        blockedReasons.push("removed from safe catalog");
    }
    if (!supportsModel(item, profile)) {
        blockedReasons.push(`not supported on ${profile.displayName}`);
    }
    if (requiredExpansion && !allowedExpansionIds.has(requiredExpansion)) {
        blockedReasons.push(`requires ${requiredExpansion} expansion`);
    }

    const knobs = [...(item.params ?? [])]
        .filter(param => typeof param.index === "number" && typeof param.name === "string" && param.name.trim().length > 0)
        .sort((a, b) => a.index - b.index)
        .map(param => <AiToneReferenceKnob>{
            name: param.name,
            index: param.index,
            min: 0,
            max: 10,
            default: defaultKnobValue(param.value),
            scale: "0-10"
        });

    return {
        dspId: formatDspIdForAiConfig(item),
        displayName: item.name,
        slot,
        enabledByDefault: slot === "amp",
        knobs,
        requiresExpansion: requiredExpansion ?? undefined,
        blocked: blockedReasons.length > 0,
        blockReason: blockedReasons.join("; ") || undefined,
        experimental: item.isExperimental === true
    };
}

export function buildAiToneReferenceBundle(options: AiToneReferenceOptions = {}): AiToneReferenceBundle {
    const profile = getSparkModelProfile(options.modelId ?? "spark-2");
    const allowedExpansionIds = new Set((options.allowedExpansionIds ?? []).map(normalizeExpansionId));
    const catalog = FxCatalogProvider.getFxCatalog().catalog;

    const slots = AI_TONE_SLOT_ORDER.map((slotName, index) => {
        const effects = catalog
            .filter(item => item.type === slotName)
            .map(item => buildEffectReference(item, slotName, profile, allowedExpansionIds))
            .filter(effect => options.includeBlockedEffects === true || effect.blocked !== true)
            .sort((a, b) => a.displayName <= b.displayName ? -1 : 1);

        return <AiToneReferenceSlot>{
            slot: slotName,
            index,
            purpose: slotPurpose(slotName),
            effects
        };
    });

    return {
        schema: "soundshed.ai-tone-reference.v1",
        generatedFor: profile.id,
        configSchema: AI_TONE_SCHEMA_VERSION,
        knobScale: "0-10",
        outputRules: [
            "Return only JSON that conforms to soundshed.ai-tone.v1.",
            "Do not include comments, markdown fences, raw Bluetooth bytes, SysEx frames, base64 payloads, or Spark protocol chunks.",
            "Use exactly seven slots in this order: gate, comp, drive, amp, modulation, delay, reverb.",
            "Every knob value must be numeric and use the 0-10 scale.",
            "Use only dspId values from this reference file for the matching slot.",
            "Do not use expansion-only effects unless the reference explicitly includes them as unblocked."
        ],
        slotOrder: AI_TONE_SLOT_ORDER,
        slots
    };
}

export function buildAiToneProjectPrompt(options: AiToneReferenceOptions = {}): AiToneProjectPromptBundle {
    const profile = getSparkModelProfile(options.modelId ?? "spark-2");
    const referenceFilename = `${profile.id}-ai-tone-reference.json`;
    const content = [
        "You are generating safe guitar tone config files for Soundshed/Spark.",
        "",
        `Target amp: ${profile.displayName}`,
        "Target OS workflow: Bazzite Linux desktop app import.",
        "Guitar context: HSS Strat unless the user says otherwise.",
        "",
        "Critical output rules:",
        `- Output only JSON using schema \"${AI_TONE_SCHEMA_VERSION}\".`,
        "- Do not wrap the JSON in markdown fences.",
        "- Do not generate raw Bluetooth bytes, Spark protocol messages, SysEx frames, base64 payloads, or command chunks.",
        "- Use the attached/reference file for all allowed dspId values and knob names.",
        "- Use exactly seven slots in fixed order: gate, comp, drive, amp, modulation, delay, reverb.",
        "- Every AI-generated knob value must be a number from 0 to 10.",
        "- Do not use unknown effects or knobs.",
        "- Do not use expansion-only effects unless the reference file explicitly shows them as available. The default assumption is that the Jimi Hendrix expansion is not available.",
        "- Prefer safe stock Spark 2 effects.",
        "- Keep output conservative enough that the app can validate it before Bluetooth upload.",
        "",
        "Reference file to use:",
        `- ${referenceFilename}`,
        "",
        "Required JSON shape:",
        "{",
        `  \"schema\": \"${AI_TONE_SCHEMA_VERSION}\",`,
        `  \"targetDevice\": \"${profile.id}\",`,
        "  \"metadata\": { \"name\": \"...\", \"description\": \"...\", \"bpm\": 120, \"guitar\": \"HSS Strat\" },",
        "  \"requirements\": { \"expansions\": [] },",
        "  \"slots\": [",
        "    { \"slot\": \"gate\", \"dspId\": \"...\", \"enabled\": true, \"knobs\": { } },",
        "    { \"slot\": \"comp\", \"dspId\": \"...\", \"enabled\": false, \"knobs\": { } },",
        "    { \"slot\": \"drive\", \"dspId\": \"...\", \"enabled\": true, \"knobs\": { } },",
        "    { \"slot\": \"amp\", \"dspId\": \"...\", \"enabled\": true, \"knobs\": { } },",
        "    { \"slot\": \"modulation\", \"dspId\": \"...\", \"enabled\": false, \"knobs\": { } },",
        "    { \"slot\": \"delay\", \"dspId\": \"...\", \"enabled\": false, \"knobs\": { } },",
        "    { \"slot\": \"reverb\", \"dspId\": \"...\", \"enabled\": true, \"knobs\": { } }",
        "  ]",
        "}",
        "",
        "When interpreting user tone descriptions, translate adjectives into conservative amp/effect choices and knob values, but never invent DSP IDs or knob names."
    ].join("\n");

    return {
        filename: `${profile.id}-chatgpt-project-prompt.md`,
        content
    };
}

export function buildAiToneReferenceFileName(options: AiToneReferenceOptions = {}): string {
    const profile = getSparkModelProfile(options.modelId ?? "spark-2");
    return `${profile.id}-ai-tone-reference.json`;
}
