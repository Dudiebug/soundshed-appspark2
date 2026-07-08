import {
    buildAiToneProjectPrompt,
    buildAiToneReferenceBundle,
    buildAiToneReferenceFileName
} from "../src/core/aiToneReference";
import { AI_TONE_SLOT_ORDER } from "../src/core/aiToneConfig";

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

const reference = buildAiToneReferenceBundle({ modelId: "spark-2" });
assert(reference.generatedFor === "spark-2", "Reference must be generated for Spark 2.");
assert(reference.slots.length === AI_TONE_SLOT_ORDER.length, "Reference must contain every required slot.");
assert(reference.slotOrder.join(",") === AI_TONE_SLOT_ORDER.join(","), "Reference slot order must match AI tone schema slot order.");

for (const slot of AI_TONE_SLOT_ORDER) {
    const slotReference = reference.slots.find(item => item.slot === slot);
    assert(slotReference != null, `Missing reference slot ${slot}.`);
    assert(slotReference!.effects.length > 0, `Reference slot ${slot} must expose at least one safe effect.`);
}

const allEffects = reference.slots.flatMap(slot => slot.effects);
assert(allEffects.every(effect => effect.blocked !== true), "Default reference must not include blocked effects.");
assert(allEffects.some(effect => effect.dspId === "RolandJC120"), "Reference should include a safe stock amp.");
assert(!allEffects.some(effect => effect.dspId.startsWith("JH.")), "Default reference must exclude Jimi Hendrix expansion DSP IDs.");

const prompt = buildAiToneProjectPrompt({ modelId: "spark-2" });
assert(prompt.filename.endsWith(".md"), "Prompt filename must be markdown.");
assert(prompt.content.includes("Do not generate raw Bluetooth bytes"), "Prompt must preserve the raw-byte safety boundary.");
assert(prompt.content.includes(buildAiToneReferenceFileName({ modelId: "spark-2" })), "Prompt must refer to the generated reference file.");

console.log("AI tone reference smoke tests passed.");
