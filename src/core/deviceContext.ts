import { SparkDeviceManager } from "../spork/src/devices/spark/sparkDeviceManager";
import { SerialCommsProvider } from "../spork/src/interfaces/serialCommsProvider";

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
            this.sendCommandSafe("set_preset_from_model", args.data).then(async (sent) => {
                if (!sent) {
                    return;
                }

                const channelSwitchDelayMs = this.deviceManager.isSpark2Device() ? 500 : 100;
                await new Promise(resolve => setTimeout(resolve, channelSwitchDelayMs));

                // apply preset to virtual channel 127 (0x7f)
                const switched = await this.sendCommandSafe("set_channel", 0x7f);

                if (switched && this.deviceManager.isSpark2Device()) {
                    await this.sendCommandSafe("request_live_sync", {});
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
            this.sendCommandSafe("set_fx_param", args.data);
        }

        if (args.action == "setFxToggle") {
            this.sendCommandSafe("set_fx_onoff", args.data);
        }

        if (args.action == "changeFx") {
            this.sendCommandSafe("change_fx", args.data);
        }

        if (args.action == "changeAmp") {
            this.sendCommandSafe("change_amp", args.data);
        }

        if (args.action == "storePreset") {
            // send current preset with preset and channel num we want to store to
            this.sendCommandSafe("set_preset_from_model", args.data);
        }
    }
}
