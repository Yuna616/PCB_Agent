# PCB Agent — EasyEDA Coach Extension

<img width="894" height="542" alt="Image" src="https://github.com/user-attachments/assets/9344fc28-5534-40f3-beec-3501e22c2386" />

A Chrome extension that provides real-time AI coaching while you design PCBs in EasyEDA.  
It runs a **multi-agent AI system** — an Orchestrator coordinates four specialist agents (Requirements, Component, ERC, Layout) to cover every stage of the PCB design workflow.

---

## What's New — Multi-Agent System

The extension now runs a pipeline of specialist AI agents instead of a single monolithic prompt.

| Agent | Role |
|-------|------|
| 📋 **Requirements** | Extracts power rails, interfaces, constraints, and open questions from uploaded documents |
| 🔌 **Component** | Recommends specific ICs and passives with real LCSC part numbers; flags JLCPCB Basic parts |
| 🔍 **ERC** | Checks 10 electrical rules; returns categorized errors, warnings, and info with Korean-language fix suggestions |
| 🏗️ **Layout** | Provides placement sequence, trace width table, critical routing rules, and a DFM checklist |
| 🎯 **Orchestrator** | Plans which agents to run based on your goal, executes parallel groups, passes results between agents |

**New 🤖 Agents tab** — type a goal in plain English, hit Run, and watch the pipeline execute step-by-step.

---

## Features

### 🤖 Multi-Agent Pipeline (New)
- **Goal-driven**: type any goal — "analyze circuit and recommend components", "run full ERC", "give me PCB layout guidance" — the Orchestrator decides which agents to invoke.
- **Dependency-aware execution**: agents run in the correct order. Requirements → [Component + ERC in parallel] → Layout.
- **Context passing**: each agent receives the outputs of earlier agents as input, so Layout guidance is informed by the actual components and ERC findings.
- **Live pipeline UI**: see each agent's status (planning → running → done) as the pipeline progresses.
- **Structured result cards**: each agent's output is rendered in a dedicated collapsible card with tables and grouped sections.

### 🔍 Real-Time ERC (Electrical Rule Check)
- **Auto-detect**: a `MutationObserver` watches the EasyEDA canvas. When the schematic changes, a circuit scan runs automatically (1.5 s debounce).
- **Auto-ERC**: 8 seconds after the last detected change, GPT-4o runs a full ERC and updates the results panel — no button click needed.
- **DRC tab badge**: shows current error count (🔴 number) or a pass indicator (✓) at all times.
- **Live status bar**: pulses green while monitoring, yellow when a change is detected, blue while AI is analyzing.
- Checks **10 electrical rule categories**:
  1. Floating pins — unconnected inputs/outputs without NC marker
  2. Missing VCC decoupling — 100 nF + 10 µF per IC VCC pin
  3. Missing GND symbol connections
  4. No reverse-polarity protection on power input
  5. No ESD protection on USB / CAN / external connectors
  6. Missing pull-up resistors on I2C SDA/SCL, RST, BOOT pins
  7. Unconnected or mismatched net names
  8. Missing power rail symbols (VCC_3V3, VCC_5V, etc.)
  9. No RC reset circuit on MCU RST pin
  10. Missing crystal load capacitors
- Each finding is classified as 🔴 Error / ⚠️ Warning / ℹ️ Info with a specific fix suggestion.

### 💬 AI Coach (Chat)
- Upload project documents — the AI analyzes them and provides step-by-step design guidance automatically.
- Context-aware: schematic scan data and document analysis are injected into every reply.
- Ask follow-up questions at any point in the design process.

### 📂 Document Upload & Analysis
- Supports text-based files: `.txt`, `.json`, `.md`, `.csv`, `.ino`, `.sch`, `.kicad_*`, etc.
- Up to 20 files, 40,000 characters per file.
- Extracted context is automatically shared with ERC and chat prompts.

### ✅ Design Checklist
- 8 schematic items (bypass capacitors, net labels, ESD protection, DRC pass, etc.)
- 8 PCB layout items (differential pair routing, ground plane, thermal vias, Gerber verification, etc.)

### ⚡ Quick Questions
- One-click access to common questions: protection circuits, LCSC part numbers, decoupling guide, trace width calculator, differential pair routing, Gerber export, JLCPCB ordering.

---

## Installation

**Requirements**: Chrome 111+ · OpenAI API key (GPT-4o)

1. Clone or download this repository.

```bash
git clone https://github.com/yourname/easyeda-coach-extension.git
```

2. Open `chrome://extensions` → enable **Developer mode** → click **Load unpacked** → select the project folder.

3. Click the extension icon → enter your OpenAI API key → click **Save**.

4. Open any EasyEDA tab — the panel appears on the right side automatically.

---

## Usage

### Multi-Agent Analysis (Recommended)

```
1. Open a project in EasyEDA (optional: upload documents in [📂 Docs] tab)
2. Go to [🤖 Agents] tab
3. Type your goal — e.g. "Analyze this circuit and recommend all components"
4. Click [▶ Run] — the Orchestrator plans and executes the pipeline
5. Watch agents run in sequence; result cards appear as each one completes
```

Agent result cards include:
- **Requirements**: power rails, interfaces, key IC suggestions, constraints
- **Components**: MCU, power ICs, protection parts — each with LCSC number and JLCPCB Basic flag
- **ERC**: all violations with severity, affected component, and Korean fix instructions
- **Layout**: layer stackup, placement order, trace width table, critical routing rules, DFM checklist

### ERC-Only (DRC Tab)

```
1. Go to [🔍 DRC] tab
2. Click [📡 Scan Circuit] to read the live schematic (or wait for auto-scan)
3. Click [🔍 Run AI ERC] for an immediate ERC
   — OR —
   Click [🤖 Agent] to run an ERC-focused agent pipeline and see results in the Chat tab
4. Review findings and apply suggested fixes
```

