import fs from "fs";
import path from "path";
import {
    buildAiToneProjectPrompt,
    buildAiToneReferenceBundle,
    buildAiToneReferenceFileName
} from "../src/core/aiToneReference";

const outDir = path.resolve(process.cwd(), "docs", "generated");
fs.mkdirSync(outDir, { recursive: true });

const reference = buildAiToneReferenceBundle({ modelId: "spark-2" });
const referenceFilename = buildAiToneReferenceFileName({ modelId: "spark-2" });
const referencePath = path.join(outDir, referenceFilename);
fs.writeFileSync(referencePath, `${JSON.stringify(reference, null, 2)}\n`, "utf8");

const prompt = buildAiToneProjectPrompt({ modelId: "spark-2" });
const promptPath = path.join(outDir, prompt.filename);
fs.writeFileSync(promptPath, `${prompt.content}\n`, "utf8");

console.log(`Wrote ${path.relative(process.cwd(), referencePath)}`);
console.log(`Wrote ${path.relative(process.cwd(), promptPath)}`);
