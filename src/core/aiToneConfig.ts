import { FxCatalogItem, FxParam, Preset, SignalPath } from "../spork/src/interfaces/preset";
import { FxCatalogProvider } from "../spork/src/devices/spark/sparkFxCatalog";
import { getSparkModelProfile, SparkModelId, SparkModelProfile } from "../spork/src/devices/spark/sparkModelProfile";

export const AI_TONE_SCHEMA_VERSION = "soundshed.ai-tone.v1";

export const AI_TONE_SLOT_ORDER = [
    "gate",
    "comp",
    "drive",
    "amp",
    "modulation",
    "delay",
    "reverb"
] as const;

export type AiToneSlotName = typeof AI_TONE_SLOT_ORDER[number];
export type ValidationSeverity = "error" | "warning";

export interface ToneValidationIssue {
    severity: ValidationSeverity;
    code: string;
    path: string;
    message: string;
    suggestion?: string;
}

export interface ToneValidationResult {
    valid: boolean;
    issues: ToneValidationIssue[];
}

export interface AiToneConfigMetadata {
    name: string;
    description?: string;
    bpm?: number;
    guitar?: string;
}

export interface AiToneConfigRequirements {
    expansions?: string[];
}

export interface AiToneConfigSlot {
    slot: AiToneSlotName;
    dspId: string;
    enabled: boolean;
    knobs: Record<string, number>;
}

export interface AiToneConfig {
    schema: typeof AI_TONE_SCHEMA_VERSION;
    targetDevice: SparkModelId | string;
    metadata: AiToneConfigMetadata;
    requirements?: AiToneConfigRequirements;
    slots: AiToneConfigSlot[];
}

export interface AiToneConfigOptions {
    modelId?: SparkModelId | string;
    allowedExpansionIds?: string[];
    strict?: boolean;
}

export class AiToneConfigError extends Error {
    public issues: ToneValidationIssue[];

    constructor(message: string, issues: ToneValidationIssue[]) {
        super(message);
        this.name = "AiToneConfigError";
        this.issues = issues;
    }
}

function issue(severity: ValidationSeverity, code: string, path: string, message: string, suggestion?: string): ToneValidationIssue {
    return { severity, code, path, message, suggestion };
}