### Chat-Based Coaching

```
1. Go to [📂 Docs] tab → upload your schematic, BOM, or spec document
2. AI analyzes files → step-by-step guidance appears automatically in [💬 AI Coach]
3. Continue asking questions in the chat
```

> Circuit scan reads EasyEDA's internal JavaScript globals directly — no UI scraping.  
> ERC also works on uploaded files alone when the editor is not open.

---

## Architecture

```
Chrome Browser
│
├─ EasyEDA Tab
│   ├─ easyeda-reader.js  ← MAIN world: reads EasyEDA JS globals
│   │                        MutationObserver → auto-scan on edits
│   ├─ contentScript.js   ← 6-tab UI panel, live ERC badge, Agents tab
│   ├─ messageBridge.js   ← IPC abstraction (content ↔ background)
│   └─ panel.css          ← Dark theme (IBM Plex Sans KR)
│
├─ Popup (popup.html / popup.js)
│   └─ OpenAI API key input and storage
│
└─ Background Service Worker (background.js)  — ES module
    ├─ analyze_documents → structured document summary
    ├─ chat             → GPT-4o chat with schematic + doc context
    ├─ run_drc          → routes to ERCAgent
    └─ multi_agent      → Orchestrator pipeline → returns { plan, results, steps }
         │
         └─ agents/
              ├─ base.js           shared: callOpenAI, callOpenAIJson, helpers
              ├─ orchestrator.js   plans groups, runs parallel batches, passes context
              ├─ requirements.js   RequirementsAgent
              ├─ component.js      ComponentAgent
              ├─ erc.js            ERCAgent
              └─ layout.js         LayoutAgent

External
└─ OpenAI API (gpt-4o, json_object mode)

Optional Python Backend (pcb-schematic-api/)
├─ POST /api/v1/generate      → AI schematic generation
├─ POST /api/v1/erc           → Electrical rule check
├─ POST /api/v1/parts/search  → LCSC part search
└─ POST /api/v1/bom/jlcpcb   → JLCPCB BOM + CSV export
```

### Multi-Agent Execution Model

```
User goal
    │
    ▼
Orchestrator.plan()  ← LLM decides which agents to run + group order
    │
    ├─ Group 1 (sequential first): [requirements]
    │       ↓  output added to shared context
    ├─ Group 2 (parallel):         [component]  [erc]
    │       ↓  both outputs added to shared context
    └─ Group 3 (sequential last):  [layout]
                                        ↓
                               Aggregated results → UI
```

Each agent receives the **shared context object**, which accumulates the outputs of all previously completed agents. This means:
- `ComponentAgent` reads `requirementsResult` → knows exact power requirements
- `ERCAgent` reads uploaded documents + live schematic data
- `LayoutAgent` reads all three previous outputs → placement advice is grounded in real parts and actual ERC findings

### How Circuit Scanning Works

`easyeda-reader.js` runs in the page's **MAIN world** and reads EasyEDA's internal JavaScript globals — isolated content scripts cannot access these.

| Priority | Source | Covers |
|----------|--------|--------|
| 1 | `window.EasyEDA.core` | EasyEDA Standard |
| 2 | `window.EASYEDAPRO` | EasyEDA Pro |
| 3 | Redux store (`window.__store__`, etc.) | Both editions |
| 4 | DOM canvas detection | Editor presence only |
| 5 | SVG text label scraping | Fallback — ref designators + net names from rendered canvas |

Scan results are hashed (components + nets). If the hash is unchanged since the last ERC, the auto-ERC is skipped entirely.

---

## File Structure

```
easyeda-coach-extension/
├─ manifest.json          # MV3 config; background type: module
├─ background.js          # ES-module service worker; imports from agents/
├─ contentScript.js       # 6-tab UI, live badge, multi-agent results rendering
├─ easyeda-reader.js      # MAIN world: JS globals reader + MutationObserver
├─ messageBridge.js       # content ↔ background messaging abstraction
├─ panel.css              # Dark theme panel styles
├─ popup.html / popup.js  # API key settings popup
├─ icons/                 # Extension icons (16 / 48 / 128 px)
│
├─ agents/                # Multi-agent system
│   ├─ base.js            # Shared: callOpenAI, callOpenAIJson, helpers
│   ├─ orchestrator.js    # Plans pipeline; runs groups; passes shared context
│   ├─ requirements.js    # RequirementsAgent — extracts structured requirements
│   ├─ component.js       # ComponentAgent  — recommends parts + LCSC numbers
│   ├─ erc.js             # ERCAgent        — 10-rule electrical rule check
│   └─ layout.js          # LayoutAgent     — placement, routing, DFM guidance
│
└─ pcb-schematic-api/     # Optional Python FastAPI backend
    ├─ app/main.py
    ├─ app/services/
    │   ├─ ai_service.py
    │   ├─ erc_service.py
    │   ├─ jlcpcb_service.py
    │   └─ schematic_service.py
    └─ requirements.txt
```

---

## Optional Python Backend

```bash
cd pcb-schematic-api
pip install -r requirements.txt
cp .env.example .env   # add OPENAI_API_KEY
python run.py          # http://localhost:8000
```

Swagger docs at `http://localhost:8000/docs`.

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
| Extension | Vanilla JS (ES modules), Chrome MV3 |
| AI | OpenAI GPT-4o (`json_object` mode, temp 0.1–0.45 per agent) |
| Agent system | Custom multi-agent orchestrator with parallel group execution |
| UI | IBM Plex Sans KR, IBM Plex Mono |
| Backend (optional) | Python 3, FastAPI, Uvicorn, Pydantic v2 |


