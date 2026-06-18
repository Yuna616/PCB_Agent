/**
 * agents/component.js
 * Component Agent — recommends specific parts with LCSC numbers
 * based on design requirements and schematic context.
 */

import { callOpenAIJson, buildDocBlock, fmtComponents } from "./base.js";

const SYSTEM = `You are an expert PCB component engineer with deep LCSC/JLCPCB inventory knowledge.
Select the best components for the given design requirements.

Return JSON ONLY:
{
  "mcu": {
    "part": string, "package": string, "lcsc": string,
    "reason": string, "jlcpcb_basic": boolean
  },
  "power_ics": [{
    "role": string, "part": string, "package": string, "lcsc": string,
    "vin": string, "vout": string, "max_current": string,
    "reason": string, "jlcpcb_basic": boolean
  }],
  "interface_ics": [{
    "role": string, "part": string, "package": string, "lcsc": string, "reason": string
  }],
  "passives": [{
    "ref": string, "type": string, "value": string,
    "package": string, "lcsc": string, "purpose": string
  }],
  "protection": [{
    "type": string, "part": string, "lcsc": string, "where": string
  }],
  "decoupling_rules": [string],
  "estimated_cost_usd": string,
  "bom_notes": string
}

Use real LCSC part numbers (C-prefix). Prefer JLCPCB basic parts. All SMD packages.`;

export class ComponentAgent {
  get id()    { return "component"; }
  get label() { return "Component Selection"; }
  get icon()  { return "🔌"; }

  async execute(ctx, apiKey) {
    let user = "Select optimal components for this PCB design.";

    if (ctx.requirementsResult?.data) {
      user += `\n\n=== Design Requirements ===\n${JSON.stringify(ctx.requirementsResult.data, null, 2)}`;
    }
    if (ctx.schematicData?.detected) {
      user += `\n\n=== Already-Placed Components ===\n${fmtComponents(ctx.schematicData.components)}`;
    }

    const docs = buildDocBlock(ctx.referenceFiles, 15000);
    if (docs) user += `\n\n=== Project Documents ===\n${docs}`;

    const data = await callOpenAIJson(apiKey, SYSTEM, user);
    return { id: this.id, label: this.label, icon: this.icon, data };
  }
}
