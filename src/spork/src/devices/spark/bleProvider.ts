import { SerialCommsProvider, SerialWriteOptions } from "../../interfaces/serialCommsProvider";
import { BluetoothDeviceInfo } from "../../interfaces/deviceController";
import { Utils } from "../../../../core/utils";
import { SparkMessageReader } from "./sparkMessageReader";
import { SparkDiagnostics, SparkWriteRoute } from "../../../../core/sparkDiagnostics";

interface BleProfileState {
    serviceUuid: string;
    commandCharacteristicUuid: string;
    changeCharacteristicUuid: string;
    commandCharacteristic?: BluetoothRemoteGATTCharacteristic;
    changeCharacteristic?: BluetoothRemoteGATTCharacteristic;
    connected: boolean;
}

export class BleProvider implements SerialCommsProvider {

    private selectedDevice: BluetoothDevice;
    private server: BluetoothRemoteGATTServer;

    private serviceGenericUUID = '00001800-0000-1000-8000-00805f9b34fb'; // service 'generic_access'
    private serviceSpark40UUID = '0000ffc0-0000-1000-8000-00805f9b34fb'; // service 'FFC0'
    private serviceSpark2UUID = '0000ffc8-0000-1000-8000-00805f9b34fb'; // service 'FFC8'

    private spark40CommandCharacteristicUUID = '0xffc1'; // device command messages
    private spark40ChangesCharacteristicUUID = '0xffc2'; // device change messages
    private spark2CommandCharacteristicUUID = '0xffc9'; // Spark 2 auxiliary command messages
    private spark2ChangesCharacteristicUUID = '0xffca'; // Spark 2 auxiliary change messages

    private controlProfile: BleProfileState = {
        serviceUuid: this.serviceSpark40UUID,
        commandCharacteristicUuid: this.spark40CommandCharacteristicUUID,
        changeCharacteristicUuid: this.spark40ChangesCharacteristicUUID,
        connected: false
    };

    private auxiliaryProfile: BleProfileState = {
        serviceUuid: this.serviceSpark2UUID,
        commandCharacteristicUuid: this.spark2CommandCharacteristicUUID,
        changeCharacteristicUuid: this.spark2ChangesCharacteristicUUID,
        connected: false
    };

    private isSpark2ConnectionActive = false;

    private pendingAckWaiters: {
        cmd: number[];
        subCmd: number;
        resolve: (value: boolean) => void;
        timeoutHandle: ReturnType<typeof setTimeout>;
    }[] = [];

    private recentAcks: { cmd: number; subCmd: number; at: number }[] = [];

    private isConnected: boolean;
    private isReceiving: boolean;

    private receiveQueue: Array<Uint8Array>;
    private sendQueue: { msg: Uint8Array; options?: SerialWriteOptions }[];

    private lastTimeStamp = null;
    private lastDataChunkRemainder: Uint8Array = new Uint8Array();
    private lastMsgReceivedTime: Date = null;
    private lastMsgSentTime: Date = null;

    private minWaitTimeMSBetweenCommands = 500;
    private minWaitTimeForMessageQueue = 300;

    constructor() {
        this.receiveQueue = [];
        this.sendQueue = [];
        this.isReceiving = false;
    }

    /**
    * Find one or more bluetooth devices to choose from
    **/
    public async scanForDevices(): Promise<BluetoothDeviceInfo[]> {

        let devices: BluetoothDeviceInfo[] = [];

        const options = { acceptAllDevices: true, optionalServices: [this.serviceGenericUUID, this.serviceSpark40UUID, this.serviceSpark2UUID] };

        try {
            this.log("Requesting device..");

            // in the browser this prompts the user to select a device, in electron this starts "select-bluetooth-device" and only resolves once a selection is indicated from the UI and the callback has fired
            this.selectedDevice = await navigator.bluetooth.requestDevice(options);

            this.log("Got device selection from chooser. " + JSON.stringify(this.selectedDevice));

            devices.push({ name: this.selectedDevice.name, address: this.selectedDevice.id, port: null });

        } catch (e) {
            this.log("BLE device discovery cancelled or failed. " + JSON.stringify(e));
        }

        return devices;
    }

