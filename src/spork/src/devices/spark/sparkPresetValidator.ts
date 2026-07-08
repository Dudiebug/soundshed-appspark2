import { Preset } from "../../interfaces/preset";
import {
    AiToneConfigOptions,
    ToneValidationResult,
    hasBlockingValidationErrors,
    validateSparkPreset
} from "../../../../core/aiToneConfig";

export type SparkPresetValidationOptions = AiToneConfigOptions;
export type SparkPresetValidationResult = ToneValidationResult;

export class SparkPresetValidationError extends Error {
    public validation: SparkPresetValidationResult;

    constructor(validation: SparkPresetValidationResult) {
        super("Spark preset failed validation and was not sent to the amp.");
        this.name = "SparkPresetValidationError";
        this.validation = validation;
    }
}

export function validateSparkPresetForDevice(preset: Preset, options: SparkPresetValidationOptions = {}): SparkPresetValidationResult {
    return validateSparkPreset(preset, options);
}

export function assertSparkPresetIsSafe(preset: Preset, options: SparkPresetValidationOptions = {}): void {
    const validation = validateSparkPresetForDevice(preset, options);
    if (hasBlockingValidationErrors(validation)) {
        throw new SparkPresetValidationError(validation);
    }
}