function isPlainObject(value: any): boolean {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: any): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function normalizeExpansionId(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function normalizeSparkDspId(dspId?: string | null): string {
    let normalized = (dspId ?? "").trim();
    normalized = normalized.replace(/^pg\.spark40\./i, "");
    normalized = normalized.replace(/^pg\.spark2\./i, "");
    return normalized;
}

function toCatalogComparableDspId(dspId?: string | null): string {
    return normalizeSparkDspId(dspId).toLowerCase();
}

function getConfiguredAllowedExpansions(options?: AiToneConfigOptions): string[] {
    return (options?.allowedExpansionIds ?? []).map(normalizeExpansionId);
}

function getBlockedExpansionIds(profile: SparkModelProfile, options?: AiToneConfigOptions): string[] {
    const allowed = new Set(getConfiguredAllowedExpansions(options));
    return profile.defaultBlockedExpansionIds.filter(id => !allowed.has(normalizeExpansionId(id)));
}

function getExpansionRequirement(item: FxCatalogItem): string | null {
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

function getCatalogItems(): FxCatalogItem[] {
    return FxCatalogProvider.getFxCatalog().catalog;
}

function getSlotIndex(slotName: string): number {
    return (AI_TONE_SLOT_ORDER as readonly string[]).indexOf(slotName);
}

function deriveReverbVariantFromParams(params?: FxParam[]): number {
    const modeParam = params?.find(p => p.index === 6);
    if (!modeParam || !isFiniteNumber(modeParam.value)) {
        return 0;
    }
    return Math.max(0, Math.min(8, Math.round(modeParam.value * 10)));
}

function deriveReverbVariantFromDspId(dspId: string): number {
    const normalized = normalizeSparkDspId(dspId);
    const match = normalized.match(/^bias\.reverb\.(\d+)$/i);
    if (!match) {
        return 0;
    }
    return Math.max(0, Math.min(8, Number.parseInt(match[1], 10)));
}

export function findSparkCatalogItem(dspId: string, slotName?: AiToneSlotName | string, params?: FxParam[]): FxCatalogItem | null {
    let comparable = toCatalogComparableDspId(dspId);

    if (comparable === "bias.reverb") {
        comparable = `bias.reverb.${deriveReverbVariantFromParams(params)}`.toLowerCase();
    }

    let matches = getCatalogItems().filter(item => toCatalogComparableDspId(item.dspId) === comparable);
    if (slotName) {
        matches = matches.filter(item => item.type === slotName);
    }

    if (matches.length > 0) {
        return matches[0];
    }

    return null;
}

function getKnobValue(knobs: Record<string, number>, name: string): number | null {
    if (Object.prototype.hasOwnProperty.call(knobs, name)) {
        return knobs[name];
    }

    const foundKey = Object.keys(knobs).find(k => k.toLowerCase() === name.toLowerCase());
    return foundKey ? knobs[foundKey] : null;
}

function getCatalogParamNames(item: FxCatalogItem): string[] {
    return (item.params ?? []).map(p => p.name).filter(name => typeof name === "string" && name.trim().length > 0);
}

function buildSparkParams(item: FxCatalogItem, knobs: Record<string, number>): FxParam[] {
    const params = [...(item.params ?? [])]
        .filter(p => typeof p.index === "number")
        .sort((a, b) => a.index - b.index)
        .map(p => {
            const aiValue = getKnobValue(knobs, p.name);
            const fallback = isFiniteNumber(p.value) ? p.value : 0.5;
            const normalized = aiValue == null ? fallback : aiValue / 10;
            return <FxParam>{
                index: p.index,
                name: p.name,
                value: Math.max(0, Math.min(1, normalized))
            };
        });

    return params;
}

function getProtocolDspId(item: FxCatalogItem): string {
    return normalizeSparkDspId(item.dspId);
}

function assertNoUnknownTopLevelKeys(config: any, issues: ToneValidationIssue[]) {
    const allowed = new Set(["schema", "targetDevice", "metadata", "requirements", "slots"]);
    for (const key of Object.keys(config)) {
        if (!allowed.has(key)) {
            issues.push(issue("error", "unknown_top_level_field", key, `Unknown top-level field '${key}'.`, "Remove fields that are not part of soundshed.ai-tone.v1."));
        }
    }
}

function validateCatalogItemForModel(item: FxCatalogItem, profile: SparkModelProfile, path: string, issues: ToneValidationIssue[], options?: AiToneConfigOptions) {
    if (item.isRemoved === true) {
        issues.push(issue("error", "removed_effect", path, `${item.name} (${normalizeSparkDspId(item.dspId)}) is marked as removed and must not be sent to the amp.`, "Choose a non-removed Spark 2 effect."));
    }

    if (!supportsModel(item, profile)) {
        issues.push(issue("error", "unsupported_model_effect", path, `${item.name} is not supported on ${profile.displayName}.`, "Choose an effect supported by the connected Spark model."));
    }

    const requiredExpansion = getExpansionRequirement(item);
    if (requiredExpansion != null) {
        const allowed = getConfiguredAllowedExpansions(options);
        const blockedByProfile = getBlockedExpansionIds(profile, options);
        if (!allowed.includes(requiredExpansion) || blockedByProfile.includes(requiredExpansion)) {
            issues.push(issue("error", "unsupported_expansion_effect", path, `${item.name} requires the ${requiredExpansion} expansion, which is not enabled for this device.`, "Use a stock effect or enable detected expansion support in the app after hardware validation."));
        }
    }
}

export function validateAiToneConfig(input: any, options: AiToneConfigOptions = {}): ToneValidationResult {
    const issues: ToneValidationIssue[] = [];

    if (!isPlainObject(input)) {
        return { valid: false, issues: [issue("error", "malformed_config", "", "AI tone config must be a JSON object.")] };
    }

    assertNoUnknownTopLevelKeys(input, issues);

    if (input.schema !== AI_TONE_SCHEMA_VERSION) {
        issues.push(issue("error", "unsupported_schema", "schema", `Unsupported schema '${String(input.schema)}'.`, `Use schema '${AI_TONE_SCHEMA_VERSION}'.`));
    }

    const targetDevice = typeof input.targetDevice === "string" ? input.targetDevice : options.modelId;
    const profile = getSparkModelProfile(options.modelId ?? targetDevice ?? "spark-2");

    if (profile.id !== "spark-2" && input.targetDevice === "spark-2") {
        issues.push(issue("warning", "target_device_mismatch", "targetDevice", `Config targets Spark 2 but the active profile is ${profile.displayName}.`));
    }

    if (!isPlainObject(input.metadata)) {
        issues.push(issue("error", "missing_metadata", "metadata", "metadata object is required."));
    } else {
        if (typeof input.metadata.name !== "string" || input.metadata.name.trim().length === 0) {
            issues.push(issue("error", "missing_tone_name", "metadata.name", "metadata.name is required."));
        }
        if (input.metadata.bpm != null && (!isFiniteNumber(input.metadata.bpm) || input.metadata.bpm <= 0 || input.metadata.bpm > 400)) {
            issues.push(issue("error", "invalid_bpm", "metadata.bpm", "metadata.bpm must be a positive number no greater than 400."));
        }
    }

    if (input.requirements != null && !isPlainObject(input.requirements)) {
        issues.push(issue("error", "malformed_requirements", "requirements", "requirements must be an object when provided."));
    }

    if (!Array.isArray(input.slots)) {
        issues.push(issue("error", "missing_slots", "slots", "slots must be an array with exactly 7 entries."));
        return { valid: false, issues };
    }

    if (input.slots.length !== AI_TONE_SLOT_ORDER.length) {
        issues.push(issue("error", "invalid_slot_count", "slots", `AI tone config must contain exactly ${AI_TONE_SLOT_ORDER.length} slots.`, "Include gate, comp, drive, amp, modulation, delay, and reverb."));
    }

    const seenSlots = new Set<string>();
    for (let idx = 0; idx < input.slots.length; idx++) {
        const slotPath = `slots[${idx}]`;
        const slot = input.slots[idx];

        if (!isPlainObject(slot)) {
            issues.push(issue("error", "malformed_slot", slotPath, "Each slot must be an object."));
            continue;
        }

        const expectedSlot = AI_TONE_SLOT_ORDER[idx];
        if (slot.slot !== expectedSlot) {
            issues.push(issue("error", "invalid_slot_order", `${slotPath}.slot`, `Slot ${idx} must be '${expectedSlot}', got '${String(slot.slot)}'.`, "Use the fixed Spark signal-chain order."));
        }

        if (typeof slot.slot === "string") {
            if (seenSlots.has(slot.slot)) {
                issues.push(issue("error", "duplicate_slot", `${slotPath}.slot`, `Duplicate slot '${slot.slot}'.`));
            }
            seenSlots.add(slot.slot);
        }

        if (typeof slot.dspId !== "string" || slot.dspId.trim().length === 0) {
            issues.push(issue("error", "missing_dsp_id", `${slotPath}.dspId`, "Each slot must define a dspId."));
            continue;
        }

        if (typeof slot.enabled !== "boolean") {
            issues.push(issue("error", "invalid_enabled", `${slotPath}.enabled`, "enabled must be true or false."));
        }

        if (!isPlainObject(slot.knobs)) {
            issues.push(issue("error", "missing_knobs", `${slotPath}.knobs`, "knobs must be an object keyed by knob name."));
            continue;
        }

        const catalogItem = findSparkCatalogItem(slot.dspId, expectedSlot);
        if (!catalogItem) {
            issues.push(issue("error", "unknown_effect", `${slotPath}.dspId`, `Unknown or wrong-slot effect '${slot.dspId}'.`, `Choose a supported ${expectedSlot} effect from the Spark catalog.`));
            continue;
        }

        validateCatalogItemForModel(catalogItem, profile, `${slotPath}.dspId`, issues, options);

        const expectedKnobs = new Set(getCatalogParamNames(catalogItem).map(name => name.toLowerCase()));
        for (const knobName of Object.keys(slot.knobs)) {
            const value = slot.knobs[knobName];
            if (!expectedKnobs.has(knobName.toLowerCase())) {
                issues.push(issue("error", "unknown_knob", `${slotPath}.knobs.${knobName}`, `Unknown knob '${knobName}' for ${catalogItem.name}.`, "Use only knob names from the Spark FX catalog."));
                continue;
            }
            if (!isFiniteNumber(value) || value < 0 || value > 10) {
                issues.push(issue("error", "invalid_knob_value", `${slotPath}.knobs.${knobName}`, `Knob '${knobName}' must be a number from 0 to 10.`, "AI-generated knob values must use the 0–10 scale."));
            }
        }

        for (const requiredName of getCatalogParamNames(catalogItem)) {
            if (getKnobValue(slot.knobs, requiredName) == null) {
                issues.push(issue("error", "missing_knob", `${slotPath}.knobs.${requiredName}`, `Missing required knob '${requiredName}' for ${catalogItem.name}.`));
            }
        }
    }

    for (const requiredSlot of AI_TONE_SLOT_ORDER) {
        if (!seenSlots.has(requiredSlot)) {
            issues.push(issue("error", "missing_required_slot", "slots", `Missing required slot '${requiredSlot}'.`));
        }
    }

    return { valid: !hasBlockingValidationErrors({ valid: false, issues }), issues };
}

export function validateSparkPreset(preset: Preset, options: AiToneConfigOptions = {}): ToneValidationResult {
    const issues: ToneValidationIssue[] = [];
    const profile = getSparkModelProfile(options.modelId ?? "spark-2");

    if (!preset || !Array.isArray(preset.sigpath)) {
        return { valid: false, issues: [issue("error", "malformed_preset", "sigpath", "Preset must include a signal path array.")] };
    }

    if (preset.sigpath.length !== AI_TONE_SLOT_ORDER.length) {
        issues.push(issue("error", "invalid_signal_path_count", "sigpath", `Spark presets must contain exactly ${AI_TONE_SLOT_ORDER.length} signal-chain slots.`));
    }

    if (preset.bpm != null && (!isFiniteNumber(preset.bpm) || preset.bpm <= 0 || preset.bpm > 400)) {
        issues.push(issue("error", "invalid_bpm", "bpm", "Preset BPM must be a positive number no greater than 400."));
    }

    for (let idx = 0; idx < preset.sigpath.length; idx++) {
        const fx = preset.sigpath[idx];
        const expectedSlot = AI_TONE_SLOT_ORDER[idx];
        const path = `sigpath[${idx}]`;

        if (!fx || typeof fx.dspId !== "string" || fx.dspId.trim().length === 0) {
            issues.push(issue("error", "missing_dsp_id", `${path}.dspId`, "Signal-chain item must define a dspId."));
            continue;
        }

        const catalogItem = findSparkCatalogItem(fx.dspId, expectedSlot, fx.params);
        if (!catalogItem) {
            issues.push(issue("error", "unknown_effect", `${path}.dspId`, `Unknown or wrong-slot effect '${fx.dspId}'.`));
            continue;
        }

        validateCatalogItemForModel(catalogItem, profile, `${path}.dspId`, issues, options);

        if (!Array.isArray(fx.params)) {
            issues.push(issue("error", "missing_params", `${path}.params`, `${catalogItem.name} must include a params array.`));
            continue;
        }

        const expectedIndexes = new Set((catalogItem.params ?? []).map(p => p.index));
        if (normalizeSparkDspId(fx.dspId) === "bias.reverb") {
            expectedIndexes.add(6);
            expectedIndexes.add(7);
        }

        const seenIndexes = new Set<number>();
        for (let pIdx = 0; pIdx < fx.params.length; pIdx++) {
            const param = fx.params[pIdx];
            const paramPath = `${path}.params[${pIdx}]`;

            if (!isFiniteNumber(param.index)) {
                issues.push(issue("error", "invalid_param_index", `${paramPath}.index`, "Parameter index must be numeric."));
                continue;
            }
            if (seenIndexes.has(param.index)) {
                issues.push(issue("error", "duplicate_param_index", `${paramPath}.index`, `Duplicate parameter index ${param.index}.`));
            }
            seenIndexes.add(param.index);

            if (!expectedIndexes.has(param.index)) {
                issues.push(issue("error", "unknown_param_index", `${paramPath}.index`, `Parameter index ${param.index} is not valid for ${catalogItem.name}.`));
            }

            if (!isFiniteNumber(param.value) || param.value < 0 || param.value > 1) {
                issues.push(issue("error", "invalid_param_value", `${paramPath}.value`, `Internal parameter value for index ${param.index} must be between 0.0 and 1.0.`));
            }
        }

        for (const expectedIndex of expectedIndexes) {
            if (!seenIndexes.has(expectedIndex)) {
                issues.push(issue("error", "missing_param", `${path}.params`, `${catalogItem.name} is missing parameter index ${expectedIndex}.`));
            }
        }
    }

    return { valid: !hasBlockingValidationErrors({ valid: false, issues }), issues };
}

export function hasBlockingValidationErrors(result: ToneValidationResult): boolean {
    return result.issues.some(item => item.severity === "error");
}

export function parseAiToneConfigJson(jsonText: string, options: AiToneConfigOptions = {}): { config?: AiToneConfig; validation: ToneValidationResult } {
    let parsed: any;
    try {
        parsed = JSON.parse(jsonText);
    } catch (err) {
        return {
            validation: {
                valid: false,
                issues: [issue("error", "invalid_json", "", `Invalid JSON: ${(err as Error).message}`)]
            }
        };
    }

    const validation = validateAiToneConfig(parsed, options);
    return { config: validation.valid ? parsed as AiToneConfig : undefined, validation };
}

export function aiToneConfigToSparkPreset(config: AiToneConfig, options: AiToneConfigOptions = {}): Preset {
    const validation = validateAiToneConfig(config, options);
    if (hasBlockingValidationErrors(validation)) {
        throw new AiToneConfigError("AI tone config failed validation.", validation.issues);
    }

    const signalPath: SignalPath[] = AI_TONE_SLOT_ORDER.map(slotName => {
        const slot = config.slots.find(s => s.slot === slotName);
        const catalogItem = findSparkCatalogItem(slot.dspId, slotName);
        let dspId = getProtocolDspId(catalogItem);
        let params = buildSparkParams(catalogItem, slot.knobs);

        if (slotName === "reverb") {
            const variant = deriveReverbVariantFromDspId(slot.dspId);
            dspId = "bias.reverb";
            params = params.filter(p => p.index >= 0 && p.index <= 5);
            params.push({ index: 6, name: "Reverb Type", value: variant / 10 });
            params.push({ index: 7, name: "OnOff", value: slot.enabled ? 1 : 0 });
        }

        return {
            active: slot.enabled === true,
            params,
            dspId,
            type: "speaker_fx",
            name: catalogItem.name,
            description: catalogItem.description
        };
    });

    const preset: Preset = {
        meta: {
            id: createPortableToneId(),
            name: config.metadata.name.trim().slice(0, 30),
            version: "1",
            description: config.metadata.description ?? "Imported AI tone config",
            icon: "icon.png"
        },
        bpm: config.metadata.bpm ?? 120,
        sigpath: signalPath,
        type: "jamup_speaker"
    };

    const presetValidation = validateSparkPreset(preset, options);
    if (hasBlockingValidationErrors(presetValidation)) {
        throw new AiToneConfigError("Generated Spark preset failed validation.", presetValidation.issues);
    }

    return preset;
}

function createPortableToneId(): string {
    const randomUuid = (globalThis.crypto as any)?.randomUUID?.();
    if (randomUuid) {
        return randomUuid;
    }
    return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toKnobScale(value: any): number {
    const numeric = isFiniteNumber(value) ? value : 0;
    return Math.round(Math.max(0, Math.min(10, numeric * 10)) * 100) / 100;
}

export function sparkPresetToAiToneConfig(preset: Preset, options: AiToneConfigOptions = {}): AiToneConfig {
    const profile = getSparkModelProfile(options.modelId ?? "spark-2");
    const slots: AiToneConfigSlot[] = [];
    const sourcePath = preset?.sigpath ?? [];

    for (let idx = 0; idx < AI_TONE_SLOT_ORDER.length; idx++) {
        const slotName = AI_TONE_SLOT_ORDER[idx];
        const fx = sourcePath[idx];
        const catalogItem = fx ? findSparkCatalogItem(fx.dspId, slotName, fx.params) : null;
        const knobs: Record<string, number> = {};

        if (catalogItem && fx?.params) {
            for (const catalogParam of catalogItem.params ?? []) {
                const found = fx.params.find(p => p.index === catalogParam.index);
                knobs[catalogParam.name] = toKnobScale(found?.value);
            }
        }

        let dspId = fx?.dspId ?? "";
        if (normalizeSparkDspId(dspId) === "bias.reverb") {
            dspId = `bias.reverb.${deriveReverbVariantFromParams(fx.params)}`;
        } else {
            dspId = normalizeSparkDspId(dspId);
        }

        slots.push({
            slot: slotName,
            dspId,
            enabled: fx?.active === true,
            knobs
        });
    }

    return {
        schema: AI_TONE_SCHEMA_VERSION,
        targetDevice: profile.id,
        metadata: {
            name: preset?.meta?.name ?? "Exported Spark Tone",
            description: preset?.meta?.description ?? "Exported from current Spark preset state.",
            bpm: preset?.bpm ?? 120
        },
        requirements: {
            expansions: []
        },
        slots
    };
}
