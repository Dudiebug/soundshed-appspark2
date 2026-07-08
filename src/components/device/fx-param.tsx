import React from "react";

import { clampUnitValue, parseParamIndex } from "../../core/sparkDiagnostics";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "webaudio-knob": any;
      "webaudio-switch": any;
    }
  }
}

const FxParam = ({ type = "knob", p, fx, onFxParamChange }) => {
  let customElement;

  const setParamValue = (e) => {
    let value = e.target.value;
    let index = e.target.tag.paramId;

    try {
      if (type === "knob") {
        value = clampUnitValue(value);
      }
      index = parseParamIndex(index);
    } catch (err) {
      console.warn("Ignoring invalid FX parameter change", err);
      return;
    }

    onFxParamChange({
      dspId: fx.type,
      index,
      value,
      type,
    });
  };

  React.useEffect(() => {
    customElement?.addEventListener("change", setParamValue);

    return () => {
      customElement?.removeEventListener("change", setParamValue);
    };
  }, []);

  React.useEffect(() => {
    var newVal = p.value ?? null;
    if (newVal != null) {
      newVal = newVal.toFixed(2);
    }
    if (customElement.value != newVal && newVal != null) {
      // an external input has changed a control value
      customElement?.setValue(newVal);
    }
  }, [fx, p]);

  return (
    <div key={p.paramId?.toString() ?? p.toString()}>
      {type == "knob" ? (
        <div>
          <webaudio-knob
            ref={(elem) => {
              customElement = elem;
              if (customElement) customElement.tag = p;
            }}
            src="./lib/webaudio-controls/knobs/LittlePhatty.png"
            min="0"
            value={p.value}
            max="1"
            step="0.01"
            diameter="64"
            tooltip={p.name + " %s"}
            aria-label={p.name}
            role="slider"
            aria-valuemin="0"
            aria-valuemax="1"
            aria-valuenow={p.value}
          ></webaudio-knob>
          <label>{p.name}</label>
        </div>
      ) : (
        <div>
          <webaudio-switch
            ref={(elem) => {
              customElement = elem;
              if (customElement) customElement.tag = p;
            }}
            src="./lib/webaudio-controls/knobs/switch_toggle.png"
            value={fx.enabled == true ? "1" : "0"}
            aria-label={`${fx.name} enabled`}
            role="switch"
            aria-checked={fx.enabled == true}
          ></webaudio-switch>
        </div>
      )}
    </div>
  );
};

export default FxParam;
