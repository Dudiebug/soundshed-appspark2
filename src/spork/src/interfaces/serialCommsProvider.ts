import { BluetoothDeviceInfo } from "./deviceController";
import { SparkWriteRoute } from "../../../core/sparkDiagnostics";

export interface SerialWriteOptions {
    route?: SparkWriteRoute;
    traceId?: string;
}

export interface SerialCommsProvider {
    disconnect(): Promise<void>;

    connect(device: BluetoothDeviceInfo): Promise<boolean>

    scanForDevices(): Promise<any>;

    beginQueuedReceive(): Promise<boolean>;

    readReceiveQueue() : Array<Uint8Array>;

    peekReceiveQueueEnd() : Uint8Array;

    write(buffer, options?: SerialWriteOptions): Promise<void>

    waitForAck?(cmd: number | number[], subCmd: number, timeoutMs?: number): Promise<boolean>;

    isSpark2Connection?(): boolean;

    getTransportDiagnostics?(): any;

    getGattInventory?(): Promise<any>;
}
