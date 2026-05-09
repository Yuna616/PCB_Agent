# PCB Agent — EasyEDA Coach Extension

<img width="894" height="542" alt="Image" src="https://github.com/user-attachments/assets/9344fc28-5534-40f3-beec-3501e22c2386" />

A Chrome extension that provides real-time AI coaching while you design PCBs in EasyEDA.  
Detects 10 electrical rule violations automatically as you edit, and guides you through the full workflow — schematic → PCB layout → Gerber export.

---

## Features

### 🔍 Real-Time ERC (Electrical Rule Check)
- **Auto-detect**: A `MutationObserver` watches the EasyEDA canvas for changes. When the schematic is edited, a circuit scan runs automatically (1.5 s debounce) — no button click needed.
- **Auto-ERC**: 8 seconds after the last detected change, GPT-4o runs a full ERC and updates the results panel automatically.
- **DRC tab badge**: Shows the current error count (🔴 number) or a pass indicator (✓) at all times.
- **Live status bar**: Pulses green while monitoring, yellow when a change is detected, blue while AI is analyzing.
- Checks **10 electrical rule categories**:
  1. Floating pins — unconnected input/output pins without NC marker
  2. Missing VCC decoupling — 100 nF + 10 µF per IC VCC pin
  3. Missing GND symbol connections
  4. No reverse polarity protection on power input
  5. No ESD protection on USB / CAN / external connectors
  6. Missing pull-up resistors on I2C SDA/SCL, RST, BOOT pins
  7. Unconnected or mismatched net names
  8. Missing power rail symbols (VCC_3V3, VCC_5V, etc.)
  9. No RC reset circuit on MCU RST pin
  10. Missing crystal load capacitors
- Each violation is categorized as 🔴 Error / ⚠️ Warning / ℹ️ Info with a specific fix suggestion.

### 💬 AI Coach (Chat)
- Upload project documents — the AI analyzes them and provides step-by-step design guidance automatically.
- Specific recommendations for component selection (LCSC part numbers), decoupling placement, and protection circuits.
- Ask follow-up questions at any point in the design process.

### 📂 Document Upload & Analysis
- Supports text-based files: `.txt`, `.json`, `.md`, `.csv`, `.ino`, `.sch`, `.kicad_*`, etc.
- Up to 20 files, 40,000 characters per file.
- Extracted context (power rails, ICs, interfaces) is automatically injected into ERC and chat prompts.

### ✅ Design Checklist
- 8 schematic items (bypass capacitors, net labels, ESD protection, DRC errors, etc.)
- 8 PCB layout items (differential pair routing, ground plane, thermal vias, Gerber verification, etc.)

### ⚡ Quick Questions
- One-click access to common questions: protection circuits, LCSC part numbers, decoupling guide, trace width, differential pair routing, Gerber export, JLCPCB ordering.

---

## Installation

**Requirements**: Chrome 111+ · OpenAI API key (GPT-4o)

1. Clone or download this repository.

```bash
git clone https://github.com/yourname/easyeda-coach-extension.git
```

2. Open `chrome://extensions` → enable **Developer mode** → click **Load unpacked** → select the folder.

3. Click the extension icon → enter your OpenAI API key → click **Save**.

4. Open any EasyEDA tab — the panel appears on the right side automatically.

---

## Usage

### With Document Upload (Recommended)

```
1. Open a project in EasyEDA
2. Go to [📂 Docs] tab → upload your project files
3. AI analyzes files → step-by-step guidance appears in [💬 AI Coach]
4. Start drawing — ERC runs automatically in the background
5. Check [🔍 DRC] tab or watch the badge for live violation counts
```

### Manual ERC

```
1. Go to [🔍 DRC] tab
2. Optionally click [📡 Scan Circuit] to force an immediate scan
3. Click [🔍 Run AI ERC] to run ERC right now (bypasses the 8 s debounce)
4. Review results and apply suggested fixes
```

