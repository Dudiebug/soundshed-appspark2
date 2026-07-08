# Spark 2 Apply Pipeline and Protocol Explorer Plan

## Current state

Known runtime state from Bazzite testing:

- App builds and launches.
- Spark 2 is discoverable/selectable over Bluetooth.
- Reading current amp state works.
- Switching between already-saved hardware presets works.
- Applying new settings does not work reliably.

This means the basic BLE connection, saved-preset switch path, notification receive loop, and parser are not the primary problem. The likely problem is command routing, value encoding, Spark 2 BLE service routing, preset-upload transaction handling, and lack of readback verification.

## Key concept: the amp probably cannot explain itself

There is probably no Spark command that returns a full semantic API like:

> command 0x03/0x37 means amp parameter write

BLE can reveal GATT services, characteristics, and their properties, but it does not describe proprietary Spark command semantics.

So the correct diagnostic feature is not “ask the amp what every function does.” It is a safe protocol explorer that:

1. enumerates services and characteristics;
2. sends known harmless GET commands;
3. sends tightly controlled reversible probes;
4. compares readback before and after;
5. records ACKs, responses, timeouts, and service/characteristic routing;
6. builds a practical command/function map from observed behavior.

## Workstream 1 — Live settings reliability

### Fix decimal knob value encoding

The UI controls send values in the Spark internal `0.0`–`1.0` range. Do not use `parseInt` for parameter values. Use `parseFloat`, validate finite number, and clamp to `0.0`–`1.0`.

Expected behavior:

- `"0.72"` sends `0.72`, not `0`.
- `"0.35"` sends `0.35`, not `0`.
- `"1.00"` sends `1.0`.
- invalid values are rejected and surfaced as diagnostics.

### Guard missing state

For live changes, fail safely and visibly when:

- current tone is missing;
- the target effect is missing;
- the target parameter is missing;
- the value is not finite;
- the DSP ID is blocked/removed/expansion-only.

### Add readback-after-change debug mode

For every live setting mutation in debug mode:

1. read current preset before change;
2. send one command;
3. wait 300–500 ms;
4. request current preset/readback;
5. compare intended value vs readback value;
6. report pass/fail in diagnostics.

## Workstream 2 — Amp parameter command routing

Spark protocol distinguishes amp parameters from normal effect parameters:

- effect knob: command `01`, sub-command `04`;
- amp knob: command `03`, sub-command `37`.

Add renderer/device routing so the amp slot uses `set_amp_param`, not `set_fx_param`.

Expected implementation path:

1. Identify slot/effect type before routing parameter updates.
2. If the changed slot is `amp`, call action `setAmpParam`.
3. `DeviceContext` maps `setAmpParam` to `sendCommandSafe("set_amp_param", args)`.
4. Non-amp effects keep using `set_fx_param`.

## Workstream 3 — Effect toggle/swap commands

Effect toggle and swap already have command builders, but need diagnostics and readback verification.

Expected implementation:

- toggle effect: command `01`, sub-command `15`;
- swap non-amp effect: command `01`, sub-command `06`;
- swap amp model: command `03`, sub-command `06`.

Every toggle/swap should record:

- DSP old/new;
- outgoing command/sub-command;
- service/characteristic used;
- ACK status;
- readback before/after;
- whether the UI state matched amp state after refresh.

## Workstream 4 — Spark 2 BLE service routing

Spark 2 exposes the classic service and a secondary service. The current implementation should be changed to hold both service profiles when possible.

Target model:

```text
Primary/control:
  service ffc0
  write   ffc1
  notify  ffc2

Secondary/auxiliary:
  service ffc8
  write   ffc9
  notify  ffca
```

Expected routing:

- full preset upload -> primary `ffc1`;
- hardware/virtual preset switch -> primary `ffc1`;
- live effect knob -> primary `ffc1`;
- live amp knob -> primary `ffc1`;
- toggle/swap -> primary `ffc1`;
- live sync request -> secondary only if verified, otherwise log fallback;
- ACK handling listens to both notification streams.

Implementation requirements:

- `BleProvider` should store named characteristics instead of one generic command/change pair.
- Write calls should declare intent/profile, e.g. `write(msg, { route: "control" })`.
- Live-sync should declare `route: "auxiliary"` if that route exists.
- Diagnostics must record the UUIDs used for every write and notification.

## Workstream 5 — Verified full preset apply transaction

Turn apply into a real transaction, not a best-effort sequence.

