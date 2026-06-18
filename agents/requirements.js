/**
 * agents/requirements.js
 * Requirements Agent — extracts structured PCB design requirements
 * from uploaded documents, chat context, and schematic scan data.
 */

import { callOpenAIJson, buildDocBlock, fmtComponents, fmtNets } from "./base.js";

const SYSTEM = `You are a senior electronics systems engineer specializing in embedded PCB design.
Analyze all provided project information and produce structured design requirements.

Return JSON ONLY (no markdown, no fences):
{
  "project_summary": string,
  "power": {
    "input_voltage": string,
    "rails": [{ "name": string, "voltage": string, "max_current_ma": number }]
  },
  "interfaces": [{ "type": string, "description": string }],
  "key_ics": [{ "role": string, "suggested_part": string, "reason": string }],
  "constraints": [string],
  "open_questions": [string],
  "complexity": "simple" | "medium" | "complex"
}

Be specific. Include voltages, currents, and part suggestions where inferable.`;

export class RequirementsAgent {
  get id()    { return "requirements"; }
  get label() { return "Requirements Analysis"; }
  get icon()  { return "📋"; }

  async execute(ctx, apiKey) {
    let user = "Extract PCB design requirements from the information below.";

    const docs = buildDocBlock(ctx.referenceFiles);
    if (docs) user += `\n\n=== Uploaded Documents ===\n${docs}`;

    if (ctx.schematicData?.detected) {
      user +=
        `\n\n=== Live Schematic Scan ===` +
        `\nSource: ${ctx.schematicData.source}` +
        `\nComponents: ${fmtComponents(ctx.schematicData.components)}` +
        `\nNets/Symbols: ${fmtNets(ctx.schematicData.nets)}`;
    }

    const data = await callOpenAIJson(apiKey, SYSTEM, user);
    return { id: this.id, label: this.label, icon: this.icon, data };
  }
}