    public async connect(device: BluetoothDeviceInfo): Promise<boolean> {

        if (this.isConnected) {
            return true;
        }

        this.server = await this.selectedDevice.gatt.connect();

        if (this.server.connected) {
            this.log("Connected to device..");
            this.isConnected = true;

            this.log("Getting Device Service..");

            const expectsSpark2 = (device?.name || "").toLowerCase().includes("spark 2");
            this.isSpark2ConnectionActive = expectsSpark2;

            if (expectsSpark2) {
                // Spark 2 tone upload/control commands should still use the classic FFC0 profile.
                const controlConnected = await this.tryConnectProfile(this.controlProfile, true, "control");
                const auxiliaryConnected = await this.tryConnectProfile(this.auxiliaryProfile, true, "auxiliary");

                if (!controlConnected && auxiliaryConnected) {
                    // Fallback for unknown firmware behavior: keep the connection usable, but diagnostics will show that control fell back to FFC8.
                    this.log("Spark 2 primary FFC0 control profile was not available. Falling back to auxiliary profile for control writes.");
                    this.controlProfile = { ...this.auxiliaryProfile };
                    this.controlProfile.connected = true;
                }

                if (!this.controlProfile.connected) {
                    this.log("Failed to initialize Spark 2 BLE control profile");
                    return false;
                }

                return true;
            }

            const connected = await this.tryConnectProfile(this.controlProfile, false, "control");
            if (!connected) {
                this.log("Failed to initialize Spark BLE services and characteristics");
                return false;
            }

            return true;
        } else {
            this.log("Failed to connect to device..");
            return false;
        }
    }

    private async tryConnectProfile(profile: BleProfileState, isSpark2: boolean, label: SparkWriteRoute): Promise<boolean> {
        try {
            const service = await this.server.getPrimaryService(profile.serviceUuid);

            this.log(`Getting ${label} BLE characteristics for ${profile.serviceUuid}..`);

            profile.commandCharacteristic = await service.getCharacteristic(parseInt(profile.commandCharacteristicUuid));
            profile.changeCharacteristic = await service.getCharacteristic(parseInt(profile.changeCharacteristicUuid));
            profile.connected = true;
            this.isSpark2ConnectionActive = isSpark2;

            this.log(`Using ${isSpark2 ? "Spark 2" : "Spark 40"} ${label} BLE profile ${profile.serviceUuid}`);

            return true;
        } catch (err) {
            profile.connected = false;
            this.log(`Service discovery failed for ${profile.serviceUuid}: ${JSON.stringify(err)}`);
            return false;
        }
    }

    hexToBytes(hex: string) {
        for (var bytes = [], c = 0; c < hex.length; c += 2) {
            bytes.push(parseInt(hex.substr(c, 2), 16));
        }

        return bytes;
    }

    buf2hex(buffer) {
        // https://stackoverflow.com/questions/40031688/javascript-arraybuffer-to-hex
        return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
    }

    private log(msg, ...args) {
        console.debug("[BLE Provider] : " + msg);

        if (args) {
            args.forEach(element => {
                console.debug("[BLE Provider] : " + element);
            });
        }
    }

    getTimeDeltaSinceLastMsg(): number {
        if (this.lastMsgReceivedTime != null) {
            let current = new Date();
            return Math.abs(current.getTime() - this.lastMsgReceivedTime.getTime())
        } else {
            this.lastMsgReceivedTime = new Date();
            return 0;
        }
    }

    getTimeDeltaSinceLastCmd(): number {
        if (this.lastMsgSentTime != null) {
            let current = new Date();
            return Math.abs(current.getTime() - this.lastMsgSentTime.getTime())
        } else {
            this.lastMsgSentTime = new Date();
            return 0;
        }
    }

    public async disconnect() {

        if (this.selectedDevice?.gatt?.connected) {
            this.selectedDevice.gatt.disconnect();
        }

        this.isConnected = false;
        this.isSpark2ConnectionActive = false;
        this.controlProfile.connected = false;
        this.auxiliaryProfile.connected = false;

        for (const waiter of this.pendingAckWaiters) {
            clearTimeout(waiter.timeoutHandle);
            waiter.resolve(false);
        }
        this.pendingAckWaiters = [];
        this.recentAcks = [];
    }

