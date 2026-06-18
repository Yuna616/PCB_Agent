// EasyEDA Schematic Reader — runs in page MAIN world
// Has access to EasyEDA's JavaScript globals (unlike isolated content scripts)
(function () {
  'use strict';

  /** EasyEDA 도큐먼트 shape 한 줄: TYPE~... */
  var SHAPE_HEAD_RE = /^[A-Z][A-Z0-9_]*~/;

  function parseShapeEntry(entry, result) {
    if (typeof entry !== 'string') return;
    var p = entry.split('~');
    var t = p[0];
    if (t === 'SCH_COMP' || t === 'LIB') {
      result.components.push({
        type: t,
        x: p[1],
        y: p[2],
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

  function ingestShapeArray(shapes, result) {
    if (!Array.isArray(shapes)) return 0;
    var before = result.components.length + result.nets.length;
    var max = Math.min(shapes.length, 8000);
    for (var i = 0; i < max; i++) {
      parseShapeEntry(shapes[i], result);
    }
    return result.components.length + result.nets.length - before;
  }

  /**
   * 객체 그래프에서 EasyEDA 스키매틱 shape 문자열 배열 탐색 (V2·번들 내부 경로 변화 대응)
   */
  function deepFindShapeArray(root, maxNodes) {
    var count = 0;
    var visited = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    function seen(o) {
      if (!visited) return false;
      if (visited.has(o)) return true;
      visited.add(o);
      return false;
    }
    function walk(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 10) return null;
      if (seen(obj)) return null;
      if (++count > maxNodes) return null;

      if (Array.isArray(obj)) {
        if (
          obj.length > 0 &&
          typeof obj[0] === 'string' &&
          SHAPE_HEAD_RE.test(obj[0])
        ) {
          var ok = 0;
          for (var j = 0; j < Math.min(obj.length, 12); j++) {
            if (typeof obj[j] === 'string' && SHAPE_HEAD_RE.test(obj[j])) ok++;
          }
          if (ok >= 1) return obj;
        }
        return null;
      }

      var keys = Object.keys(obj);
      var lim = Math.min(keys.length, 60);
      for (var i = 0; i < lim; i++) {
        var v = obj[keys[i]];
        if (v && typeof v === 'object') {
          var found = walk(v, depth + 1);
          if (found) return found;
        }
        if (count > maxNodes) return null;
      }
      return null;
    }
    return walk(root, 0);
  }

  /**
   * window 등에서 스키매틱 seed 객체 모으기
   */
  function collectWindowSeeds() {
    var seeds = [];
    var push = function (o) {
      if (o && typeof o === 'object') seeds.push(o);
    };
    try {
      push(window.EasyEDA);
      push(window.EasyEDA && window.EasyEDA.core);
      push(window.LCEDA);
      push(window.lceda);
      push(window.g_workspace);
      push(window.EASYEDAPRO || window.easyedaPro || window.__eda_pro__);
    } catch (_) {}

    try {
      var names = Object.getOwnPropertyNames(window);
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        if (
          /easy|eda|lc|sch|pro|work|store|core|lceda|g_workspace|canvas|editor|redux/i.test(
            n
          )
        ) {
          try {
            push(window[n]);
          } catch (_) {}
        }
      }
    } catch (_) {}

    return seeds;
  }

  function discoverShapeArrayAnywhere() {
    var seeds = collectWindowSeeds();
    for (var s = 0; s < seeds.length; s++) {
      var found = deepFindShapeArray(seeds[s], 6000);
      if (found && found.length) return found;
    }
    var fallback = deepFindShapeArray(window, 8000);
    return fallback && fallback.length ? fallback : null;
  }

  /**
   * JS API 없이 SVG/캔버스에 그려진 라벨만으로 최소 부품·넷 목록 (ERC 맥락용)
   */
  function augmentFromRenderedLabels(result) {
    var root =
      document.querySelector('#svgEditor') ||
      document.querySelector('.eda-editor') ||
      document.querySelector('[class*="Schematic"]') ||
      document.querySelector('[class*="schematic"]') ||
      document.body;

    var svgList = root.querySelectorAll('svg');
    var bestSvg = null;
    var maxTexts = 0;
    for (var i = 0; i < svgList.length; i++) {
      var n = svgList[i].querySelectorAll('text, tspan').length;
      if (n > maxTexts) {
        maxTexts = n;
        bestSvg = svgList[i];
      }
    }
    if (!bestSvg || maxTexts < 1) return false;

    var nodes = bestSvg.querySelectorAll('text, tspan');
    var texts = [];
    for (var j = 0; j < nodes.length; j++) {
      var raw = (nodes[j].textContent || '').trim();
      if (raw && raw.length < 120) texts.push(raw);
    }

    var refRe = /^([RCDUJQMKXY][0-9]{1,4})$/i;
    var seenRef = {};
    var seenNet = {};

    for (var k = 0; k < texts.length; k++) {
      var t = texts[k];
      var parts = t.split(/[\s\n\r]+/).filter(Boolean);
      for (var pi = 0; pi < parts.length; pi++) {
        var tok = parts[pi];
        var rm = tok.match(refRe);
        if (rm) {
          var ref = rm[1].toUpperCase();
          if (!seenRef[ref]) {
            seenRef[ref] = true;
            result.components.push({
              type: 'RENDER_LABEL',
              ref: ref,
              name: '(화면 라벨)',
              id: '',
            });
          }
        }
      }
      if (
        /^(VCC|VDD|VEE|VBAT|GND|AGND|PGND)$/i.test(t) ||
        /^\+?[0-9.]+\s*V$/i.test(t)
      ) {
        if (!seenNet[t]) {
          seenNet[t] = true;
          result.nets.push({ type: 'label', name: t });
        }
      }
    }

    return Object.keys(seenRef).length > 0 || Object.keys(seenNet).length > 0;
  }

  function snapshotSchematic() {
    var result = {
      detected: false,
      components: [],
      nets: [],
      rawShapes: null,
      source: 'none',
      pageType: 'unknown',
    };

    var url = location.href;
    if (
      url.includes('easyeda.com') ||
      url.includes('oshwlab.com') ||
      url.includes('lceda.cn')
    ) {
      result.pageType = url.includes('pro.easyeda') ? 'pro' : 'standard';
    }

    // ── EasyEDA Standard ─────────────────────────────────────────────────────
    try {
      if (typeof EasyEDA !== 'undefined') {
        result.detected = true;
        result.source = 'EasyEDA Standard (window.EasyEDA)';

        var core = EasyEDA.core;
        if (core) {
          var shapes =
            core.currentDocument &&
            core.currentDocument.shape &&
            Array.isArray(core.currentDocument.shape)
              ? core.currentDocument.shape
              : core.canvasObj &&
                  core.canvasObj.shape &&
                  Array.isArray(core.canvasObj.shape)
                ? core.canvasObj.shape
                : core.currentProject &&
                    core.currentProject.schematics &&
                    core.currentProject.schematics[0] &&
                    Array.isArray(core.currentProject.schematics[0].shape)
                  ? core.currentProject.schematics[0].shape
                  : core.currentProject &&
                      core.currentProject.schDocs &&
                      core.currentProject.schDocs[0] &&
                      Array.isArray(core.currentProject.schDocs[0].shape)
                    ? core.currentProject.schDocs[0].shape
                    : null;

          if (Array.isArray(shapes)) {
            result.rawShapes = shapes.slice(0, 300);
            ingestShapeArray(shapes, result);
          }

          var docType =
            core.currentDocument && core.currentDocument.docType != null
              ? core.currentDocument.docType
              : core.currentDocType;
          if (docType != null) result.docType = docType;
        }
      }
    } catch (_) {}

    // ── EasyEDA Pro / 번들 스토어 ─────────────────────────────────────────────
    try {
      var pro = window.EASYEDAPRO || window.easyedaPro || window.__eda_pro__;
      if (pro && !result.components.length) {
        var getStore = pro.getStore || (pro.store && pro.store.getState);
        if (typeof getStore === 'function') {
          var state = getStore();
          if (state && state.schematic) {
            result.detected = true;
            result.source = 'EasyEDA Pro (store)';
            if (Array.isArray(state.schematic.components)) {
              result.components = state.schematic.components.slice(0, 100);
            }
            if (Array.isArray(state.schematic.nets)) {
              result.nets = state.schematic.nets.slice(0, 200);
            }
          }
        }
      }
    } catch (_) {}

    // ── Redux store fallback ──────────────────────────────────────────────────
    if (!result.detected) {
      try {
        var reduxKeys = ['__store__', '_store', 'store', 'editorStore'];
        for (var ri = 0; ri < reduxKeys.length; ri++) {
          var st = window[reduxKeys[ri]];
          if (st && typeof st.getState === 'function') {
            var stState = st.getState();
            var sch = stState && (stState.schematic || stState.editor || stState.canvas);
            if (sch) {
              result.detected = true;
              result.source = 'Redux (window.' + reduxKeys[ri] + ')';
              if (Array.isArray(sch.components)) {
                result.components = sch.components.slice(0, 100);
              }
              break;
            }
          }
        }
      } catch (_) {}
    }

    // ── V2: EasyEDA가 있으나 shape 경로가 바뀐 경우 core 깊이 탐색 ────────────
    if (
      typeof EasyEDA !== 'undefined' &&
      EasyEDA.core &&
      result.components.length === 0 &&
      result.nets.length === 0
    ) {
      try {
        var fromCore = deepFindShapeArray(EasyEDA.core, 5000);
        if (fromCore && fromCore.length) {
          result.rawShapes = fromCore.slice(0, 300);
          ingestShapeArray(fromCore, result);
          result.source = 'EasyEDA Standard (shape 배열 탐색)';
        }
      } catch (_) {}
    }

    // ── 전역에서 shape 문자열 배열 탐색 (Standard/Pro/V2 혼합) ─────────────────
    if (result.components.length === 0 && result.nets.length === 0) {
      try {
        var discovered = discoverShapeArrayAnywhere();
        if (discovered && discovered.length) {
          result.detected = true;
          result.rawShapes = discovered.slice(0, 300);
          ingestShapeArray(discovered, result);
          result.source = 'EasyEDA (내부 shape 배열 발견)';
        }
      } catch (_) {}
    }

    // ── DOM-level detection ───────────────────────────────────────────────────
    if (!result.detected) {
      try {
        var edaEl = document.querySelector(
          [
            '.eda-editor',
            '#eda-canvas',
            '[class*="easyeda"]',
            '[class*="EasyEDA"]',
            '[class*="lceda"]',
            '[class*="LCEDA"]',
            '[class*="schematic"]',
            '[class*="Schematic"]',
            '[class*="Editor"]',
            '[id*="editor"]',
            '[id*="Editor"]',
            '.svgEditor',
            '#svgEditor',
            '.kicad-viewer',
            'canvas',
          ].join(', ')
        );
        if (edaEl) {
          result.detected = true;
          result.source = 'DOM (editor canvas found — no JavaScript API access)';
        }
      } catch (_) {}
    }

    // ── 최후 수단: 화면에 그려진 참조·넷 라벨만 추출 ───────────────────────────
    if (
      result.detected &&
      result.components.length === 0 &&
      augmentFromRenderedLabels(result)
    ) {
      result.source =
        result.source + ' + 화면 라벨(SVG 텍스트)';
    }

    return result;
  }

  /** iframe 안에서 스캔해도 최상위 패널(콘텐츠 스크립트)이 결과를 받도록 전달 */
  function emitScanResult(payload, autoScan) {
    var msg = { __pcbAgent: 'scan_result', payload: payload, autoScan: !!autoScan };
    try {
      window.postMessage(msg, '*');
    } catch (_) {}
    if (window !== window.top) {
      try {
        window.top.postMessage(msg, '*');
      } catch (_) {}
    }
  }

  window.addEventListener('message', function (evt) {
    if (!evt.data || evt.data.__pcbAgent !== 'scan_request') return;
    var src = evt.source;
    if (
      src !== window &&
      src !== window.parent &&
      (!window.top || src !== window.top)
    ) {
      return;
    }
    var payload = snapshotSchematic();
    emitScanResult(payload, false);
  });

  // ── Real-time auto-scan via MutationObserver ──────────────────────────────
  var _autoScanTimer = null;
  var _lastScanHash = '';

  function _hashScan(res) {
    var c = (res.components || [])
      .map(function (x) {
        return (x.ref || '') + (x.name || '');
      })
      .join('|');
    var n = (res.nets || [])
      .map(function (x) {
        return x.name || x.type || '';
      })
      .join('|');
    return c + '::' + n;
  }

  function _scheduleAutoScan() {
    clearTimeout(_autoScanTimer);
    _autoScanTimer = setTimeout(function () {
      var payload = snapshotSchematic();
      if (!payload.detected) return;
      var hash = _hashScan(payload);
      if (hash === _lastScanHash) return;
      _lastScanHash = hash;
      emitScanResult(payload, true);
    }, 1500);
  }

  function _startObserver() {
    var target =
      document.querySelector('#svgEditor') ||
      document.querySelector('.eda-canvas') ||
      document.querySelector('[class*="schematic"]') ||
      document.querySelector('canvas') ||
      document.body;
    var observer = new MutationObserver(_scheduleAutoScan);
    observer.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['transform', 'class', 'd'],
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startObserver);
  } else {
    _startObserver();
  }
})();
