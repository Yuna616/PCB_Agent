/**
 * PCBAgent Circuit Engine
 * EasyEDA interaction abstraction layer.
 *
 * Strategy cascade (most to least reliable):
 *   1. Native EasyEDA API probe (window.EasyEDA / window.eda)
 *   2. Schematic JSON import via EasyEDA's internal file-import hook
 *   3. Clipboard paste of EasyEDA element strings
 *   4. Guided mode — annotated instructions + ASCII preview in panel
 *
 * Exposes: window.PCBCircuitEngine
 */
window.PCBCircuitEngine = (() => {
  'use strict';

  // ── EasyEDA shape ID counter ──────────────────────────────────────────────
  let _ggeCounter = 1000;
  const nextGge = () => `gge${++_ggeCounter}`;

  // ── Component type → EasyEDA library symbol mapping ──────────────────────
  const SYMBOL_MAP = {
    // MCUs
    'ESP32':        { lib: 'ESP32-WROOM-32',   pkg: 'WROOM-32',     w: 60, h: 80 },
    'ESP8266':      { lib: 'ESP8266',           pkg: 'QFN-32',       w: 60, h: 60 },
    'STM32F103':    { lib: 'STM32F103C8T6',     pkg: 'LQFP-48',     w: 80, h: 80 },
    'ATMEGA328':    { lib: 'ATmega328P-AU',     pkg: 'TQFP-32',     w: 60, h: 60 },
    'RP2040':       { lib: 'RP2040',            pkg: 'QFN-56',       w: 80, h: 80 },
    // Regulators
    'LDO_3.3V':     { lib: 'AMS1117-3.3',       pkg: 'SOT-223',      w: 40, h: 40 },
    'LDO_5V':       { lib: 'L7805',             pkg: 'TO-220',       w: 40, h: 40 },
    'BUCK_5V':      { lib: 'MP2315',            pkg: 'TSOT-23-8',    w: 40, h: 50 },
    'LDO_1.8V':     { lib: 'AMS1117-1.8',       pkg: 'SOT-223',      w: 40, h: 40 },
    // Passives
    'RESISTOR':     { lib: 'R',                 pkg: '0402',         w: 20, h: 10 },
    'CAPACITOR':    { lib: 'C',                 pkg: '0402',         w: 20, h: 10 },
    'INDUCTOR':     { lib: 'L',                 pkg: '0402',         w: 20, h: 10 },
    'FERRITE':      { lib: 'Ferrite_Bead',      pkg: '0402',         w: 20, h: 10 },
    // Connectivity
    'USB_C':        { lib: 'TYPE-C-31-M-12',    pkg: 'USB-C',        w: 40, h: 50 },
    'USB_MICRO':    { lib: 'MICRO-USB-5P',      pkg: 'MICRO-USB',    w: 40, h: 30 },
    'CONN_2P':      { lib: 'CONN-TH-2P',        pkg: 'KF301-2P',     w: 30, h: 20 },
    'CONN_4P':      { lib: 'CONN-TH-4P',        pkg: 'KF301-4P',     w: 30, h: 30 },
    // Interface
    'CAN_TRANS':    { lib: 'TJA1051T',          pkg: 'SO-8',         w: 50, h: 50 },
    'RS232':        { lib: 'MAX3232',           pkg: 'SOIC-16',      w: 60, h: 60 },
    'RS485':        { lib: 'SP3485',            pkg: 'SO-8',         w: 50, h: 50 },
    // Sensors
    'DHT22':        { lib: 'DHT22',             pkg: 'DIP-4',        w: 30, h: 40 },
    'BME280':       { lib: 'BME280',            pkg: 'LGA-8',        w: 30, h: 30 },
    // Power mgmt
    'MOSFET_N':     { lib: 'AO3400',            pkg: 'SOT-23',       w: 30, h: 30 },
    'DIODE_SCH':    { lib: 'SS34',              pkg: 'SMA',          w: 20, h: 20 },
    'TVS':          { lib: 'SMAJ5.0A',          pkg: 'SMA',          w: 20, h: 20 },
    // Crystals
    'CRYSTAL_8M':   { lib: 'Crystal_8MHz',      pkg: 'HC-49S',       w: 30, h: 20 },
    'CRYSTAL_32K':  { lib: 'Crystal_32.768kHz', pkg: 'CYLINDER-3X8', w: 20, h: 20 },
  };

  function resolveSymbol(type) {
    const key = type.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return SYMBOL_MAP[key] || SYMBOL_MAP[type] || { lib: type, pkg: 'SMD', w: 40, h: 40 };
  }

  // ── Smart layout: grid-based auto-placement ──────────────────────────────
  /**
   * Assign (x, y) positions to components if not already specified.
   * Groups by category: power rail left, MCU center, passives right.
   */
  function smartLayout(components) {
    const GRID   = 100;   // px between component centers
    const ORIGIN = { x: 200, y: 200 };

    const categories = {
      power:     [],  // regulators, power connectors
      mcu:       [],  // microcontrollers
      interface: [],  // CAN, RS232, USB, connectors
      passive:   [],  // R, C, L, ferrite
      other:     [],
    };

    components.forEach(comp => {
      const t = (comp.type || '').toUpperCase();
      if (t.includes('LDO') || t.includes('BUCK') || t.includes('USB') || t.includes('CONN'))
        categories.power.push(comp);
      else if (t.includes('ESP') || t.includes('STM') || t.includes('ATMEGA') || t.includes('RP2040') || t.includes('MCU'))
        categories.mcu.push(comp);
      else if (t.includes('CAN') || t.includes('RS232') || t.includes('RS485') || t.includes('UART'))
        categories.interface.push(comp);
      else if (t.includes('RESIST') || t.includes('CAPAC') || t.includes('INDUCTOR') || t.includes('FERRITE') || t === 'R' || t === 'C' || t === 'L')
        categories.passive.push(comp);
      else
        categories.other.push(comp);
    });

    const cols = [
      { items: categories.power,     x: ORIGIN.x },
      { items: categories.mcu,       x: ORIGIN.x + GRID * 3 },
      { items: categories.interface, x: ORIGIN.x + GRID * 6 },
      { items: categories.passive,   x: ORIGIN.x + GRID * 9 },
      { items: categories.other,     x: ORIGIN.x + GRID * 12 },
    ];

    cols.forEach(col => {
      col.items.forEach((comp, i) => {
        if (comp.x === undefined || comp.x === 0) comp.x = col.x;
        if (comp.y === undefined || comp.y === 0) comp.y = ORIGIN.y + i * GRID;
      });
    });

    return components;
  }

  // ── EasyEDA schematic JSON builder ────────────────────────────────────────
  /**
   * Convert agent circuit JSON → EasyEDA Standard schematic JSON format.
   * This format can be imported via File > Import > EasyEDA Schematic.
   */
  function buildEasyEDASchematic(circuitJson) {
    const comps   = circuitJson.components || [];
    const conns   = circuitJson.connections || [];
    const shapes  = [];
    const pinPositions = {}; // "ref.pin" → {x, y}

    // Place components
    comps.forEach(comp => {
      const sym = resolveSymbol(comp.type);
      const x = comp.x || 200;
      const y = comp.y || 200;
      const gge = nextGge();

      // LIB~ format: LIB~x~y~attr~rotation~id~locked~packageName~...
      shapes.push(
        `LIB~${x}~${y}~package=\`${sym.pkg}\`~0~${gge}~0~${sym.lib}~0~0~` +
        `#@$${comp.id}~${x - sym.w / 2}~${y - sym.h / 2}~~${comp.value || sym.lib}~${comp.id}~yes~${sym.pkg}~no~`
      );

      // Record approximate pin positions (idealized; real offsets need datasheet)
      // Pins: VCC top-center, GND bottom-center, others distributed on sides
      const standardPins = {
        VCC: { x, y: y - sym.h / 2 - 10 },
        GND: { x, y: y + sym.h / 2 + 10 },
        OUT: { x: x + sym.w / 2 + 10, y },
        IN:  { x: x - sym.w / 2 - 10, y },
        TX:  { x: x + sym.w / 2 + 10, y: y - 10 },
        RX:  { x: x + sym.w / 2 + 10, y: y + 10 },
        SCL: { x: x + sym.w / 2 + 10, y: y - 20 },
        SDA: { x: x + sym.w / 2 + 10, y: y - 10 },
        EN:  { x: x - sym.w / 2 - 10, y: y - 10 },
      };

      Object.entries(standardPins).forEach(([pin, pos]) => {
        pinPositions[`${comp.id}.${pin}`] = pos;
      });
    });

    // Add power symbols (VCC / GND rails)
    const powerNets = new Set();
    conns.forEach(conn => {
      [conn.from, conn.to].forEach(node => {
        if (node.startsWith('PWR.') || node.startsWith('GND') || node === 'GND') {
          powerNets.add(node.replace('PWR.', ''));
        }
      });
    });

    let pwrX = 100, pwrY = 80;
    powerNets.forEach(net => {
      const gge = nextGge();
      if (net === 'GND' || net.includes('GND')) {
        shapes.push(`P~${pwrX}~${pwrY}~${gge}~GND~${pwrX}~${pwrY}~0~`);
      } else {
        shapes.push(`P~${pwrX}~${pwrY}~${gge}~${net}~${pwrX}~${pwrY}~0~`);
      }
      pinPositions[`PWR.${net}`] = { x: pwrX, y: pwrY };
      pinPositions[`GND`]         = { x: pwrX, y: pwrY };
      pwrX += 60;
    });

    // Draw wires for connections
    conns.forEach(conn => {
      const fromPos = pinPositions[conn.from];
      const toPos   = pinPositions[conn.to];
      if (!fromPos || !toPos) return;

      const gge = nextGge();
      // W~ format: W~x1~y1~x2~y2~strokeColor~strokeWidth~...
      if (fromPos.x === toPos.x || fromPos.y === toPos.y) {
        // Straight wire
        shapes.push(`W~${fromPos.x}~${fromPos.y}~${toPos.x}~${toPos.y}~#000000~1~0~none~gge${++_ggeCounter}~0~`);
      } else {
        // L-shaped wire: horizontal then vertical
        shapes.push(`W~${fromPos.x}~${fromPos.y}~${toPos.x}~${fromPos.y}~#000000~1~0~none~${nextGge()}~0~`);
        shapes.push(`W~${toPos.x}~${fromPos.y}~${toPos.x}~${toPos.y}~#000000~1~0~none~${nextGge()}~0~`);
      }

      // Net label at midpoint
      const mx = Math.round((fromPos.x + toPos.x) / 2);
      const my = Math.round((fromPos.y + toPos.y) / 2);
      const netName = conn.net || conn.from.split('.').pop();
      shapes.push(`N~${mx}~${my}~0~${nextGge()}~${netName}~`);
    });

    return {
      head: {
        type: 1,
        title: circuitJson.title || 'AI Generated Circuit',
        version: '6.5.32',
        newgge: _ggeCounter + 1,
        exportTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
        attr: { origin: 'PCBAgent-AI' },
      },
      canvas: 'CA~1000~1000~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0~',
      shape: shapes,
      BBox: { x: 80, y: 60, width: 900, height: 700 },
    };
  }

  // ── EasyEDA API Detection ────────────────────────────────────────────────
  function detectEnvironment() {
    const report = {
      isEasyEDA:    !!(window.EasyEDA || window.eda || window.edaApp),
      isStandard:   !!window.EasyEDA,
      isPro:        !!(window.EDA_LIBS || document.querySelector('#pro-editor')),
      hasNativeApi: false,
      nativeApis:   [],
    };

    // Probe known EasyEDA Standard API surfaces
    const probes = [
      ['window.EasyEDA',              window.EasyEDA],
      ['window.EasyEDA.main',         window.EasyEDA?.main],
      ['window.eda',                  window.eda],
      ['window.eda_api',              window.eda_api],
      ['window.edaApp',               window.edaApp],
      ['window.ClientSession',        window.ClientSession],
      ['window.EasyEDA.modules',      window.EasyEDA?.modules],
    ];

    probes.forEach(([name, val]) => {
      if (val) report.nativeApis.push(name);
    });

    report.hasNativeApi = report.nativeApis.length > 0;
    return report;
  }

  // ── Strategy 1: Native EasyEDA API ───────────────────────────────────────
  function tryNativeInsert(comp) {
    // EasyEDA Standard exposes symbol placement via various API paths
    // Try known paths in order:
    const apis = [
      window.EasyEDA?.main?.evoke,
      window.EasyEDA?.modules?.schematic,
      window.eda,
      window.eda_api,
    ];

    for (const api of apis) {
      if (!api) continue;
      const fns = ['addSymbol', 'placeSymbol', 'addComponent', 'insertComponent'];
      for (const fn of fns) {
        if (typeof api[fn] === 'function') {
          try {
            api[fn]({ type: comp.type, x: comp.x, y: comp.y, id: comp.id });
            return true;
          } catch (_) {}
        }
      }
    }
    return false;
  }

  // ── Strategy 2: JSON Import via File Input ────────────────────────────────
  async function tryImportViaFileInput(schematicJson) {
    const jsonStr = JSON.stringify(schematicJson);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const file = new File([blob], 'pcb_agent_circuit.json', { type: 'application/json' });

    // EasyEDA Standard file import inputs (class/accept patterns observed in the wild)
    const selectors = [
      'input[type="file"][accept*="json"]',
      'input[type="file"][accept*=".json"]',
      '#importFileInput',
      'input[type="file"].import-input',
    ];

    for (const sel of selectors) {
      const input = document.querySelector(sel);
      if (!input) continue;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const nativeInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
        nativeInputValue.set.call(input, dt.files);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        return true;
      } catch (_) {}
    }
    return false;
  }

  // ── Strategy 3: Clipboard-based paste ────────────────────────────────────
  async function tryClipboardPaste(shapes) {
    const clipboardText = shapes.join('\n');
    try {
      await navigator.clipboard.writeText(clipboardText);
      // Trigger paste on the canvas
      const canvas = document.querySelector('canvas, [class*="canvas-wrap"], [id*="schematic"]');
      if (canvas) {
        canvas.focus();
        canvas.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'v', ctrlKey: true, bubbles: true
        }));
        await new Promise(r => setTimeout(r, 300));
        return true;
      }
    } catch (_) {}
    return false;
  }

  // ── Main render function ──────────────────────────────────────────────────
  /**
   * Full circuit rendering pipeline.
   * Returns a result object describing what was accomplished and what needs manual action.
   *
   * @param {object} circuitJson  { components, connections, ... }
   * @returns {Promise<RenderResult>}
   */
  async function renderCircuit(circuitJson) {
    const result = {
      success:        false,
      strategy:       'none',
      schematicJson:  null,
      shapes:         [],
      warnings:       [],
      manualSteps:    [],
      componentCount: 0,
      wireCount:      0,
    };

    if (!circuitJson || !Array.isArray(circuitJson.components)) {
      result.warnings.push('Invalid circuit JSON: missing components array');
      return result;
    }

    // Apply smart layout if coordinates are missing
    circuitJson.components = smartLayout(circuitJson.components);
    result.componentCount  = circuitJson.components.length;
    result.wireCount       = (circuitJson.connections || []).length;

    const env = detectEnvironment();

    // Build EasyEDA schematic JSON regardless of strategy
    const schematicJson = buildEasyEDASchematic(circuitJson);
    result.schematicJson = schematicJson;
    result.shapes        = schematicJson.shape;

    // Strategy 1: native API
    if (env.hasNativeApi) {
      let nativeOk = true;
      for (const comp of circuitJson.components) {
        if (!tryNativeInsert(comp)) { nativeOk = false; break; }
      }
      if (nativeOk) {
        result.success  = true;
        result.strategy = 'native_api';
        return result;
      }
    }

    // Strategy 2: file-input import
    const importOk = await tryImportViaFileInput(schematicJson);
    if (importOk) {
      result.success  = true;
      result.strategy = 'json_import';
      return result;
    }

    // Strategy 3: clipboard paste (shapes only)
    const pasteOk = await tryClipboardPaste(schematicJson.shape);
    if (pasteOk) {
      result.success  = true;
      result.strategy = 'clipboard_paste';
      return result;
    }

    // Strategy 4: guided mode — provide manual instructions
    result.strategy    = 'guided';
    result.success     = false;   // not auto-applied
    result.manualSteps = buildManualSteps(circuitJson, schematicJson);
    result.warnings.push('Auto-placement unavailable in this EasyEDA version. Use the Import button below.');
    return result;
  }

  function buildManualSteps(circuitJson, schematicJson) {
    const steps = [
      '1. In EasyEDA: click File → Import → EasyEDA Schematic',
      '2. Paste or select the downloaded pcb_agent_circuit.json file',
      '3. Click OK to place the circuit on the canvas',
      '──── OR ────',
      '1. Click "📋 Copy EasyEDA JSON" button below',
      '2. In EasyEDA: File → New Schematic',
      '3. Open browser console (F12) and run:',
      '   EasyEDA.main.loadSchematic(JSON.parse(localStorage.getItem("pcb_agent")))',
    ];

    // Also list each component for manual placement reference
    circuitJson.components.forEach(c => {
      const sym = resolveSymbol(c.type);
      steps.push(`   ○ Place ${c.id} (${sym.lib}) at position (${c.x}, ${c.y})`);
    });

    return steps;
  }

  // ── Circuit State Extraction ──────────────────────────────────────────────
  /**
   * Read the current schematic state from EasyEDA's DOM/state.
   * Returns a structured JSON or null if extraction is not possible.
   */
  function extractCircuitState() {
    // Try EasyEDA Standard data getter
    const attempts = [
      () => {
        const state = window.EasyEDA?.main?.getCurrentSchematic?.();
        return state ? JSON.parse(state) : null;
      },
      () => {
        // Look for JSON stored in hidden textarea (EasyEDA backup)
        const ta = document.querySelector('textarea[id*="schematic"], textarea[name*="schematic"]');
        if (ta && ta.value) return JSON.parse(ta.value);
        return null;
      },
      () => {
        // EasyEDA Pro: React state extraction via fiber
        const root = document.querySelector('[data-reactroot], #react-root, [id*="editor"]');
        if (!root) return null;
        // Walk fiber to find schematic data (version-specific, may not work)
        let fiber = root._reactFiber || root.__reactFiber || null;
        if (!fiber) return null;
        // Check for schematic data in memoized state (shallow)
        let cur = fiber;
        for (let i = 0; i < 20; i++) {
          const s = cur?.memoizedState;
          if (s && s.schematic) return s.schematic;
          cur = cur?.child || cur?.sibling || cur?.return;
          if (!cur) break;
        }
        return null;
      },
      () => {
        // DOM scraping fallback: scan for component labels
        const comps = [];
        document.querySelectorAll('[class*="component"], [class*="symbol"], [data-ref]').forEach(el => {
          const ref = el.getAttribute('data-ref') || el.textContent?.match(/[UCR]\d+/)?.[0];
          if (ref) comps.push({ id: ref, type: 'unknown', x: 0, y: 0 });
        });
        return comps.length ? { components: comps, connections: [] } : null;
      },
    ];

    for (const fn of attempts) {
      try {
        const data = fn();
        if (data) return data;
      } catch (_) {}
    }
    return null;
  }

  // ── Auto-Fix Application ─────────────────────────────────────────────────
  /**
   * Apply a list of fix actions returned by OpenAI.
   * @param {Array} fixes  [{ action, type, connect_to, value, ref, ... }]
   * @returns {Promise<{applied: string[], skipped: string[]}>}
   */
  async function applyFixes(fixes) {
    const applied = [], skipped = [];

    for (const fix of fixes) {
      try {
        switch (fix.action) {
          case 'add_component': {
            const comp = {
              id:   fix.ref || `X${Date.now()}`,
              type: fix.type,
              x:    fix.x || 0,
              y:    fix.y || 0,
              value: fix.value || '',
            };
            const result = await renderCircuit({
              components: [comp],
              connections: fix.connect_to ? [{ from: `${comp.id}.VCC`, to: fix.connect_to }] : [],
            });
            applied.push(`Added ${fix.type} (strategy: ${result.strategy})`);
            break;
          }
          case 'add_wire': {
            const wireCircuit = { components: [], connections: [{ from: fix.from, to: fix.to }] };
            await renderCircuit(wireCircuit);
            applied.push(`Connected ${fix.from} → ${fix.to}`);
            break;
          }
          case 'delete_component': {
            // Try native delete
            const deleted = window.EasyEDA?.main?.evoke?.deleteComponent?.(fix.ref);
            if (deleted) applied.push(`Deleted ${fix.ref}`);
            else skipped.push(`Cannot auto-delete ${fix.ref} — remove manually`);
            break;
          }
          case 'change_value': {
            const changed = window.EasyEDA?.main?.evoke?.updateComponentValue?.(fix.ref, fix.value);
            if (changed) applied.push(`Updated ${fix.ref} value → ${fix.value}`);
            else skipped.push(`Cannot auto-update ${fix.ref} value — update manually`);
            break;
          }
          default:
            skipped.push(`Unknown fix action: ${fix.action}`);
        }
      } catch (e) {
        skipped.push(`Error applying fix (${fix.action}): ${e.message}`);
      }
    }

    return { applied, skipped };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return Object.freeze({
    detectEnvironment,
    smartLayout,
    renderCircuit,
    buildEasyEDASchematic,
    extractCircuitState,
    applyFixes,
    resolveSymbol,
  });
})();
