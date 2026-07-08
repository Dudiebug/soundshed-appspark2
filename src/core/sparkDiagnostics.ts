export type SparkWriteRoute = "control" | "auxiliary";

export interface SparkCommandTraceEntry {
    id: string;
    action: string;
    commandType?: string;
    commandByte?: number;
    subCommandByte?: number;
    dspId?: string;
    paramIndex?: number;
    value?: number;
    route?: SparkWriteRoute;
    transportProfile?: string;
    serviceUuid?: string;
    writeCharacteristicUuid?: string;
    notifyCharacteristicUuid?: string;
    bytesLength?: number;
    chunkIndex?: number;
    chunkCount?: number;
    startedAt: string;
    completedAt?: string;
    ackExpected?: boolean;
    ackReceived?: boolean;
    responseReceived?: boolean;
    readbackCompared?: boolean;
    readbackMatched?: boolean;
    error?: string;
}

function createId(): string {
    return `spark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class SparkDiagnostics {
    private static entries: SparkCommandTraceEntry[] = [];
    private static maxEntries = 250;

    static start(entry: Omit<SparkCommandTraceEntry, "id" | "startedAt">): string {
        const id = createId();
        const next: SparkCommandTraceEntry = {
            id,
            startedAt: new Date().toISOString(),
            ...entry
        };
        this.entries.push(next);
        this.trim();
        console.debug("[SparkDiagnostics] start", next);
        return id;
    }

    static update(id: string, patch: Partial<SparkCommandTraceEntry>) {
        const entry = this.entries.find(item => item.id === id);
        if (!entry) {
            return;
        }
        Object.assign(entry, patch);
        this.trim();
    }

    static complete(id: string, patch: Partial<SparkCommandTraceEntry> = {}) {
        this.update(id, {
            completedAt: new Date().toISOString(),
            ...patch
        });
        const entry = this.entries.find(item => item.id === id);
        console.debug("[SparkDiagnostics] complete", entry);
    }

    static fail(id: string, error: unknown, patch: Partial<SparkCommandTraceEntry> = {}) {
        const message = error instanceof Error ? error.message : String(error);
        this.complete(id, {
            error: message,
            ...patch
        });
    }

    static snapshot(): SparkCommandTraceEntry[] {
        return this.entries.map(item => ({ ...item }));
    }

    static clear() {
        this.entries = [];
    }

    private static trim() {
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(this.entries.length - this.maxEntries);
        }
    }
}

export function clampUnitValue(value: unknown): number {
    const numeric = typeof value === "string" ? parseFloat(value) : Number(value);
    if (!Number.isFinite(numeric)) {
        throw new Error(`Invalid unit value '${String(value)}'.`);
    }
    return Math.max(0, Math.min(1, numeric));
}

export function parseParamIndex(value: unknown): number {
    const numeric = typeof value === "string" ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error(`Invalid parameter index '${String(value)}'.`);
    }
    return numeric;
}
