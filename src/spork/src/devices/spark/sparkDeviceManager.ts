import { DeviceController, BluetoothDeviceInfo } from "../../interfaces/deviceController";
import { DeviceMessage, DeviceState, Preset } from "../../interfaces/preset";
import { SparkCommandMessage } from "./sparkCommandMessage";
import { FxCatalogProvider } from "./sparkFxCatalog";
import { SparkMessageReader } from "./sparkMessageReader";
import { FxMappingSparkToTone } from "../../../../core/fxMapping";
import { SerialCommsProvider } from "../../interfaces/serialCommsProvider";
import { Utils } from "../../../../core/utils";
import { assertSparkPresetIsSafe } from "./sparkPresetValidator";
import { SparkDiagnostics, SparkWriteRoute } from "../../../../core/sparkDiagnostics";

export class SparkDeviceManager implements DeviceController {

    public onStateChanged;

    public deviceAddress = "";
    private isSpark2 = false;
    private receiverInterval: ReturnType<typeof setInterval> = null;

    private reader = new SparkMessageReader();

    constructor(private connection: SerialCommsProvider) {

    }

    public async scanForDevices(): Promise<BluetoothDeviceInfo[]> {
        return this.connection.scanForDevices();
    }

    public async connect(device: BluetoothDeviceInfo): Promise<boolean> {

        this.isSpark2 = (device?.name || "").toLowerCase().includes("spark 2");

        var connected = await this.connection.connect(device);

        if (connected && this.connection.isSpark2Connection) {
            this.isSpark2 = this.connection.isSpark2Connection();
        }

        if (connected) {

            // setup device read listener, running as background message receiver
            await this.startReceiver();

        } else {
            this.log("Device not yet connected! Cannot listen for data");
        }

        return connected;
    }

    public isSpark2Device(): boolean {
        return this.isSpark2;
    }

    public getDiagnosticsSnapshot() {
        return {
            isSpark2: this.isSpark2,
            transport: this.connection.getTransportDiagnostics ? this.connection.getTransportDiagnostics() : null,
            commands: SparkDiagnostics.snapshot()
        };
    }

    public async runProtocolExplorerSnapshot() {
        const gattInventory = this.connection.getGattInventory ? await this.connection.getGattInventory() : null;

        const safeGets = [
            { label: "device-name", command: "get_device_name", data: {} },
            { label: "device-serial", command: "get_device_serial", data: {} },
            { label: "selected-channel", command: "get_selected_channel", data: {} },
            { label: "current-preset", command: "get_preset", data: 0x7f }
        ];

        for (const probe of safeGets) {
            try {
                await this.sendCommand(probe.command, probe.data);
                await Utils.sleepAsync(250);
            } catch (err) {
                this.log(`Protocol explorer safe GET '${probe.label}' failed: ${(err as Error).message}`);
            }
        }

        return {
            mode: "safe-get-only",
            gattInventory,
            diagnostics: this.getDiagnosticsSnapshot(),
            note: "Protocol explorer did not mutate amp settings. It only enumerated GATT data when available and dispatched known safe GET commands."
        };
    }

    private getValidationModelId(): string {
        return this.isSpark2 ? "spark-2" : "spark-40";
    }

    private validatePresetBeforeSending(preset: Preset) {
        assertSparkPresetIsSafe(preset, { modelId: this.getValidationModelId() });
    }

    private assertDspMutationSafe(dspId: string) {
        const normalized = (dspId ?? "").replace(/^pg\.spark40\./i, "").replace(/^pg\.spark2\./i, "");
        if (normalized.startsWith("JH.")) {
            throw new Error(`DSP '${normalized}' requires the Jimi Hendrix expansion and is blocked by default.`);
        }
    }

    public async startReceiver() {

        // continuously peek message queue for message terminator, then consume queue

        this.log("Starting background receiver");

        await this.connection.beginQueuedReceive();

        let msgLoop = async () => {

            let queueContent = this.connection.readReceiveQueue();

            if (queueContent != null && queueContent.length > 0) {
                this.log("Received last message in batch, processing messages " + queueContent.length);
                for (var c of queueContent) {
                    this.log(`MSG:${c[2]} IDX: ${c[8]} of ${c[7]} \t${this.buf2hex(c)}`);
                }
                await this.readStateMessage(queueContent);
            }
        };

        // initial run
        msgLoop();

        if (this.receiverInterval != null) {
            clearInterval(this.receiverInterval);
        }

        // call msg loop every 50 ms
        this.receiverInterval = setInterval(msgLoop, 50);
    }

    public async disconnect() {
        try {
            if (this.receiverInterval != null) {
                clearInterval(this.receiverInterval);
                this.receiverInterval = null;
            }
            await this.connection.disconnect();
        } catch { }
    }

