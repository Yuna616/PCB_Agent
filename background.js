/**
 * background.js  —  PCB Agent service worker (Chrome MV3, ES module)
 *
 * Operations dispatched via chrome.runtime.sendMessage:
 *   ping             → check API key presence
 *   analyze_documents→ extract structured doc summary (single-shot)
 *   chat             → standard chat completion
 *   run_drc          → ERC check via ERCAgent
 *   multi_agent      → full Orchestrator pipeline
 */

import { callOpenAIJson, callOpenAIChat, parseJsonSafe, sleep, truncate } from "./agents/base.js";
import { Orchestrator } from "./agents/orchestrator.js";
import { ERCAgent }     from "./agents/erc.js";

// ── Singletons ────────────────────────────────────────────────────────────────
const orchestrator = new Orchestrator();
const ercAgent     = new ERCAgent();

// ── API key storage ───────────────────────────────────────────────────────────

function loadApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["openai_api_key"], (loc) => {
      const fromLocal = loc.openai_api_key && String(loc.openai_api_key).trim();
      if (fromLocal) return resolve(fromLocal);
      chrome.storage.sync.get(["openai_api_key"], (sync) => {
        resolve((sync.openai_api_key && String(sync.openai_api_key).trim()) || "");
      });
    });
  });
}

// ── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_ANALYZE_DOCS = `You are an expert PCB design analyst.
Read the provided project documents and extract key design information.
Return JSON ONLY (no markdown fences):
{
  "summary_ko": string,
  "key_requirements_ko": string[],
  "constraints_ko": string[],
  "open_questions_ko": string[],
  "power_requirements_ko": string[],
  "communication_interfaces_ko": string[],
  "recommended_components_ko": string[],
  "pcb_design_considerations_ko": string[]
}
Write all values in Korean.`;

const SYSTEM_CHAT = `You are a PCB design expert coach. You guide users through schematic design and PCB layout
in EasyEDA, from initial schematic through to Gerber generation. Always respond in Korean.

When "Project Context" JSON is attached, use it as the grounding source for advice.
Never show the raw JSON to the user — translate it into clear, actionable Korean guidance.

## PCB Design Knowledge

### Schematic
- Block separation: Power | MCU | Communication | Sensors
- Net naming: VCC_3V3, GND, AGND, CAN_H, SPI_MOSI …
- Bypass caps: every IC VCC pin → 100nF + 10µF
- Protection: reverse-polarity P-MOSFET, ESD TVS, polyfuse

### PCB Layout
- Placement order: connectors → power ICs → MCU → passives
- Trace widths: signal 0.3mm, 1A→0.5mm, 2A→1mm
- Differential pairs: same length ±0.1mm
- Ground plane full-board copper pour
- Thermal vias under power devices

### Part Selection
- LDO <800mA: AMS1117; Buck >2A: MP2315 / LM2596
- CAN: TJA1051T; USB-UART: CP2102 / CH340G
- MCU: ESP32-WROOM-32 (WiFi/BLE), STM32F103 (general), RP2040

Provide actionable steps, specific values (Ω, nF, mm), and EasyEDA-specific instructions.
Ask clarifying questions when the user's request is ambiguous.`;

// ── Reference file helpers ────────────────────────────────────────────────────

const MAX_REF_CHARS = 80000;

function normalizeRefs(refs) {
  if (Array.isArray(refs)) return refs;
  if (refs && typeof refs === "object" && typeof refs.text === "string") return [refs];
  return [];
}

function hasRefMaterial(refs) {
  return normalizeRefs(refs).some((r) => r && String(r.text || "").trim());
}

function buildRefBlock(baseMsg, refs) {
  const list = normalizeRefs(refs);
  const chunks = [];
  for (const item of list) {
    if (!item || !String(item.text || "").trim()) continue;
    const name = String(item.name || "File").trim();
    chunks.push(`--- File: ${name} ---\n${item.text.trim()}`);
  }
  if (!chunks.length) return baseMsg;
  const body = truncate(chunks.join("\n\n"), MAX_REF_CHARS);
  return `${baseMsg}\n\n=== Uploaded Reference Files ===\n${body}\n=== End of Files ===`;
}

