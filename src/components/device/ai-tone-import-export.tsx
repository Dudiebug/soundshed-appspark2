import React from "react";
import { FxMappingToneToSpark } from "../../core/fxMapping";
import {
  aiToneConfigToSparkPreset,
  hasBlockingValidationErrors,
  parseAiToneConfigJson,
  sparkPresetToAiToneConfig,
  ToneValidationIssue
} from "../../core/aiToneConfig";
import { Tone } from "../../core/soundshedApi";
import { DeviceStateStore } from "../../stores/devicestate";
import { DeviceViewModelContext } from "../app";

const formatIssue = (issue: ToneValidationIssue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`;

const downloadJson = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const AiToneImportExport = ({ currentPreset }: { currentPreset: Tone }) => {
  const deviceViewModel = React.useContext(DeviceViewModelContext);
  const connectedDevice = DeviceStateStore.useState((s) => s.connectedDevice);
  const isConnected = DeviceStateStore.useState((s) => s.isConnected);
  const [issues, setIssues] = React.useState<ToneValidationIssue[]>([]);
  const [status, setStatus] = React.useState<string>("No AI tone config loaded.");
  const [pendingText, setPendingText] = React.useState<string>("");

  const modelName = connectedDevice?.name ?? "spark-2";

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setIssues([]);
    setPendingText("");

    if (!file) {
      setStatus("No AI tone config loaded.");
      return;
    }

    const text = await file.text();
    const parsed = parseAiToneConfigJson(text, { modelId: modelName });
    setIssues(parsed.validation.issues);

    if (hasBlockingValidationErrors(parsed.validation)) {
      setStatus("AI tone config was rejected before any Bluetooth write.");
      return;
    }

    setPendingText(text);
    setStatus(`Loaded valid AI tone config: ${file.name}. Review it, then apply temporarily.`);
  };

  const applyPendingTone = async () => {
    const parsed = parseAiToneConfigJson(pendingText, { modelId: modelName });
    setIssues(parsed.validation.issues);

    if (!parsed.config || hasBlockingValidationErrors(parsed.validation)) {
      setStatus("AI tone config was rejected before any Bluetooth write.");
      return;
    }

    if (!isConnected) {
      setStatus("Connect to the amp before applying an imported tone.");
      return;
    }

    try {
      const preset = aiToneConfigToSparkPreset(parsed.config, { modelId: modelName });
      const applied = await deviceViewModel.requestPresetChange(preset);
      setStatus(applied === false ? "Amp rejected the preset request." : "Imported tone applied temporarily. Use Save to Amp to store it in a hardware slot.");
    } catch (err) {
      const validationIssues = (err as any)?.issues ?? [];
      if (validationIssues.length > 0) {
        setIssues(validationIssues);
      }
      setStatus("AI tone config could not be converted to a safe Spark preset.");
    }
  };

  const exportCurrentTone = () => {
    if (!currentPreset || !currentPreset.fx) {
      setStatus("No current tone is loaded to export.");
      return;
    }

    try {
      const sparkPreset = new FxMappingToneToSpark().mapFrom(currentPreset);
      const config = sparkPresetToAiToneConfig(sparkPreset, { modelId: modelName });
      const safeName = (config.metadata.name || "spark-tone").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
      downloadJson(`${safeName || "spark-tone"}.ai-tone.json`, config);
      setStatus("Current tone exported as AI-friendly 0–10 JSON config.");
    } catch (err) {
      setStatus(`Could not export current tone: ${(err as Error).message}`);
    }
  };

  return (
    <div className="control-strip" style={{ alignItems: "flex-start", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <label className="btn btn-sm btn-secondary" htmlFor="ai-tone-import-file" style={{ margin: 0 }}>
          Import AI Tone JSON
        </label>
        <input
          id="ai-tone-import-file"
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!pendingText || issues.some(i => i.severity === "error")}
          onClick={applyPendingTone}
        >
          Apply Imported Tone
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={exportCurrentTone}
        >
          Export Current Tone JSON
        </button>
      </div>
      <div className="control-strip-label" aria-live="polite">{status}</div>
      {issues.length > 0 && (
        <div className={issues.some(i => i.severity === "error") ? "alert alert-danger" : "alert alert-warning"} style={{ margin: 0, width: "100%" }}>
          <strong>{issues.some(i => i.severity === "error") ? "Validation failed" : "Validation warnings"}</strong>
          <ul style={{ marginBottom: 0 }}>
            {issues.map((item, idx) => <li key={`${item.code}-${idx}`}>{formatIssue(item)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AiToneImportExport;
