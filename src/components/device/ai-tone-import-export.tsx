import React from "react";
import { FxMappingToneToSpark } from "../../core/fxMapping";
import {
  AiToneConfig,
  aiToneConfigToSparkPreset,
  hasBlockingValidationErrors,
  parseAiToneConfigJson,
  sparkPresetToAiToneConfig,
  ToneValidationIssue
} from "../../core/aiToneConfig";
import {
  buildAiToneProjectPrompt,
  buildAiToneReferenceBundle,
  buildAiToneReferenceFileName
} from "../../core/aiToneReference";
import { Tone } from "../../core/soundshedApi";
import { DeviceStateStore } from "../../stores/devicestate";
import { DeviceViewModelContext } from "../app";

const formatIssue = (issue: ToneValidationIssue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const downloadText = (filename: string, text: string, type: string = "text/plain") => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const downloadJson = (filename: string, data: unknown) => {
  downloadText(filename, `${JSON.stringify(data, null, 2)}\n`, "application/json");
};

const safeFileSlug = (name: string) => {
  return (name || "spark-tone")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "spark-tone";
};

const AiToneImportExport = ({ currentPreset }: { currentPreset: Tone }) => {
  const deviceViewModel = React.useContext(DeviceViewModelContext);
  const connectedDevice = DeviceStateStore.useState((s) => s.connectedDevice);
  const isConnected = DeviceStateStore.useState((s) => s.isConnected);
  const selectedChannel = DeviceStateStore.useState((s) => s.selectedChannel);
  const [issues, setIssues] = React.useState<ToneValidationIssue[]>([]);
  const [status, setStatus] = React.useState<string>("No AI tone config loaded.");
  const [pendingText, setPendingText] = React.useState<string>("");
  const [pasteText, setPasteText] = React.useState<string>("");
  const [pendingConfig, setPendingConfig] = React.useState<AiToneConfig | null>(null);
  const [isBusy, setIsBusy] = React.useState(false);

  const modelName = connectedDevice?.name ?? "spark-2";
  const hasErrors = issues.some(i => i.severity === "error");

  const validateText = (text: string, sourceLabel: string) => {
    const parsed = parseAiToneConfigJson(text, { modelId: modelName });
    setIssues(parsed.validation.issues);

    if (hasBlockingValidationErrors(parsed.validation) || !parsed.config) {
      setPendingText("");
      setPendingConfig(null);
      setStatus(`${sourceLabel} was rejected before any Bluetooth write.`);
      return false;
    }

    setPendingText(text);
    setPendingConfig(parsed.config);
    setStatus(`${sourceLabel} is valid. Review the preview, then apply it temporarily.`);
    return true;
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setIssues([]);
    setPendingText("");
    setPendingConfig(null);

    if (!file) {
      setStatus("No AI tone config loaded.");
      return;
    }

    const text = await file.text();
    setPasteText(text);
    validateText(text, `AI tone config '${file.name}'`);
  };

  const validatePastedTone = () => {
    setIssues([]);
    validateText(pasteText, "Pasted AI tone config");
  };

  const clearImport = () => {
    setIssues([]);
    setPendingText("");
    setPendingConfig(null);
    setPasteText("");
    setStatus("No AI tone config loaded.");
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

    setIsBusy(true);
    try {
      const preset = aiToneConfigToSparkPreset(parsed.config, { modelId: modelName });
      const applied = await deviceViewModel.requestPresetChange(preset);
      if (applied === false) {
        setStatus("Amp rejected the preset request.");
        return;
      }

      setStatus("Imported tone applied temporarily. Reading the amp back for GUI refresh...");
      await wait(2000);
      await deviceViewModel.requestPresetConfig();
      setStatus("Imported tone applied temporarily and refresh requested. Use Save to Amp to store it in a hardware slot.");
    } catch (err) {
      const validationIssues = (err as any)?.issues ?? [];
      if (validationIssues.length > 0) {
        setIssues(validationIssues);
      }
      setStatus(`AI tone config could not be converted/applied safely: ${(err as Error).message}`);
    } finally {
      setIsBusy(false);
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
      downloadJson(`${safeFileSlug(config.metadata.name)}.ai-tone.json`, config);
      setStatus("Current tone exported as AI-friendly 0–10 JSON config.");
    } catch (err) {
      setStatus(`Could not export current tone: ${(err as Error).message}`);
    }
  };

  const downloadReference = () => {
    const reference = buildAiToneReferenceBundle({ modelId: "spark-2" });
    downloadJson(buildAiToneReferenceFileName({ modelId: "spark-2" }), reference);
    setStatus("Downloaded Spark 2 AI tone reference JSON for ChatGPT.");
  };

  const downloadProjectPrompt = () => {
    const prompt = buildAiToneProjectPrompt({ modelId: "spark-2" });
    downloadText(prompt.filename, prompt.content + "\n", "text/markdown");
    setStatus("Downloaded Spark 2 ChatGPT project prompt.");
  };

  const downloadStarterConfig = () => {
    const reference = buildAiToneReferenceBundle({ modelId: "spark-2" });
    const starter = {
      schema: "soundshed.ai-tone.v1",
      targetDevice: "spark-2",
      metadata: {
        name: "Spark 2 Starter Tone",
        description: "Starter config generated by Soundshed. Edit this with ChatGPT using the Spark 2 reference file.",
        bpm: 120,
        guitar: "HSS Strat"
      },
      requirements: {
        expansions: []
      },
      slots: reference.slots.map(slot => {
        const effect = slot.effects[0];
        return {
          slot: slot.slot,
          dspId: effect?.dspId ?? "",
          enabled: slot.slot === "amp" || slot.slot === "gate" || slot.slot === "reverb",
          knobs: Object.fromEntries((effect?.knobs ?? []).map(knob => [knob.name, knob.default]))
        };
      })
    };

    downloadJson("spark-2-starter.ai-tone.json", starter);
    setStatus("Downloaded a starter AI tone config template.");
  };

  const renderPreview = () => {
    if (!pendingConfig) {
      return null;
    }

    return (
      <div className="info" style={{ width: "100%" }}>
        <strong>{pendingConfig.metadata.name}</strong>
        {pendingConfig.metadata.description ? <p style={{ marginBottom: "0.5rem" }}>{pendingConfig.metadata.description}</p> : null}
        <div className="tone-list" style={{ marginTop: "0.5rem" }}>
          {pendingConfig.slots.map((slot, index) => (
            <div key={`${slot.slot}-${index}`} className="tone-row" style={{ alignItems: "flex-start" }}>
              <div className="tone-info">
                <span className="tone-name">{index + 1}. {slot.slot}: {slot.dspId}</span>
                <span className="tone-desc">{slot.enabled ? "Enabled" : "Bypassed"}</span>
              </div>
              <div className="tone-tags">
                {Object.entries(slot.knobs).map(([name, value]) => (
                  <span key={name} className="tone-tag tone-tag--secondary">{name}: {value}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
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
          disabled={!pendingText || hasErrors || isBusy}
          onClick={applyPendingTone}
        >
          {isBusy ? "Applying..." : "Apply Imported Tone"}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={exportCurrentTone}>
          Export Current Tone JSON
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={downloadReference}>
          Download Spark 2 Reference
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={downloadProjectPrompt}>
          Download ChatGPT Prompt
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={downloadStarterConfig}>
          Starter JSON
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={clearImport}>
          Clear
        </button>
      </div>

      <details style={{ width: "100%" }}>
        <summary>Paste AI tone JSON instead of importing a file</summary>
        <textarea
          className="form-control"
          rows={8}
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder="Paste soundshed.ai-tone.v1 JSON here. The app validates before any Bluetooth write."
          style={{ width: "100%", marginTop: "0.5rem" }}
        />
        <button type="button" className="btn btn-sm btn-secondary" onClick={validatePastedTone} style={{ marginTop: "0.5rem" }}>
          Validate Pasted JSON
        </button>
      </details>

      <div className="control-strip-label" aria-live="polite">
        {status} {selectedChannel >= 0 ? `Selected hardware slot: ${selectedChannel + 1}.` : "No hardware slot selected."}
      </div>

      {issues.length > 0 && (
        <div className={hasErrors ? "alert alert-danger" : "alert alert-warning"} style={{ margin: 0, width: "100%" }}>
          <strong>{hasErrors ? "Validation failed" : "Validation warnings"}</strong>
          <ul style={{ marginBottom: 0 }}>
            {issues.map((item, idx) => <li key={`${item.code}-${idx}`}>{formatIssue(item)}</li>)}
          </ul>
        </div>
      )}

      {renderPreview()}
    </div>
  );
};

export default AiToneImportExport;