    private buf2hex(buffer: Uint8Array | ArrayBuffer) {
        return Array.prototype.map.call(new Uint8Array(buffer), x => ("00" + x.toString(16)).slice(-2)).join("");
    }

    private getFrameCommandInfo(frame: Uint8Array): { commandByte?: number; subCommandByte?: number } {
        if (!frame || frame.length < 6) {
            return {};
        }

        if (frame.length > 21 && frame[0] === 0x01 && frame[1] === 0xfe) {
            return { commandByte: frame[20], subCommandByte: frame[21] };
        }

        return { commandByte: frame[4], subCommandByte: frame[5] };
    }

    private getWriteRoute(type: string): SparkWriteRoute {
        return type === "request_live_sync" ? "auxiliary" : "control";
    }

    private summarizeTraceData(type: string, data: any) {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return {};
        }

        return {
            dspId: data.dspId ?? data.dspIdNew ?? data.dspIdOld,
            paramIndex: typeof data.index === "number" ? data.index : undefined,
            value: typeof data.value === "number" ? data.value : undefined
        };
    }

    public async readStateMessage(dataArray: Array<Uint8Array>): Promise<DeviceMessage[]> {

        let reader = this.reader;

        reader.set_message(dataArray);

        reader.read_message();

        // reader receivedMessageQueue now contains an ordered list of interpreted messages
        let msgList = reader.readMessageQueue();
        for (let m of msgList) {

            this.log(m);

            if (m.type == "preset") {
                reader.deviceState.presetConfig = <Preset>m.value;
                this.hydrateDeviceStateInfo(reader.deviceState);
            }

            if (this.onStateChanged) {
                reader.deviceState.message = m;
                this.onStateChanged(reader.deviceState);
            } else {
                this.log("No onStateChange handler defined.");
            }
        }

        return msgList;
    }

    private hydrateDeviceStateInfo(deviceState: DeviceState) {

        let fxCatalog = FxCatalogProvider.getFxCatalog();

        // populate metadata about fx etc
        if (deviceState.presetConfig) {

            for (let fx of (deviceState.presetConfig.sigpath ?? [])) {

                let dspId = fx.dspId;

                if (dspId.indexOf("bias.reverb") > -1 && fx.params?.[6]) {
                    //map mode variant to our config dspId
                    dspId = FxMappingSparkToTone.getReverbDspId(fx.params[6].value);
                } else {
                    dspId = FxMappingSparkToTone.mapFxId(dspId);
                }

                let dsp = fxCatalog.catalog.find(f => f.dspId == dspId);

                if (dsp != null) {
                    fx.type = dsp.type;
                    fx.name = dsp.name;
                    fx.description = dsp.description;

                    for (let p of fx.params) {
                        let paramInfo = dsp.params.find(pa => pa.index == p.index);
                        if (paramInfo) {
                            p.name = paramInfo.name;
                        }
                    }

                } else {
                    this.log("DSP Id is not present in FX Catalog: " + dspId);

                    fx.name = FxMappingSparkToTone.mapFxId(fx.dspId);
                    fx.description = "(No description)";

                    for (let p of fx.params) {
                        if (p != null) {
                            p.name = "Param " + p.index.toString();
                        }
                    }
                }
            }
        }
    }

    public async sendCommand(type, data) {

        const traceId = SparkDiagnostics.start({
            action: type,
            commandType: type,
            route: this.getWriteRoute(type),
            ackExpected: this.isSpark2 && (type == "set_preset" || type == "set_preset_from_model"),
            ...this.summarizeTraceData(type, data)
        });

        try {
            let msg = new SparkCommandMessage({ spark2: this.isSpark2 });

            let msgArray: Uint8Array[] = [];

            if (type == "set_preset") {
                this.log("Setting preset " + JSON.stringify(data));
                this.validatePresetBeforeSending(data);
                msgArray = msg.create_preset(data);
            }

            if (type == "set_preset_from_model") {
                this.log("Setting preset" + JSON.stringify(data));

                if (Array.isArray(data)){
                    this.log("Got preset and target channel number");
                    // if data is array with preset and target channel number use that
                    this.validatePresetBeforeSending(data[0]);
                    msgArray = msg.create_preset_from_model(data[0], data[1]);
                } else {
                    // set preset to soft channel (not stored to hardware)
                    this.validatePresetBeforeSending(data);
                    msgArray = msg.create_preset_from_model(data);
                }

            }

            if (type == "store_current_preset") {
                this.log("Storing preset" + JSON.stringify(data));
                msgArray = msg.store_current_preset(data);
            }

            if (type == "set_channel") {
                this.log("Setting hardware channel " + JSON.stringify(data));
                msgArray = msg.change_hardware_preset(data);
            }

            if (type == "change_amp") {
                this.log("Changing Amp " + JSON.stringify(data));
                this.assertDspMutationSafe(data.dspIdOld);
                this.assertDspMutationSafe(data.dspIdNew);
                msgArray = msg.change_amp(data.dspIdOld, data.dspIdNew);
            }

            if (type == "set_amp_param") {
                this.log("Changing Amp Param " + JSON.stringify(data));
                this.assertDspMutationSafe(data.dspId);
                msgArray = msg.change_amp_parameter(data.dspId, data.index, data.value);
            }

            if (type == "change_fx") {
                this.log("Changing Effect " + JSON.stringify(data));
                this.assertDspMutationSafe(data.dspIdOld);
                this.assertDspMutationSafe(data.dspIdNew);
                msgArray = msg.change_effect(data.dspIdOld, data.dspIdNew);
            }

            if (type == "set_fx_onoff") {
                this.log("Toggling Effect " + JSON.stringify(data));
                this.assertDspMutationSafe(data.dspId);
                msgArray = msg.turn_effect_onoff(data.dspId, data.value == 1 ? "On" : "Off");
            }

            if (type == "set_fx_param") {
                this.log("Changing Effect Param " + JSON.stringify(data));
                this.assertDspMutationSafe(data.dspId);
                msgArray = msg.change_effect_parameter(data.dspId, data.index, data.value);
            }

            if (type == "get_preset") {
                this.log("Getting preset");
                msgArray = msg.request_preset_state(data);
            }

            if (type == "get_selected_channel") {
                this.log("Getting device current channel selection");
                msgArray = msg.request_info(0x10);
            }

            if (type == "get_device_name") {
                this.log("Getting device name");
                msgArray = msg.request_info(0x11);
            }

            if (type == "get_device_serial") {
                this.log("Getting device serial");
                msgArray = msg.request_info(0x23);
            }

            if (type == "request_live_sync") {
                this.log("Requesting Spark 2 live sync");
                msgArray = msg.request_live_sync();
            }

            const firstFrame = msgArray[0];
            const frameInfo = firstFrame ? this.getFrameCommandInfo(firstFrame) : {};
            SparkDiagnostics.update(traceId, {
                ...frameInfo,
                bytesLength: msgArray.reduce((total, item) => total + item.length, 0),
                chunkCount: msgArray.length,
                route: this.getWriteRoute(type)
            });

            if (this.isSpark2 && (type == "set_preset" || type == "set_preset_from_model") && msgArray.length > 0) {
                await this.sendSpark2PresetChunks(msgArray, traceId);
                SparkDiagnostics.complete(traceId, { ackReceived: true });
                return;
            }

            const route = this.getWriteRoute(type);
            for (let dat of msgArray) {
                this.log("[SEND RAW]: " + this.buf2hex(dat));

                if (typeof (Buffer) != "undefined") {
                    await this.connection.write(Buffer.from(dat), { route, traceId });
                } else {
                    await this.connection.write(dat, { route, traceId });
                }
            }

            SparkDiagnostics.complete(traceId);

        } catch (err) {
            SparkDiagnostics.fail(traceId, err);
            throw err;
        }
    }

    private async sendSpark2PresetChunks(msgArray: Uint8Array[], traceId: string) {
        this.log(`Spark 2 upload mode enabled for ${msgArray.length} chunks`);

        for (let idx = 0; idx < msgArray.length; idx++) {
            const dat = msgArray[idx];

            SparkDiagnostics.update(traceId, {
                chunkIndex: idx,
                chunkCount: msgArray.length,
                ackExpected: true
            });

            this.log("[SEND RAW]: " + this.buf2hex(dat));
            if (typeof (Buffer) != "undefined") {
                await this.connection.write(Buffer.from(dat), { route: "control", traceId });
            } else {
                await this.connection.write(dat, { route: "control", traceId });
            }

            if (this.connection.waitForAck) {
                const expectedCmd = idx === msgArray.length - 1 ? 0x04 : 0x05;
                const ackOk = await this.connection.waitForAck([expectedCmd], 0x01, 3000);
                SparkDiagnostics.update(traceId, { ackReceived: ackOk });
                if (!ackOk) {
                    const msg = `Timed out waiting for Spark 2 upload ack cmd=${expectedCmd.toString(16)} sub=01`;
                    this.log(msg);
                    throw new Error(msg);
                }
            }
        }
    }

    hexToUint8Array(hex: string): Uint8Array {
        let bytes: number[] = [];
        for (let c = 0; c < hex.length; c += 2) {
            bytes.push(parseInt(hex.substr(c, 2), 16));
        }

        return new Uint8Array(bytes);
    }

    private log(msg) {
        console.info("[SparkDeviceManager]:");
        console.info(msg);
    }
}
