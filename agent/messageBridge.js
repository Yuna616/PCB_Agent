/**
 * PCBAgent Message Bridge
 * Wraps chrome.runtime messaging in Promise-based API.
 * Must be injected BEFORE circuitEngine.js and agentUI.js.
 *
 * Exposes: window.PCBAgentBridge
 */
window.PCBAgentBridge = (() => {
  'use strict';

  /** Pending request map: correlationId → { resolve, reject, timer } */
  const _pending = new Map();
  let _correlationCounter = 0;

  /** Registered page-side message handlers (action → handler[]) */
  const _handlers = new Map();

  // ── Inbound: background → content script ─────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;

    // Resolve a pending Promise if this is a response
    if (msg._correlationId !== undefined && _pending.has(msg._correlationId)) {
      const { resolve, reject, timer } = _pending.get(msg._correlationId);
      _pending.delete(msg._correlationId);
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.payload ?? msg);
      return;
    }

    // Dispatch to registered handlers
    const key = msg.action;
    if (key && _handlers.has(key)) {
      _handlers.get(key).forEach(fn => {
        try { fn(msg); } catch (e) { console.warn('[PCBAgentBridge] handler error:', e); }
      });
    }
  });

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Send a request to the background service worker and await a typed response.
   * @param {string} action
   * @param {object} data
   * @param {number} [timeoutMs=30000]
   * @returns {Promise<any>}
   */
  function sendRequest(action, data = {}, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = ++_correlationCounter;
      const timer = setTimeout(() => {
        if (_pending.has(id)) {
          _pending.delete(id);
          reject(new Error(`Request timed out: ${action}`));
        }
      }, timeoutMs);

      _pending.set(id, { resolve, reject, timer });

      chrome.runtime.sendMessage({ action, data, _correlationId: id }, (response) => {
        if (chrome.runtime.lastError) {
          _pending.delete(id);
          clearTimeout(timer);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        // Synchronous response path (some handlers use sendResponse directly)
        if (response !== undefined) {
          _pending.delete(id);
          clearTimeout(timer);
          if (response && response.error) reject(new Error(response.error));
          else resolve(response);
        }
        // Async path: background calls sendResponse later → handled above
      });
    });
  }

  /**
   * Register a listener for messages pushed from the background.
   * @param {string} action
   * @param {function} handler
   */
  function onMessage(action, handler) {
    if (!_handlers.has(action)) _handlers.set(action, []);
    _handlers.get(action).push(handler);
  }

  /**
   * Notify the background without awaiting a response.
   */
  function notify(action, data = {}) {
    chrome.runtime.sendMessage({ action, data }).catch(() => {});
  }

  return Object.freeze({ sendRequest, onMessage, notify });
})();
