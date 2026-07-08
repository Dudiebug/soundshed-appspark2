import { SparkDeviceManager } from "../spork/src/devices/spark/sparkDeviceManager";
import { Preset, SignalPath } from "../spork/src/interfaces/preset";
import { SerialCommsProvider } from "../spork/src/interfaces/serialCommsProvider";
import { FxCatalogProvider } from "../spork/src/devices/spark/sparkFxCatalog";
import { SparkDiagnostics } from "./sparkDiagnostics";

const VIRTUAL_PRESET_CHANNEL = 0x7f;
const AMP_SLOT_INDEX = 3;
const AMP_MASTER_PARAM_INDEX = 4;

export class DeviceContext {

    deviceManager: SparkDeviceManager;
    msgSendDelegate: (type: string, msg: any) => void;

    private log(msg: string) {
        console.debug(msg);
    }

    public init(commsProvider: SerialCommsProvider, msgDelegate: (type: string, msg: any) => void) {

        this.log("DeviceContext: Init");

        this.deviceManager = new SparkDeviceManager(commsProvider);

        this.deviceManager.onStateChanged = (s: any) => {
            this.log("DeviceContext: device state changed");
            this.sendMessageToApp("device-state-changed", s);
        };

        this.msgSendDelegate = msgDelegate;
    }

    private sendMessageToApp(type: string, args: any) {
        if (this.msgSendDelegate) {
            this.msgSendDelegate(type, args);
        } else {
            this.log("Cannot send message, no delegate provided");
        }
    }

    private normalizeDspId(dspId: string): string {
        return (dspId ?? "")
            .replace(/^pg\.spark40\./i, "")
            .replace(/^pg\.spark2\./i, "");
    }

    private isAmpDspId(dspId: string): boolean {
        const normalized = this.normalizeDspId(dspId);
        const item = FxCatalogProvider.getFxCatalog().catalog.find(c => this.normalizeDspId(c.dspId) === normalized);
        return item?.type === "amp";
    }

    private isMasterParam(data: any): boolean {
        return Number(data?.index) === AMP_MASTER_PARAM_INDEX;
    }

    private async sendCommandSafe(command: string, data: any = {}): Promise<boolean> {
        try {
            await this.deviceManager.sendCommand(command, data);
            return true;
        } catch (err) {
            const message = (err as Error).message ?? String(err);
            console.warn(`[DeviceContext] Command '${command}' failed: ${message}`);
            this.sendMessageToApp("device-state-changed", {
                message: {
                    type: "device_command_failed",
                    command,
                    error: message
                }
            });
            return false;
        }
    }

    private async sendAmpParamWithMasterFallback(data: any): Promise<boolean> {
        const ampSent = await this.sendCommandSafe("set_amp_param", data);

        if (this.isMasterParam(data)) {
            // Some Spark 2 firmware paths appear to ignore amp-master writes on the amp-specific
            // 03/37 command even when other amp params work. Send the same value through the
            // normal effect-param route too. If both paths work, they set the same value.
            const fxSent = await this.sendCommandSafe("set_fx_param", data);
            return ampSent || fxSent;
        }

        return ampSent;
    }

    private sendDiagnosticsMessage(messageType: string, value: any) {
        this.sendMessageToApp("device-state-changed", {
            message: {
                type: messageType,
                value
            }
        });
    }

    private getCurrentSparkPresetSnapshot(): Preset | null {
        const maybeManager = this.deviceManager as any;
        const preset = maybeManager?.reader?.deviceState?.presetConfig;
        return preset ? JSON.parse(JSON.stringify(preset)) : null;
    }