    public handleAndQueueMessageData(dataChunk: Uint8Array) {

        this.lastMsgReceivedTime = new Date();

        dataChunk = this.trimHeader(dataChunk);

        // look for f7
        let terminatorIndexes = [];
        for (let b = 0; b < dataChunk.byteLength; b++) {
            if (dataChunk[b] == 0xf7) {
                terminatorIndexes.push(b);
            }
        }

        if (terminatorIndexes.length == 0) {
            // no terminator, append all to remainder
            this.lastDataChunkRemainder = SparkMessageReader.mergeBytes(this.lastDataChunkRemainder, dataChunk);
        } else {

            let currentSliceStartIndex = 0;
            let currentTerminatorItemIdx = 0;

            for (let i of terminatorIndexes) {

                if (this.getTimeDeltaSinceLastMsg() > 100 && this.lastDataChunkRemainder.length > 0) {
                    this.log("Warning: outdated chunk remainder consumed");
                }
                // split item, push result and keep remainder
                let partial = dataChunk.slice(currentSliceStartIndex, i + 1);
                let merged = SparkMessageReader.mergeBytes(this.lastDataChunkRemainder, partial);

                this.receiveQueue.push(merged);
                this.notifyAckWaiters(merged);

                currentTerminatorItemIdx++;

                if (terminatorIndexes.length > currentTerminatorItemIdx) {
                    // if our next slice will be a full message there is no remainder to add
                    this.lastDataChunkRemainder = new Uint8Array();
                } else {
                    // preserve the remainder of the data chunk for prepending to our next message
                    this.lastDataChunkRemainder = dataChunk.slice(i + 1);
                }

                currentSliceStartIndex = i + 1;
            }
        }
    }

    private notifyAckWaiters(message: Uint8Array) {
        if (message.length < 6) {
            return;
        }

        const cmd = message[4];
        const subCmd = message[5];

        if (cmd !== 0x04 && cmd !== 0x05) {
            return;
        }

        const now = Date.now();
        this.recentAcks.push({ cmd, subCmd, at: now });
        this.recentAcks = this.recentAcks.filter(item => now - item.at < 5000);

        for (let i = this.pendingAckWaiters.length - 1; i >= 0; i--) {
            const waiter = this.pendingAckWaiters[i];
            if (waiter.subCmd === subCmd && waiter.cmd.includes(cmd)) {
                clearTimeout(waiter.timeoutHandle);
                waiter.resolve(true);
                this.pendingAckWaiters.splice(i, 1);
            }
        }
    }

