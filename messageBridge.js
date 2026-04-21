/**
 * PCB_Agent — chrome.runtime messaging facade (content ↔ background).
 * Keeps message shapes in one place for maintainability.
 */
(function () {
  "use strict";

  /** @typedef {"generate"|"analyze"|"fixes"} PcbAgentOp */

  window.PCBAgentBridge = {
    ACTIONS: Object.freeze({
      PCB_AGENT: "pcb_agent",
    }),

    /**
     * @param {object} payload
     * @param {{ op: PcbAgentOp, prompt?: string, circuit?: object, issues?: object[] }} payload.body
     */
    async send(payload) {
      const body = payload && typeof payload === "object" ? payload : {};
      return chrome.runtime.sendMessage({
        type: this.ACTIONS.PCB_AGENT,
        ...body,
      });
    },

    /** @returns {Promise<{ apiKeyPresent: boolean }>} */
    async ping() {
      return chrome.runtime.sendMessage({ type: "pcb_agent_ping" });
    },
  };
})();