    private async applyPresetAsLivePatch(targetPreset: Preset): Promise<boolean> {
        const currentPreset = this.getCurrentSparkPresetSnapshot();
        if (!currentPreset?.sigpath?.length) {
            this.log("No current preset readback is available; cannot live-patch imported tone.");
            return false;
        }

        const targetPath = targetPreset?.sigpath ?? [];
        if (targetPath.length !== 7) {
            throw new Error(`Live patch requires a 7-slot target signal path, got ${targetPath.length}.`);
        }

        const currentPath = currentPreset.sigpath ?? [];
        let ok = true;

        for (let slotIndex = 0; slotIndex < targetPath.length; slotIndex++) {
            const desiredFx: SignalPath = targetPath[slotIndex];
            const currentFx: SignalPath = currentPath[slotIndex];
            const desiredDspId = this.normalizeDspId(desiredFx?.dspId);
            const currentDspId = this.normalizeDspId(currentFx?.dspId);

            if (!desiredDspId) {
                this.log(`Skipping live patch slot ${slotIndex}: missing target DSP ID.`);
                ok = false;
                continue;
            }

            if (currentDspId && desiredDspId !== currentDspId) {
                const changeOk = slotIndex === AMP_SLOT_INDEX
                    ? await this.sendCommandSafe("change_amp", { dspIdOld: currentDspId, dspIdNew: desiredDspId })
                    : await this.sendCommandSafe("change_fx", { dspIdOld: currentDspId, dspIdNew: desiredDspId });
                ok = ok && changeOk;
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            if (slotIndex !== AMP_SLOT_INDEX) {
                const toggleOk = await this.sendCommandSafe("set_fx_onoff", {
                    dspId: desiredDspId,
                    value: desiredFx.active === true ? 1 : 0
                });
                ok = ok && toggleOk;
            }

            const params = [...(desiredFx.params ?? [])].sort((a, b) => a.index - b.index);
            for (const param of params) {
                // Reverb index 7 is the preset's encoded OnOff value. The actual live toggle is
                // handled above through set_fx_onoff, so do not send it as a knob change.
                if (this.normalizeDspId(desiredDspId) === "bias.reverb" && param.index === 7) {
                    continue;
                }

                const data = {
                    dspId: desiredDspId,
                    index: param.index,
                    value: param.value
                };

                const paramOk = slotIndex === AMP_SLOT_INDEX
                    ? await this.sendAmpParamWithMasterFallback(data)
                    : await this.sendCommandSafe("set_fx_param", data);

                ok = ok && paramOk;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        await this.sendCommandSafe("get_preset", VIRTUAL_PRESET_CHANNEL);
        return ok;
    }

    private async applyPresetByUpload(targetPreset: Preset): Promise<boolean> {
        const sent = await this.sendCommandSafe("set_preset_from_model", targetPreset);
        if (!sent) {
            return false;
        }

        const channelSwitchDelayMs = this.deviceManager.isSpark2Device() ? 500 : 100;
        await new Promise(resolve => setTimeout(resolve, channelSwitchDelayMs));

        // apply preset to virtual channel 127 (0x7f)
        const switched = await this.sendCommandSafe("set_channel", VIRTUAL_PRESET_CHANNEL);

        if (switched && this.deviceManager.isSpark2Device()) {
            await this.sendCommandSafe("request_live_sync", {});
        }

        await this.sendCommandSafe("get_preset", VIRTUAL_PRESET_CHANNEL);
        return switched;
    }

    private async applyPreset(args: Preset): Promise<boolean> {
        if (this.deviceManager.isSpark2Device()) {
            const patched = await this.applyPresetAsLivePatch(args);
            if (patched) {
                return true;
            }

            this.log("Spark 2 live-patch apply failed; falling back to full preset upload.");
        }

        return this.applyPresetByUpload(args);
    }

    public performAction(args: any) {
        // ... do actions on behalf of the Renderer
        this.log("got event from render:" + args.action);

        if (args.action == "scan") {
            this.deviceManager.scanForDevices().then((devices) => {
                this.log(JSON.stringify(devices));
                this.sendMessageToApp("devices-discovered", devices);
            });
        }

        if (args.action == "connect") {
            this.log("attempting to connect:: " + JSON.stringify(args));

            try {
                return this.deviceManager.connect(args.data).then(connectedOk => {
                    if (connectedOk) {
                        this.sendMessageToApp("device-connection-changed", "connected");
                        this.sendCommandSafe("get_preset", 0);
                    } else {
                        this.sendMessageToApp("device-connection-changed", "failed");
                    }

                    return connectedOk;
                }).catch(err => {
                    console.warn("Device connect failed", err);
                    this.sendMessageToApp("device-connection-changed", "failed");
                });

            } catch (e) {
                this.sendMessageToApp("device-connection-changed", "failed");
            }
        }

        if (args.action == "applyPreset") {
            this.applyPreset(args.data).then((applied) => {
                if (!applied) {
                    this.sendMessageToApp("device-state-changed", {
                        message: {
                            type: "device_command_failed",
                            command: "applyPreset",
                            error: "Imported preset apply did not complete."
                        }
                    });
                }
            });
        }

        if (args.action == "getCurrentChannel") {
            this.sendCommandSafe("get_selected_channel", {});
        }

        if (args.action == "getDeviceName") {
            this.sendCommandSafe("get_device_name", {});
        }

        if (args.action == "getDeviceSerial") {
            this.sendCommandSafe("get_device_serial", {});
        }

        if (args.action == "getPreset") {
            let ch = 0;
            if (args.data >= 0) {
                ch = args.data;
            }
            this.sendCommandSafe("get_preset", ch);
        }

        if (args.action == "setChannel") {
            this.sendCommandSafe("set_channel", args.data);
        }

        if (args.action == "setFxParam") {
            const isAmp = this.isAmpDspId(args.data?.dspId);
            const send = isAmp
                ? this.sendAmpParamWithMasterFallback(args.data)
                : this.sendCommandSafe("set_fx_param", args.data);
            send.then(async (sent) => {
                if (sent) {
                    await new Promise(resolve => setTimeout(resolve, 350));
                    await this.sendCommandSafe("get_preset", VIRTUAL_PRESET_CHANNEL);
                }
            });
        }

        if (args.action == "setAmpParam") {
            this.sendAmpParamWithMasterFallback(args.data).then(async (sent) => {
                if (sent) {
                    await new Promise(resolve => setTimeout(resolve, 350));
                    await this.sendCommandSafe("get_preset", VIRTUAL_PRESET_CHANNEL);
                }
            });
        }

        if (args.action == "setFxToggle") {
            this.sendCommandSafe("set_fx_onoff", args.data).then(async (sent) => {
                if (sent) {
                    await new Promise(resolve => setTimeout(resolve, 350));
                    await this.sendCommandSafe("get_preset", VIRTUAL_PRESET_CHANNEL);
                }
            });
        }

        if (args.action == "changeFx") {
            this.sendCommandSafe("change_fx", args.data).then(async (sent) => {
                if (sent) {
                    await new Promise(resolve => setTimeout(resolve, 350));
                    await this.sendCommandSafe("get_preset", VIRTUAL_PRESET_CHANNEL);
                }
            });
        }

        if (args.action == "changeAmp") {
            this.sendCommandSafe("change_amp", args.data).then(async (sent) => {
                if (sent) {
                    await new Promise(resolve => setTimeout(resolve, 350));
                    await this.sendCommandSafe("get_preset", VIRTUAL_PRESET_CHANNEL);
                }
            });
        }

        if (args.action == "storePreset") {
            // send current preset with preset and channel num we want to store to
            this.sendCommandSafe("set_preset_from_model", args.data);
        }

        if (args.action == "getSparkDiagnostics") {
            this.sendDiagnosticsMessage("spark_diagnostics", {
                commands: SparkDiagnostics.snapshot(),
                device: this.deviceManager.getDiagnosticsSnapshot()
            });
        }

        if (args.action == "runProtocolExplorer") {
            this.deviceManager.runProtocolExplorerSnapshot().then(result => {
                this.sendDiagnosticsMessage("protocol_explorer_snapshot", result);
            }).catch(err => {
                this.sendDiagnosticsMessage("protocol_explorer_snapshot", {
                    error: (err as Error).message ?? String(err),
                    commands: SparkDiagnostics.snapshot()
                });
            });
        }
    }
}
