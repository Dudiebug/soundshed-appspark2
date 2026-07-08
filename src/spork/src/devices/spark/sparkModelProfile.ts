export type SparkModelId = "spark-40" | "spark-mini" | "spark-go" | "spark-neo" | "spark-2";

export interface SparkBleServiceProfile {
    serviceUuid: string;
    commandCharacteristicUuid: string;
    notifyCharacteristicUuid: string;
    purpose: "control" | "auxiliary";
}

export interface SparkModelProfile {
    id: SparkModelId;
    displayName: string;
    nameMatchers: string[];
    presetSlots: number;
    controlService: SparkBleServiceProfile;
    auxiliaryService?: SparkBleServiceProfile;
    maxAttWriteBytes?: number;
    uploadChunkAckCmd: number;
    uploadFinalAckCmd: number;
    supportsLiveSync: boolean;
    supportsCompactPresetReadback: boolean;
    defaultBlockedExpansionIds: string[];
}

const SPARK_40_CONTROL_SERVICE: SparkBleServiceProfile = {
    serviceUuid: "0000ffc0-0000-1000-8000-00805f9b34fb",
    commandCharacteristicUuid: "0xffc1",
    notifyCharacteristicUuid: "0xffc2",
    purpose: "control"
};

export const SPARK_MODEL_PROFILES: Record<SparkModelId, SparkModelProfile> = {
    "spark-40": {
        id: "spark-40",
        displayName: "Spark 40",
        nameMatchers: ["spark 40", "spark40"],
        presetSlots: 4,
        controlService: SPARK_40_CONTROL_SERVICE,
        uploadChunkAckCmd: 0x04,
        uploadFinalAckCmd: 0x04,
        supportsLiveSync: false,
        supportsCompactPresetReadback: false,
        defaultBlockedExpansionIds: []
    },
    "spark-mini": {
        id: "spark-mini",
        displayName: "Spark MINI",
        nameMatchers: ["spark mini", "spark mini ble", "spark-mini"],
        presetSlots: 4,
        controlService: SPARK_40_CONTROL_SERVICE,
        uploadChunkAckCmd: 0x04,
        uploadFinalAckCmd: 0x04,
        supportsLiveSync: false,
        supportsCompactPresetReadback: false,
        defaultBlockedExpansionIds: []
    },
    "spark-go": {
        id: "spark-go",
        displayName: "Spark GO",
        nameMatchers: ["spark go", "spark go ble", "spark-go"],
        presetSlots: 4,
        controlService: SPARK_40_CONTROL_SERVICE,
        uploadChunkAckCmd: 0x04,
        uploadFinalAckCmd: 0x04,
        supportsLiveSync: false,
        supportsCompactPresetReadback: false,
        defaultBlockedExpansionIds: []
    },
    "spark-neo": {
        id: "spark-neo",
        displayName: "Spark NEO",
        nameMatchers: ["spark neo", "spark neo ble", "spark-neo"],
        presetSlots: 4,
        controlService: SPARK_40_CONTROL_SERVICE,
        uploadChunkAckCmd: 0x04,
        uploadFinalAckCmd: 0x04,
        supportsLiveSync: false,
        supportsCompactPresetReadback: false,
        defaultBlockedExpansionIds: []
    },
    "spark-2": {
        id: "spark-2",
        displayName: "Spark 2",
        nameMatchers: ["spark 2", "spark 2 ble", "spark-2", "spark2"],
        presetSlots: 8,
        controlService: SPARK_40_CONTROL_SERVICE,
        auxiliaryService: {
            serviceUuid: "0000ffc8-0000-1000-8000-00805f9b34fb",
            commandCharacteristicUuid: "0xffc9",
            notifyCharacteristicUuid: "0xffca",
            purpose: "auxiliary"
        },
        maxAttWriteBytes: 100,
        uploadChunkAckCmd: 0x05,
        uploadFinalAckCmd: 0x04,
        supportsLiveSync: true,
        supportsCompactPresetReadback: true,
        defaultBlockedExpansionIds: ["jimi-hendrix"]
    }
};

export function isSparkModelId(value: string): value is SparkModelId {
    return Object.prototype.hasOwnProperty.call(SPARK_MODEL_PROFILES, value);
}

export function detectSparkModelId(deviceName?: string | null): SparkModelId {
    const normalized = (deviceName ?? "").toLowerCase();

    if (normalized.length === 0) {
        return "spark-40";
    }

    for (const profile of Object.values(SPARK_MODEL_PROFILES)) {
        if (profile.nameMatchers.some(matcher => normalized.includes(matcher))) {
            return profile.id;
        }
    }

    return "spark-40";
}

export function getSparkModelProfile(modelOrDeviceName?: SparkModelId | string | null): SparkModelProfile {
    if (modelOrDeviceName && isSparkModelId(modelOrDeviceName)) {
        return SPARK_MODEL_PROFILES[modelOrDeviceName];
    }

    return SPARK_MODEL_PROFILES[detectSparkModelId(modelOrDeviceName)];
}

export function getPresetSlotsForSparkModel(modelOrDeviceName?: SparkModelId | string | null): number {
    return getSparkModelProfile(modelOrDeviceName).presetSlots;
}
