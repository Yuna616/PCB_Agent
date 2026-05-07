# PCB Agent — EasyEDA Coach Extension

<img width="2866" height="1538" alt="Image" src="https://github.com/user-attachments/assets/54f4564b-8290-49b7-9c58-467701556ba0" />

A Chrome extension that provides real-time AI coaching while you design PCBs in EasyEDA.  
Guides you through the entire workflow — from schematic design to PCB layout and Gerber export.

---

## Features

### 💬 AI Coach
- Upload project documents and the AI analyzes them to provide step-by-step design guidance
- Specific recommendations for component selection (including LCSC part numbers), decoupling capacitor placement, and protection circuits
- Ask any question during the design process through a chat interface

### 🔍 Real-Time DRC / ERC
- **Circuit Scan**: Reads EasyEDA's internal state directly to detect components and nets
- **AI ERC**: Automatically checks 10 design rules
  - Floating pins (unconnected without NC marker)
  - Missing VCC pin decoupling (100nF + 10µF)
  - Missing GND symbol connections
  - No reverse polarity protection
  - No ESD protection on USB / CAN / external connectors
  - Missing pull-up resistors on I2C / RST / BOOT pins
  - Net name mismatches and unconnected nets
  - Missing power symbols, reset circuits, crystal load capacitors
- Results are categorized as 🔴 Error / ⚠️ Warning / ℹ️ Info, each with a specific fix suggestion

### 📂 Document Upload & Analysis
- Supports text-based files: `.txt`, `.json`, `.md`, `.csv`, `.ino`, `.sch`, `.kicad_*`, etc.
- Up to 20 files, 40,000 characters per file
- AI immediately analyzes uploads to extract power requirements, communication interfaces, and key components

### ✅ Design Checklist
- 8 schematic items (bypass capacitors, net labels, ESD protection, etc.)
- 8 PCB layout items (differential pair routing, ground plane, thermal vias, etc.)

### ⚡ Quick Questions
- One-click access to frequently asked questions about circuit review, component info, PCB layout, and final steps

---

## Installation

### Requirements
- Chrome 111 or later (required for MAIN world content script support)
- OpenAI API key (uses GPT-4o)

### Load the Extension

1. Clone this repository or download as ZIP.

```bash
git clone https://github.com/yourname/easyeda-coach-extension.git
```

2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the cloned folder

### Set Your API Key

1. Click the extension icon → enter your OpenAI API key in the popup
2. Click **Save**
3. Refresh your EasyEDA tab — the panel will appear on the right side

---

## Usage

### Basic Workflow

```
1. Open a project in EasyEDA
2. Go to the [📂 Docs] tab in the PCB Agent panel
3. Upload your project files (requirements, circuit description, etc.)
4. AI analyzes the files → view step-by-step guidance in the [💬 AI Coach] tab
5. Ask follow-up questions in the chat as you design
```

### DRC / ERC Check Workflow

```
1. Click the [🔍 DRC] tab
2. Click [📡 Scan Circuit] → reads current EasyEDA schematic state
3. Click [🔍 Run AI ERC] → checks 10 design rules automatically
4. Review results and apply the suggested fixes
```

> **Note**: Circuit scan only works when the EasyEDA editor tab is active.  
> ERC can also run based on uploaded files without a scan.

---

## Architecture

```
Chrome Browser
│
├─ EasyEDA Tab
│   ├─ easyeda-reader.js  ← MAIN world: reads EasyEDA JS globals directly
│   ├─ contentScript.js   ← 5-tab UI panel, user interaction
│   ├─ messageBridge.js   ← IPC abstraction between content and background
│   └─ panel.css          ← Dark theme UI (IBM Plex Sans KR)
│
├─ Popup (popup.html / popup.js)
│   └─ OpenAI API key input and storage
│
└─ Background Service Worker (background.js)
    ├─ analyze_documents  → Structured project analysis (JSON output)
    ├─ chat              → GPT-4o chat with schematic context
    └─ run_drc           → ERC/DRC rule check (structured JSON output)

External API
└─ OpenAI API (gpt-4o, temperature 0.2–0.45)

Optional Python Backend (pcb-schematic-api/)
├─ POST /api/v1/generate     → Generate schematic JSON
├─ POST /api/v1/erc          → Electrical rule check
├─ POST /api/v1/parts/search → LCSC part search
└─ POST /api/v1/bom/jlcpcb  → JLCPCB BOM generation
```

### How Circuit Scanning Works

`easyeda-reader.js` runs in the page's MAIN world and reads EasyEDA's JavaScript globals directly — something isolated content scripts cannot do.

| Priority | Method | Target |
|----------|--------|--------|
| 1 | `window.EasyEDA.core` | EasyEDA Standard |
| 2 | `window.EASYEDAPRO` | EasyEDA Pro |
| 3 | Redux store patterns | `window.__store__`, etc. |
| 4 | DOM detection | Checks for editor canvas element |

---

## File Structure

```
easyeda-coach-extension/
├─ manifest.json          # MV3 config, permissions, target URLs
├─ background.js          # Service worker: AI orchestration, system prompts
├─ contentScript.js       # 5-tab UI panel (Coach/Docs/DRC/Checklist/Quick)
├─ easyeda-reader.js      # MAIN world script: reads EasyEDA internal state
├─ messageBridge.js       # content ↔ background messaging abstraction
├─ panel.css              # Dark theme panel styles
├─ popup.html             # API key settings popup
├─ popup.js               # Popup logic
├─ icons/                 # Extension icons (16/48/128px)
└─ pcb-schematic-api/     # Optional Python FastAPI backend
    ├─ app/main.py
    ├─ app/services/
    │   ├─ ai_service.py
    │   ├─ schematic_service.py
    │   ├─ erc_service.py
    │   └─ jlcpcb_service.py
    └─ requirements.txt
```

---

## Optional Python Backend

Run the backend to enable advanced features like LCSC part search and BOM generation.

```bash
cd pcb-schematic-api
pip install -r requirements.txt
cp .env.example .env   # Set OPENAI_API_KEY
python run.py
```

Default URL: `http://localhost:8000`

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

- **Frontend**: Vanilla JavaScript (ES6+), Chrome MV3 Extension API
- **AI**: OpenAI GPT-4o
- **Styling**: IBM Plex Sans KR, IBM Plex Mono (Google Fonts)
- **Backend** (optional): Python 3, FastAPI, Uvicorn, Pydantic v2

---

## License

MIT License
