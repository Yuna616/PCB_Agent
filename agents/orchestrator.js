/**
 * agents/orchestrator.js
 * Orchestrator — decides which agents to run, executes them in dependency order,
 * emits granular progress events, and returns aggregated results.
 *
 * Dependency graph (fixed):
 *   requirements
 *       ↓
 *   component  ←── erc (can start in parallel with component)
 *       ↓
 *    layout
 */

import { callOpenAIJson } from "./base.js";
import { RequirementsAgent } from "./requirements.js";
import { ComponentAgent }    from "./component.js";
import { ERCAgent }          from "./erc.js";
import { LayoutAgent }       from "./layout.js";

// ── Agent registry ────────────────────────────────────────────────────────────

const ALL_AGENTS = [
  new RequirementsAgent(),
  new ComponentAgent(),
  new ERCAgent(),
  new LayoutAgent(),
];

/** @type {Record<string, import('./requirements.js').RequirementsAgent>} */
const AGENT_BY_ID = Object.fromEntries(ALL_AGENTS.map((a) => [a.id, a]));

// ── Planning prompt ───────────────────────────────────────────────────────────

const SYSTEM_PLAN = `You are the orchestrator for a PCB design AI assistant.
Decide which specialist agents to activate for the user's goal.

Available agents:
- "requirements"  Extract structured requirements from documents and context. Should run first when docs are present.
- "component"     Select specific components + LCSC part numbers. Depends on requirements output.
- "erc"           Electrical Rule Check. Best when live schematic data exists.
- "layout"        PCB layout guidance. Runs last; consumes all other agents' outputs.

Return JSON ONLY:
{
  "reasoning": string,
  "agents": [string],
  "groups": [[string], [string]]
}

"groups" defines sequential execution batches; agents within one batch run in parallel.
Example: [["requirements"], ["component", "erc"], ["layout"]]

Selection rules:
- If goal is about errors/ERC only → ["erc"]
- If goal is about components/BOM  → ["requirements", "component"]
- If goal is general full analysis  → ["requirements", ["component","erc"], "layout"]  (flatten to groups)
- "layout" requires at least one of requirements/component/erc
- "component" should always follow requirements when docs are present`;

// ── Orchestrator class ────────────────────────────────────────────────────────

export class Orchestrator {
  /**
   * Ask the LLM which agents to run given the goal + context flags.
   * @returns {{ reasoning, agents, groups }}
   */
  async plan(goal, ctx, apiKey) {
    const flags =
      `Goal: "${goal}"\n` +
      `Has uploaded documents: ${(ctx.referenceFiles || []).some((f) => f?.text?.trim())}\n` +
      `Has live schematic:     ${!!(ctx.schematicData?.detected)} ` +
      `(${(ctx.schematicData?.components || []).length} components)`;

    try {
      const plan = await callOpenAIJson(apiKey, SYSTEM_PLAN, flags, { temperature: 0.1 });

      // Sanitize: only known agent IDs
      plan.agents = (plan.agents || []).filter((id) => AGENT_BY_ID[id]);

      plan.groups = (plan.groups || [])
        .map((g) => (Array.isArray(g) ? g : [g]).filter((id) => AGENT_BY_ID[id]))
        .filter((g) => g.length);

      // Fallback: each agent runs alone
      if (!plan.groups.length) {
        plan.groups = plan.agents.map((id) => [id]);
      }

      return plan;
    } catch (_) {
      // Safe default plan
      const agents = ctx.schematicData?.detected
        ? ["erc"]
        : (ctx.referenceFiles || []).some((f) => f?.text?.trim())
          ? ["requirements", "component"]
          : ["erc"];
      return { reasoning: "Fallback plan", agents, groups: [agents] };
    }
  }

  /**
   * Full pipeline execution.
   * @param {string} goal - User-provided goal string
   * @param {object} ctx  - { schematicData, referenceFiles, projectContext }
   * @param {string} apiKey
   * @param {(event: object) => void} onStep - Progress callback, called for every event
   * @returns {{ plan, results }}
   */
  async run(goal, ctx, apiKey, onStep) {
    const emit = (e) => { try { onStep(e); } catch (_) {} };
    const results = {};

    // ── Phase 1: Plan ────────────────────────────────────────────────────────
    emit({ type: "planning" });
    const plan = await this.plan(goal, ctx, apiKey);
    emit({ type: "plan_ready", plan });

    // Shared context grows as agents complete
    const shared = { ...ctx };

    // ── Phase 2: Execute groups sequentially ────────────────────────────────
    for (const group of plan.groups) {
      emit({ type: "group_start", agents: group });

      const settled = await Promise.allSettled(
        group.map(async (agentId) => {
          const agent = AGENT_BY_ID[agentId];
          emit({ type: "agent_start", agentId, label: agent.label, icon: agent.icon });

          const result = await agent.execute(shared, apiKey);

          // Publish output to shared context for downstream agents
          if (agentId === "requirements") shared.requirementsResult = result;
          if (agentId === "component")    shared.componentResult    = result;
          if (agentId === "erc")          shared.ercResult          = result;

          emit({ type: "agent_done", agentId, result });
          return result;
        })
      );

      // Collect outcomes
      group.forEach((agentId, i) => {
        const outcome = settled[i];
        if (outcome.status === "fulfilled") {
          results[agentId] = outcome.value;
        } else {
          const errMsg = outcome.reason?.message || "Agent failed";
          results[agentId] = { id: agentId, error: errMsg };
          emit({ type: "agent_error", agentId, error: errMsg });
        }
      });
    }

    emit({ type: "done", results, plan });
    return { plan, results };
  }
}
