/**
 * agents/erc.js
 * ERC Agent — Electrical Rule Check specialist.
 * Detects violations and returns categorized issues with Korean-language fixes.
 */

import { callOpenAIJson, buildDocBlock, fmtComponents, fmtNets } from "./base.js";

const SYSTEM = `You are a PCB ERC (Electrical Rule Check) specialist.
Analyze the provided circuit data and identify all electrical rule violations.

Return JSON ONLY:
{
  "pass": boolean,
  "summary": string,
  "errors": [{
    "id": string,
    "severity": "error" | "warning" | "info",
    "category": "decoupling" | "floating_pin" | "ground" | "protection" | "pull_resistor" | "net" | "power_symbol" | "reset" | "crystal" | "other",
    "component": string,
    "message": string,
    "fix": string
  }]
}

Check in priority order:
1. Floating pins — unconnected input/output without NC symbol → error
2. Missing decoupling — IC VCC pin without 100nF + 10µF → error
3. GND missing — ground pin not connected to GND symbol → error
4. Reverse-polarity — power input without P-MOSFET or Schottky diode → warning
5. ESD protection — USB/CAN/external connector pin without TVS diode → warning
6. Pull resistors — I2C SDA/SCL, RST, BOOT without pull-up/down → warning
7. Crystal load caps — crystal symbol without matched load capacitors → warning
8. Power symbols — missing VCC_3V3/VCC_5V labels → info
9. Reset circuit — MCU RST pin without RC debounce → info

Infer from component names and documents when schematic data is incomplete.
Write summary, message, and fix fields in Korean.`;

export class ERCAgent {
  get id()    { return "erc"; }
  get label() { return "ERC Check"; }
  get icon()  { return "🔍"; }

  async execute(ctx, apiKey) {
    let user;

    if (ctx.schematicData?.detected) {
      user =
        `Schematic scan:\n` +
        `Source: ${ctx.schematicData.source}\n` +
        `Components: ${fmtComponents(ctx.schematicData.components)}\n` +
        `Nets/Symbols: ${fmtNets(ctx.schematicData.nets, 30)}\n\n` +
        `Run full ERC on this circuit.`;
    } else if (ctx.requirementsResult?.data) {
      user =
        `No live schematic. Run ERC based on design requirements:\n` +
        JSON.stringify(ctx.requirementsResult.data, null, 2);
    } else {
      user = "No schematic or requirements data. Report unavailability and list common ERC issues to check manually.";
    }

    const docs = buildDocBlock(ctx.referenceFiles, 15000);
    if (docs) user += `\n\n=== Reference Documents ===\n${docs}`;

    const raw = await callOpenAIJson(apiKey, SYSTEM, user);
    if (!Array.isArray(raw.errors)) raw.errors = [];
    raw.pass = raw.errors.filter((e) => e.severity === "error").length === 0;

    return { id: this.id, label: this.label, icon: this.icon, data: raw };
  }
}
