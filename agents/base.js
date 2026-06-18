/**
 * agents/base.js
 * Shared utilities for all PCB agents.
 */

export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const MODEL = "gpt-4o";

/**
 * Raw OpenAI call. Returns the full assistant message object ({ role, content, tool_calls }).
 */
export async function callOpenAI(apiKey, messages, options = {}) {
  const body = {
    model: MODEL,
    temperature: options.temperature ?? 0.3,
    messages,
  };
  if (options.tools)           body.tools           = options.tools;
  if (options.tool_choice)     body.tool_choice     = options.tool_choice;
  if (options.response_format) body.response_format = options.response_format;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message ?? null;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("OpenAI call failed after retries");
}

/**
 * JSON-mode call. Returns parsed object.
 */
export async function callOpenAIJson(apiKey, system, user, options = {}) {
  const msg = await callOpenAI(
    apiKey,
    [{ role: "system", content: system }, { role: "user", content: user }],
    { temperature: 0.2, response_format: { type: "json_object" }, ...options }
  );
  return parseJsonSafe(msg?.content ?? "");
}

/**
 * Standard chat completion. Returns reply string.
 */
export async function callOpenAIChat(apiKey, system, chatMessages, options = {}) {
  const msg = await callOpenAI(
    apiKey,
    [{ role: "system", content: system }, ...chatMessages],
    { temperature: 0.45, ...options }
  );
  return msg?.content?.trim() ?? "";
}

export function parseJsonSafe(text) {
  const t = String(text ?? "").trim();
  try { return JSON.parse(t); } catch (_) {}
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("Response is not valid JSON");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function truncate(text, max = 80000) {
  const t = String(text ?? "");
  return t.length <= max ? t : `${t.slice(0, max)}\n\n[Truncated at ${max} chars]`;
}

/** Format component array → "U1(ESP32), C1(CAPACITOR)" */
export function fmtComponents(components, max = 60) {
  if (!Array.isArray(components) || !components.length) return "none";
  return components
    .slice(0, max)
    .map((c) => `${c.ref || c.id}(${c.name || c.type})`)
    .join(", ");
}

/** Format net array → "VCC, GND, SDA, SCL" */
export function fmtNets(nets, max = 25) {
  if (!Array.isArray(nets) || !nets.length) return "none";
  return nets
    .map((n) => n.name || n.type)
    .filter(Boolean)
    .slice(0, max)
    .join(", ");
}

/** Concatenate reference file texts into a single context block. */
export function buildDocBlock(referenceFiles, maxChars = 30000) {
  if (!Array.isArray(referenceFiles) || !referenceFiles.length) return "";
  const chunks = referenceFiles
    .filter((f) => f?.text?.trim())
    .map((f) => `--- ${f.name || "File"} ---\n${f.text.trim()}`);
  return chunks.length ? truncate(chunks.join("\n\n"), maxChars) : "";
}