    public waitForAck(cmd: number | number[], subCmd: number, timeoutMs: number = 3000): Promise<boolean> {
        const cmdList = Array.isArray(cmd) ? cmd : [cmd];

        const existingAckIndex = this.recentAcks.findIndex(ack => ack.subCmd === subCmd && cmdList.includes(ack.cmd));
        if (existingAckIndex >= 0) {
            this.recentAcks.splice(existingAckIndex, 1);
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const timeoutHandle = setTimeout(() => {
                const idx = this.pendingAckWaiters.findIndex(waiter => waiter.timeoutHandle === timeoutHandle);
                if (idx >= 0) {
                    this.pendingAckWaiters.splice(idx, 1);
                }
                resolve(false);
            }, timeoutMs);

            this.pendingAckWaiters.push({
                cmd: cmdList,
                subCmd,
                resolve,
                timeoutHandle
            });
        });
    }

    public isSpark2Connection(): boolean {
        return this.isSpark2ConnectionActive;
    }

    trimHeader(data: Uint8Array) {
        // Spark 40 multi-part messages have a 16 byte header we can discard
        if ((data[0] == 0x01) && (data[1] == 0xfe)) {
            data = data.subarray(16);
        }
        return data;
    }

    private async subscribeCharacteristic(characteristic: BluetoothRemoteGATTCharacteristic, label: SparkWriteRoute): Promise<boolean> {
        try {
            await characteristic.startNotifications();

            this.log(`> Notifications started for ${label}`);
            this.isReceiving = true;

            characteristic.addEventListener('characteristicvaluechanged', (event) => {
                const dataView: DataView = (<any>event.target).value;
                let dataChunk = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);

                if (event.timeStamp < this.lastTimeStamp) {
                    this.log(`[ERROR]: timestamp out of order`);
                }
                this.lastTimeStamp = event.timeStamp;

                this.log(`[RECV RAW BLE ${label}]: ${event.timeStamp} ${this.buf2hex(dataChunk)}`);

                this.handleAndQueueMessageData(dataChunk);

            });

            return true;
        } catch (err) {
            this.log(`> Failed to begin listening for ${label} hardware data changes`);
            return false;
        }
    }

    /*
     start receiving data for our target characteristic, storing in the receive queue
    */
    public async beginQueuedReceive(): Promise<boolean> {
        let started = false;

        if (this.controlProfile.changeCharacteristic) {
            started = await this.subscribeCharacteristic(this.controlProfile.changeCharacteristic, "control") || started;
        }

        if (this.auxiliaryProfile.changeCharacteristic && this.auxiliaryProfile.changeCharacteristic !== this.controlProfile.changeCharacteristic) {
            started = await this.subscribeCharacteristic(this.auxiliaryProfile.changeCharacteristic, "auxiliary") || started;
        }

        this.isReceiving = started;
        return started;
    }

    public isNotificationActive(): boolean {
        return this.isReceiving;
    }

    public readReceiveQueue(): Array<Uint8Array> {

        if (this.receiveQueue.length == 0) {
            return null;
        }

        // wait a minimum amount of time (e.g. 200ms) before returning our message queue
        if (this.getTimeDeltaSinceLastMsg() < this.minWaitTimeForMessageQueue) {
            return null;
        }

        let lastItem = this.receiveQueue[this.receiveQueue.length - 1];

        // only return our queue if the last item ends in an f7 terminator
        if (lastItem[lastItem.length - 1] == 0xf7) {
            const received = [...this.receiveQueue];
            this.receiveQueue = new Array<Uint8Array>();
            return received;
        } else {
            return null;
        }
    }

    public peekReceiveQueueEnd(): Uint8Array {

        // only return our queue end if the last item ends in an f7 terminator
        let lastItem = this.receiveQueue[this.receiveQueue.length - 1];
        if (lastItem && lastItem[lastItem.length - 1] == 0xf7) {
            return lastItem;
        } else {
            return null;
        }
    }

    isSendQueueProcessing = false;

    private splitAttWrites(buffer: Uint8Array, maxLen: number): Uint8Array[] {
        if (buffer.length <= maxLen) {
            return [buffer];
        }

        let parts: Uint8Array[] = [];
        for (let i = 0; i < buffer.length; i += maxLen) {
            parts.push(buffer.slice(i, i + maxLen));
        }

        return parts;
    }

    private getProfileForRoute(route: SparkWriteRoute): BleProfileState {
        if (route === "auxiliary" && this.auxiliaryProfile.commandCharacteristic) {
            return this.auxiliaryProfile;
        }

        return this.controlProfile;
    }

    private async writeChunkWithRetry(chunk: Uint8Array, profile: BleProfileState, route: SparkWriteRoute, traceId?: string): Promise<void> {
        let attempts = 5;
        while (attempts > 0) {
            try {
                attempts--;
                SparkDiagnostics.update(traceId, {
                    route,
                    transportProfile: this.isSpark2ConnectionActive ? "spark-2-ble" : "spark-ble",
                    serviceUuid: profile.serviceUuid,
                    writeCharacteristicUuid: profile.commandCharacteristicUuid,
                    notifyCharacteristicUuid: profile.changeCharacteristicUuid,
                    bytesLength: chunk.length
                });
                await profile.commandCharacteristic.writeValueWithoutResponse(chunk as unknown as BufferSource);
                return;
            } catch (err) {
                if (attempts > 0) {
                    this.log("Error writing command changes, retrying..");
                    await Utils.sleepAsync(25);
                } else {
                    this.log("Error writing command changes, giving up..");
                    throw err;
                }
            }
        }
    }

    public async write(msg: any, options: SerialWriteOptions = {}) {

        const route = options.route ?? "control";
        const profile = this.getProfileForRoute(route);
        if (!profile?.commandCharacteristic) {
            throw new Error(`No BLE ${route} command characteristic available.`);
        }

        // add this message to start of queue, queue will be processed end-first
        this.sendQueue.unshift({ msg, options });

        if (!this.isSendQueueProcessing) {
            while (this.sendQueue.length > 0) {
                this.isSendQueueProcessing = true;

                this.log(`Time since last command ${this.getTimeDeltaSinceLastCmd()}`);
                // todo: consider the type of command last sent to determine wait (presets take longer than fx param changes)
                while (this.getTimeDeltaSinceLastCmd() < this.minWaitTimeMSBetweenCommands) {
                    this.log("Pausing for messages to be received before sending next command ");
                    await Utils.sleepAsync(this.minWaitTimeMSBetweenCommands);
                }

                while (this.getTimeDeltaSinceLastMsg() < this.minWaitTimeForMessageQueue) {
                    this.log("Pausing [again] for messages to be received before sending next command ");
                    await Utils.sleepAsync(this.minWaitTimeForMessageQueue);
                }

                this.lastMsgSentTime = new Date();

                let current = this.sendQueue.pop();
                const currentRoute = current.options?.route ?? "control";
                const currentProfile = this.getProfileForRoute(currentRoute);

                const uint8Array = new Uint8Array(current.msg);

                this.log(`Writing command changes.. ${uint8Array.length} bytes route=${currentRoute} service=${currentProfile.serviceUuid}`);

                const chunks = this.isSpark2ConnectionActive ? this.splitAttWrites(uint8Array, 100) : [uint8Array];
                for (let i = 0; i < chunks.length; i++) {
                    await this.writeChunkWithRetry(chunks[i], currentProfile, currentRoute, current.options?.traceId);
                    if (chunks.length > 1 && i < chunks.length - 1) {
                        await Utils.sleepAsync(5);
                    }
                }
            }

            this.isSendQueueProcessing = false;
        }
    }

    public getTransportDiagnostics() {
        return {
            isConnected: this.isConnected,
            isReceiving: this.isReceiving,
            isSpark2ConnectionActive: this.isSpark2ConnectionActive,
            control: {
                serviceUuid: this.controlProfile.serviceUuid,
                commandCharacteristicUuid: this.controlProfile.commandCharacteristicUuid,
                changeCharacteristicUuid: this.controlProfile.changeCharacteristicUuid,
                connected: this.controlProfile.connected
            },
            auxiliary: {
                serviceUuid: this.auxiliaryProfile.serviceUuid,
                commandCharacteristicUuid: this.auxiliaryProfile.commandCharacteristicUuid,
                changeCharacteristicUuid: this.auxiliaryProfile.changeCharacteristicUuid,
                connected: this.auxiliaryProfile.connected
            }
        };
    }

    public async getGattInventory(): Promise<any> {
        if (!this.server?.connected) {
            return { connected: false, services: [] };
        }

        if (typeof (this.server as any).getPrimaryServices !== "function") {
            return { connected: true, services: [], note: "getPrimaryServices is not available in this Web Bluetooth runtime." };
        }

        const services = await (this.server as any).getPrimaryServices();
        const result = [];
        for (const service of services) {
            const characteristics = typeof service.getCharacteristics === "function"
                ? await service.getCharacteristics()
                : [];
            result.push({
                uuid: service.uuid,
                characteristics: characteristics.map(ch => ({
                    uuid: ch.uuid,
                    properties: {
                        broadcast: !!ch.properties?.broadcast,
                        read: !!ch.properties?.read,
                        writeWithoutResponse: !!ch.properties?.writeWithoutResponse,
                        write: !!ch.properties?.write,
                        notify: !!ch.properties?.notify,
                        indicate: !!ch.properties?.indicate
                    }
                }))
            });
        }

        return { connected: true, services: result };
    }
}
