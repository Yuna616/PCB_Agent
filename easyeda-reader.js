// EasyEDA Schematic Reader — runs in page MAIN world
// Has access to EasyEDA's JavaScript globals (unlike isolated content scripts)
(function () {
  'use strict';

  function snapshotSchematic() {
    const result = {
      detected: false,
      components: [],
      nets: [],
      rawShapes: null,
      source: 'none',
      pageType: 'unknown',
    };

    // Detect EasyEDA page type
    const url = location.href;
    if (url.includes('easyeda.com') || url.includes('oshwlab.com') || url.includes('lceda.cn')) {
      result.pageType = url.includes('pro.easyeda') ? 'pro' : 'standard';
    }

    // ── EasyEDA Standard ─────────────────────────────────────────────────────
    try {
      if (typeof EasyEDA !== 'undefined') {
        result.detected = true;
        result.source = 'EasyEDA Standard (window.EasyEDA)';

        const core = EasyEDA.core;
        if (core) {
          // EasyEDA stores schematic as array of encoded strings
          const shapes =
            core.currentDocument?.shape ||
            core.canvasObj?.shape ||
            core.currentProject?.schematics?.[0]?.shape ||
            core.currentProject?.schDocs?.[0]?.shape;

          if (Array.isArray(shapes)) {
            result.rawShapes = shapes.slice(0, 300);
            for (const entry of shapes) {
              if (typeof entry !== 'string') continue;
              const p = entry.split('~');
              const t = p[0];
              if (t === 'SCH_COMP' || t === 'LIB') {
                result.components.push({
                  type: t,
                  x: p[1], y: p[2],
                  ref: p[6] || p[5] || '',
                  name: p[7] || p[6] || '',
                  id: p[8] || p[1] || '',
                });
              } else if (t === 'NETLABEL' || t === 'PORTLABEL') {
                result.nets.push({ type: 'label', name: p[2] || '' });
              } else if (t === 'POWER') {
                result.nets.push({ type: 'power', name: p[1] || '' });
              } else if (t === 'NOCONNECT') {
                result.nets.push({ type: 'noconnect', x: p[1], y: p[2] });
              }
            }
          }

          // Current doc type (1=schematic, 2=PCB)
          const docType = core.currentDocument?.docType || core.currentDocType;
          if (docType) result.docType = docType;
        }
      }
    } catch (_) {}

    // ── EasyEDA Pro ───────────────────────────────────────────────────────────
    try {
      const pro = window.EASYEDAPRO || window.easyedaPro || window.__eda_pro__;
      if (pro && !result.detected) {
        result.detected = true;
        result.source = 'EasyEDA Pro';
        const getStore = pro.getStore || pro.store?.getState;
        if (typeof getStore === 'function') {
          const state = getStore();
          if (state?.schematic?.components) {
            result.components = state.schematic.components.slice(0, 100);
          }
          if (state?.schematic?.nets) {
            result.nets = state.schematic.nets.slice(0, 200);
          }
        }
      }
    } catch (_) {}

    // ── Redux store fallback ──────────────────────────────────────────────────
    if (!result.detected) {
      try {
        for (const key of ['__store__', '_store', 'store', 'editorStore']) {
          const s = window[key];
          if (s && typeof s.getState === 'function') {
            const state = s.getState();
            const sch = state?.schematic || state?.editor || state?.canvas;
            if (sch) {
              result.detected = true;
              result.source = `Redux (window.${key})`;
              if (Array.isArray(sch.components)) result.components = sch.components.slice(0, 100);
              break;
            }
          }
        }
      } catch (_) {}
    }

    // ── DOM-level detection ───────────────────────────────────────────────────
    if (!result.detected) {
      try {
        const edaEl = document.querySelector(
          '.eda-editor, #eda-canvas, [class*="easyeda"], .svgEditor, #svgEditor, .kicad-viewer'
        );
        if (edaEl) {
          result.detected = true;
          result.source = 'DOM (editor canvas found — no JavaScript API access)';
        }
      } catch (_) {}
    }

    return result;
  }

  // Listen for scan requests from the content script (isolated world)
  window.addEventListener('message', function (evt) {
    if (
      !evt.data ||
      evt.data.__pcbAgent !== 'scan_request' ||
      evt.source !== window
    ) return;
    const payload = snapshotSchematic();
    window.postMessage({ __pcbAgent: 'scan_result', payload }, '*');
  });
})();
