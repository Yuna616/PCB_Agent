/**
 * agents/layout.js
 * Layout Agent — concrete PCB placement, routing, and manufacturing guidance.
 * Runs after Requirements, Component, and ERC agents to incorporate their outputs.
 */

import { callOpenAIJson } from "./base.js";

const SYSTEM = `You are an expert PCB layout engineer with manufacturing-first mindset.
Produce actionable PCB layout guidance tailored to the given design.

Return JSON ONLY:
{
  "layer_stackup": {
    "layers": number,
    "description": string,
    "rationale": string
  },
  "placement_sequence": [{
    "step": number,
    "group": string,
    "components": string,
    "tip": string
  }],
  "trace_widths": [{
    "net_class": string,
    "min_mm": string,
    "recommended_mm": string,
    "reason": string
  }],
  "critical_routes": [{
    "signal": string,
    "rule": string,
    "why": string
  }],
  "ground_strategy": string,
  "thermal_notes": [string],
  "emi_notes": [string],
  "dfm_checklist": [{
    "check": string,
    "spec": string
  }]
}`;

export class LayoutAgent {
  get id()    { return "layout"; }
  get label() { return "PCB Layout"; }
  get icon()  { return "🏗️"; }

  async execute(ctx, apiKey) {
    let user = "Provide detailed PCB layout guidance for this design.";

    if (ctx.requirementsResult?.data) {
      user += `\n\n=== Requirements ===\n${JSON.stringify(ctx.requirementsResult.data, null, 2)}`;
    }
    if (ctx.componentResult?.data) {
      user += `\n\n=== Selected Components ===\n${JSON.stringify(ctx.componentResult.data, null, 2)}`;
    }
    if (ctx.ercResult?.data?.errors?.length) {
      const issues = ctx.ercResult.data.errors
        .map((e) => `[${e.severity}] ${e.component}: ${e.message}`)
        .join("\n");
      user += `\n\n=== ERC Issues (inform layout decisions) ===\n${issues}`;
    }

    const data = await callOpenAIJson(apiKey, SYSTEM, user);
    return { id: this.id, label: this.label, icon: this.icon, data };
  }
}