Target sequence:

1. validate preset;
2. start apply transaction;
3. upload chunk `0`;
4. wait for Spark 2 chunk ACK;
5. repeat for remaining chunks;
6. wait for final ACK;
7. wait about 500 ms;
8. switch to virtual slot `0x7f`;
9. wait for switch ACK;
10. request live sync;
11. request current preset;
12. compare readback to requested preset;
13. surface success/failure.

UI should show progress:

- validating;
- uploading chunk N/M;
- waiting for final ACK;
- switching virtual slot;
- requesting live sync;
- reading back;
- applied / failed.

## Workstream 6 — Diagnostics export

Add an in-memory command trace ring buffer. Each entry should include:

```ts
{
  id,
  action,
  commandType,
  commandByte,
  subCommandByte,
  dspId,
  paramIndex,
  value,
  transportProfile,
  serviceUuid,
  writeCharacteristicUuid,
  notifyCharacteristicUuid,
  bytesLength,
  startedAt,
  completedAt,
  ackExpected,
  ackReceived,
  responseReceived,
  readbackCompared,
  readbackMatched,
  error
}
```

Expose this via:

- console diagnostics during development;
- a UI button: `Export Spark Diagnostics JSON`;
- optional future CLI export.

## Workstream 7 — Protocol Explorer / “ask the amp” mode

Add a controlled diagnostic mode named `Spark Protocol Explorer`.

### What it can safely discover

- device name;
- serial number;
- current selected channel;
- current preset state;
- GATT services and characteristics;
- which known commands produce ACKs;
- which known commands cause a measurable readback change;
- which service/characteristic accepts control writes;
- whether Spark 2 live sync responds on primary or secondary notifications.

### What it cannot directly discover

It cannot ask the amp to explain semantic meanings like:

- “sub-command `0x37` means amp parameter”;
- “this DSP ID is a delay”;
- “this parameter index is Treble.”

Those meanings must be inferred from the app catalog, protocol notes, and controlled readback probes.

### Safe probe matrix

#### 1. GATT inventory

- list primary services;
- list characteristics under `ffc0` and `ffc8`;
- record notify/write properties;
- do not mutate amp state.

#### 2. Known GET commands

- get current preset;
- get selected channel;
- get device name;
- get serial number.

#### 3. Readback no-op probes

- write current value back to one non-amp parameter;
- write current value back to one amp parameter;
- send current toggle state again if known.

#### 4. Controlled mutation probes

- change a harmless parameter by `+0.01`, read back, then restore original value;
- toggle an effect, read back, then restore original toggle state;
- never store hardware slots during default probe mode.

#### 5. Full preset apply probe

- copy current preset to temporary virtual slot `0x7f`;
- read back;
- compare;
- do not write slots 1–8 unless user enables destructive tests.

### Safety requirements

- Protocol explorer requires explicit user confirmation before any mutation.
- It saves a pre-probe snapshot.
- It restores changed values when possible.
- It never probes unknown/random command bytes by default.
- It never stores to hardware preset slots unless destructive tests are explicitly enabled.
- It exports every observation to JSON.

## Test plan

Add simulator/unit tests for:

- string knob value `"0.72"` remains `0.72`;
- amp slot parameter uses command `03`, sub-command `37`;
- non-amp FX parameter uses command `01`, sub-command `04`;
- toggle uses command `01`, sub-command `15`;
- Spark 2 upload waits for chunk ACKs;
- apply transaction fails when ACK times out;
- readback mismatch is reported as failure;
- diagnostics export includes action, service UUID, characteristic UUID, ACK status, and readback status.

## Hardware verification checklist

On Bazzite + Spark 2:

1. connect to Spark 2;
2. read current preset;
3. switch saved presets 1–8;
4. change a delay knob and verify readback;
5. change an amp gain/treble knob and verify readback;
6. toggle an effect and verify readback;
7. swap one non-amp effect and verify readback;
8. apply an AI/imported preset to virtual `0x7f` and verify readback;
9. save only after virtual apply is verified;
10. export diagnostics JSON.

## Recommended implementation order

1. Fix decimal knob parsing and amp parameter routing.
2. Add command diagnostics and readback-after-change debug mode.
3. Add Protocol Explorer GATT + GET-only inventory.
4. Refactor Spark 2 BLE service routing.
5. Convert full preset apply to a verified transaction.
6. Add mutation probes and diagnostics export UI.