function fmtProjectContext(pc) {
  if (!pc || typeof pc !== "object") return "";
  const parts = [];
  if (pc.documentAnalysis) {
    parts.push(`[Document Analysis]\n${JSON.stringify(pc.documentAnalysis, null, 2)}`);
  }
  if (pc.schematicScan?.detected) {
    const s = pc.schematicScan;
    const comps = (s.components || []).map((c) => `${c.ref || c.id}(${c.name || c.type})`).join(", ") || "none";
    const nets  = (s.nets || []).map((n) => n.name || n.type).filter(Boolean).slice(0, 20).join(", ") || "none";
    parts.push(`[Schematic Scan]\nSource: ${s.source}\nComponents: ${comps}\nNets: ${nets}`);
  }
  return parts.join("\n\n");
}

// ── Operation handlers ────────────────────────────────────────────────────────

async function handleMessage(msg, apiKey) {
  const refs = normalizeRefs(msg.referenceFiles ?? msg.referenceContext);
  const op   = msg.op;

  // ── analyze_documents ──────────────────────────────────────────────────────
  if (op === "analyze_documents") {
    if (!hasRefMaterial(refs)) throw new Error("Please upload project files first.");
    const userMsg = buildRefBlock(
      "Analyze the uploaded project documents and return the required JSON.",
      refs
    );
    const raw = await callOpenAIJson(apiKey, SYSTEM_ANALYZE_DOCS, userMsg);
    if (typeof raw.summary_ko !== "string")          raw.summary_ko          = "";
    if (!Array.isArray(raw.key_requirements_ko))     raw.key_requirements_ko = [];
    if (!Array.isArray(raw.constraints_ko))          raw.constraints_ko      = [];
    if (!Array.isArray(raw.open_questions_ko))       raw.open_questions_ko   = [];
    return raw;
  }

  // ── chat ───────────────────────────────────────────────────────────────────
  if (op === "chat") {
    const chatMessages = Array.isArray(msg.messages) ? msg.messages : [];
    let system = SYSTEM_CHAT;
    const ctx = fmtProjectContext(msg.projectContext);
    if (ctx) system += `\n\n### Current Project Context\n${ctx}`;
    if (hasRefMaterial(refs)) system += `\n\n${buildRefBlock("Uploaded project files (reference):", refs)}`;
    const reply = await callOpenAIChat(apiKey, system, chatMessages);
    return { reply };
  }

  // ── run_drc ────────────────────────────────────────────────────────────────
  if (op === "run_drc") {
    const result = await ercAgent.execute(
      {
        schematicData:    msg.schematicData ?? null,
        requirementsResult: null,
        referenceFiles:   refs,
      },
      apiKey
    );
    return result.data;
  }

  // ── multi_agent ────────────────────────────────────────────────────────────
  if (op === "multi_agent") {
    const steps = [];
    const { plan, results } = await orchestrator.run(
      msg.goal || "Analyze the circuit and provide comprehensive PCB design guidance.",
      {
        schematicData:  msg.schematicData  ?? null,
        referenceFiles: refs,
        projectContext: msg.projectContext ?? null,
      },
      apiKey,
      (step) => steps.push(step)
    );
    return { plan, results, steps };
  }

  throw new Error(`Unknown operation: ${op}`);
}

// ── Chrome message listener ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "pcb_agent_ping") {
    loadApiKey().then((key) => sendResponse({ apiKeyPresent: !!key }));
    return true;
  }

  if (message.type === "pcb_agent") {
    loadApiKey()
      .then((apiKey) => {
        if (!apiKey) throw new Error("OpenAI API key not set. Open the extension popup to save your key.");
        return handleMessage(message, apiKey);
      })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err)   => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return undefined;
});