> Circuit scan reads EasyEDA's internal JavaScript state directly — no UI scraping.  
> ERC also runs on uploaded files alone if the editor is not open.

---

## Architecture

```
Chrome Browser
│
├─ EasyEDA Tab
│   ├─ easyeda-reader.js  ← MAIN world: reads EasyEDA JS globals directly
│   │                        MutationObserver → auto-scan on schematic changes
│   ├─ contentScript.js   ← 5-tab UI panel, auto-ERC pipeline (8 s debounce)
│   ├─ messageBridge.js   ← IPC abstraction between content and background
│   └─ panel.css          ← Dark theme UI (IBM Plex Sans KR)
│
├─ Popup (popup.html / popup.js)
│   └─ OpenAI API key input and storage
│
└─ Background Service Worker (background.js)  — 3-agent pipeline
    ├─ analyze_documents  → Structured project analysis (JSON)
    ├─ chat               → GPT-4o coaching with schematic + doc context
    └─ run_drc            → 10-rule ERC (structured JSON, temp 0.1)

External
└─ OpenAI API (gpt-4o)

Optional Python Backend (pcb-schematic-api/)
├─ POST /api/v1/generate      → AI schematic generation
├─ POST /api/v1/erc           → Electrical rule check
├─ POST /api/v1/parts/search  → LCSC part search
└─ POST /api/v1/bom/jlcpcb   → JLCPCB BOM generation + CSV export
```

### How Circuit Scanning Works

`easyeda-reader.js` runs in the page's **MAIN world** and reads EasyEDA's JavaScript globals directly — isolated content scripts cannot access these.

| Priority | Source | Covers |
|----------|--------|--------|
| 1 | `window.EasyEDA.core` | EasyEDA Standard |
| 2 | `window.EASYEDAPRO` | EasyEDA Pro |
| 3 | Redux store (`window.__store__`, etc.) | Both editions |
| 4 | DOM canvas detection | Editor presence only (no data extraction) |

When a change is detected, a hash of components + nets is compared to the previous scan. If nothing changed, the auto-ERC is skipped entirely.

---

## File Structure

```
easyeda-coach-extension/
├─ manifest.json          # MV3 config, permissions, target URLs
├─ background.js          # Service worker: 3-agent AI pipeline, system prompts
├─ contentScript.js       # 5-tab UI, auto-ERC debounce, live badge
├─ easyeda-reader.js      # MAIN world: JS globals reader + MutationObserver
├─ messageBridge.js       # content ↔ background messaging abstraction
├─ panel.css              # Dark theme panel styles
├─ popup.html / popup.js  # API key settings popup
├─ icons/                 # Extension icons (16/48/128 px)
└─ pcb-schematic-api/     # Optional Python FastAPI backend
    ├─ app/main.py
    ├─ app/services/
    │   ├─ ai_service.py
    │   ├─ erc_service.py       # 10-rule ERC via GPT-4o
    │   ├─ jlcpcb_service.py    # LCSC search + BOM CSV
    │   └─ schematic_service.py
    └─ requirements.txt
```

---

## Optional Python Backend

```bash
cd pcb-schematic-api
pip install -r requirements.txt
cp .env.example .env   # set OPENAI_API_KEY
python run.py          # http://localhost:8000
```

Swagger docs available at `http://localhost:8000/docs`.

---

## Supported Sites

| Site | Description |
|------|-------------|
| `easyeda.com` | EasyEDA Standard editor |
| `pro.easyeda.com` | EasyEDA Pro editor |
| `oshwlab.com` | OSHWLab (EasyEDA-based) |
| `lceda.cn` | LCEDA (Chinese edition) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Vanilla JS (ES6+), Chrome MV3 |
| AI | OpenAI GPT-4o (`json_object` mode, temperature 0.1) |
| UI | IBM Plex Sans KR, IBM Plex Mono |
| Backend (optional) | Python 3, FastAPI, Uvicorn, Pydantic v2 |

---

## License

MIT License
