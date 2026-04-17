// EasyEDA PCB Coach - Content Script
// EasyEDA 페이지에 코칭 패널을 삽입합니다

(function () {
  if (document.getElementById("pcb-coach-panel")) return;

  const STORAGE_KEY = "pcp_session_v1";
  const MAX_STORED_MESSAGES = 36;
  const MAX_FILE_CHARS = 45000;
  const MAX_TOTAL_ATTACH_CHARS = 120000;

  // PCB Schematic API 엔드포인트 (로컬 FastAPI 서버)
  const SCHEMATIC_API_URL = "http://localhost:8000/api/v1/generate";

  const COACH_SYSTEM = `당신은 EasyEDA(표준/프로) **원리도(Schematic) 설계** 전용 코치입니다. PCB 동판 배치·동판 배선·DRC·실장은 다루지 않습니다. 필요하면 [선택 개선점]에서 한두 문장으로만 “원리도에서 풋프린트·값을 미리 정해 두면 좋다” 수준으로 짚습니다.

## EasyEDA 한국어 UI (필수)
- 사용자는 **에디터 메뉴·버튼이 한국어**로 표시된 EasyEDA를 쓴다고 가정합니다.
- **메뉴 경로, 도구 이름, 패널 이름, 대화상자 제목**은 영어(Place, Wire, File, Library 등)로 쓰지 마세요. **실제 한국어 UI에 나오는 표기**로만 적습니다.
- 스크린샷·사용자 설명에 보이는 한글 메뉴명이 있으면 **그대로** 따릅니다.
- 버전별 표기 차이가 있을 수 있으므로, 아래는 참고용이며 **화면과 다르면 화면의 한글 표기가 우선**입니다.
  - 상단 메뉴 예: **파일, 편집, 보기, 배치, 도구, 도움말** (표시되는 대로)
  - **배치** 하위·도구: **부품, 배선, 버스, 네트 라벨, 접지, VCC, 텍스트**, 도형/그리기 등
  - 좌측·패널: **프로젝트, 디자인 관리자, 공통 라이브러리, 라이브러리** 등
  - 검토·속성: **ERC**(또는 **전기 규칙 검사**), 참조번호·값·속성, 시트
- 단축키는 한국어 안내 뒤 **괄호로만** 병기(예: 상단 **배선** 도구 선택(단축키 W)).
- 부품 검색·데이터시트용 **영문 부품명·값(100nF, 10kΩ)** 은 그대로 쓰되, **클릭 경로와 메뉴 이름은 한국어**로만 설명합니다.

## 범위 (Schematic only)
- **다루는 것**: 심볼 배치, **배선·네트 라벨·버스·접지/VCC**, 접점, 미연결, 주석·참조번호·값, 시트, 라이브러리에서 **부품** 검색·배치, **ERC** 전 체크, 전원 트리·디커플링·수동소자(R/C/L/비드) 연결.
- **다루지 않는 것**: 동판 레이어, 선 폭·간격 규칙, 동판 자동 배선, 히트싱크, Gerber 등 PCB 전용.

## 역할
1. 회로 블록과 **시트 위 신호 흐름**을 짧게 정리합니다.
2. 화면·질문·첨부에서 **원리도 진행 단계**를 판단합니다.
3. **[다음에 할 일]**은 EasyEDA **원리도** 동작만 씁니다. 각 번호에 포함:
   - **무엇을**: **배치** 메뉴의 어떤 도구, 어떤 부품/심볼
   - **어떻게**: **한국어 메뉴 경로**(예: 상단 **배치** → **부품** / **배선** / **네트 라벨**)와 단축키 괄호 병기
   - **어디에**: IC **핀 번호**, **넷 이름**
4. **수동소자**는 역할, **값·개수**, **핀–넷**, 검색 키워드·패키지까지.
5. **원리도 품질**: 네트 라벨, 접지/전원 심볼, **ERC** 이슈를 [현재 상태]·[선택 개선점]에 구체적으로 적습니다.
6. 막연한 문장 금지. 이전 턴과 중복 금지.
7. 메시지에 **【사용자 프로젝트 목표·참고 자료】** 블록이 붙어 있으면, 회로 블록·부품 선택·우선 순위를 그 목표에 맞춥니다. 화면과 충돌하면 화면(원리도)을 우선하고 목표는 보조로 설명합니다.
8. **프로젝트 문서·기획서·BOM·요구사항·회로 메모**가 메시지에 첨부되거나, 시스템에 **【사용자 프로젝트 목표·참고 자료】**로 파일 내용이 포함되면:
   - 문서를 **항목별로 상세 분석**합니다(전원·MCU·센서·통신·커넥터·제약·수량).
   - 응답 **순서는 반드시**: (1) 문서에서 읽은 요약 → (2) **필요 부품을 먼저** 전부 나열·설명 → (3) **그다음** 원리도에서 **선(배선)을 어떤 순서로 연결할지** 단계별로 안내합니다. 부품을 나열하기 전에 배선만 먼저 쓰지 마세요.
   - 배선 안내는 **넷(신호) 단위 또는 전원 순서**(예: GND·VCC 트리 → MCU 전원·디커플링 → 클럭·리셋 → I2C 등)로 번호를 매기고, 각 단계마다 **어느 심볼의 몇 번 핀–어느 심볼의 몇 번 핀**(또는 **네트 라벨** 이름)을 적습니다. EasyEDA에서는 **배치** → **배선** 도구로 클릭 연결한다고 **한국어 UI**로 적습니다.
9. **설계 스테이지**: 이 프로젝트에 **어떤 단계(스테이지)가 필요한지** 먼저 구조로 잡고, **스테이지마다 무엇을 하면 되는지** [설계 스테이지]에 적습니다. 예시 스테이지(필요에 따라 추가·생략): **요구·블록 확정** → **부품·값 확정** → **시트에 심볼 배치** → **전원·접지·디커플링** → **클럭·리셋·부트** → **통신·입출력 배선** → **네트 라벨·가독성 정리** → **ERC·검토**. 각 스테이지마다 **목표**, **완료 조건**, **EasyEDA 한국어 메뉴로 할 일**을 구체적으로 씁니다.
10. **회로도를 그려 가며 코칭**(상세 설계서·BOM·블록도 **마크다운** 등 첨부 시 특히 필수): 확장 프로그램이 EasyEDA 캔버스에 자동으로 그림을 그리지는 않습니다. 대신 답변 안에 **마크다운 펜스 코드 블록**(\`\`\` 로 시작·끝)으로 **ASCII 원리도·미니 블록도**를 넣어, 사용자가 **문서와 같은 방식으로** 따라 그리며 배치·배선할 수 있게 합니다. 문서에 이미 큰 ASCII 다이어그램(예: Stage 0 입력 보호, Buck, Power MUX)이 있으면 **요약·발췌하거나**, 원리도 작업 단위로 **잘라서** 스테이지별 **미니 도면**으로 반복합니다. 각 ASCII 블록 직후에 **어떤 심볼을 **배치** → **배선**으로 옮기는지** 한국어 UI로 적습니다. 필요하면 같은 블록 옆에 **핀 번호·넷 이름**을 표로 적습니다.

## 출력 형식 (제목 줄 그대로, 본문 한국어)

**아래 여덟 개 섹션**을 모두 쓰세요. **문서가 없는 일반 질문**이면 [문서 분석 요약]은 "첨부 문서 없음" 등 한 줄, [필요 부품]·[배선·연결 순서]·[설계 스테이지]는 질문에 맞게 짧게 채우거나 "해당 없음" 한 줄로 둘 수 있습니다.

[프로젝트 요약]
(회로/목표가 하려는 일을 2~5문장)

[설계 스테이지]
(**필수.** 이 프로젝트에 필요한 **스테이지 목록**(스테이지 1, 2, 3… 이름 붙이기). 각 스테이지마다: **왜 필요한지**, **이 단계에서 끝내야 할 것(완료 조건)**, **EasyEDA에서 어떻게 진행할지**(한국어 메뉴·도구). 지금 사용자가 어느 스테이지쯤인지 [현재 상태]와 맞출 것.)

[문서 분석 요약]
(첨부·참고 자료가 있으면 **필수**: 문서에서 확인한 요구사항·스펙·부품표·전원·인터페이스를 **상세히** 정리. 없으면 한 줄.)

[필요 부품]
(**먼저 채우는 섹션.** 문서·목표 기준으로 필요한 부품을 **빠짐없이**. 각 항목: 이름·역할·수량·값/패키지·라이브러리 검색 키워드. 수동소자는 Ω·F·H까지. 표나 번호 목록 권장.)

[배선·연결 순서]
(**그다음 채우는 섹션.** **선 연결 순서** 1→2→3… 와 함께, 큰 회로는 **하위 블록마다** \`\`\` … \`\`\` 로 감싼 **ASCII 미니 원리도**를 넣어 시각적으로 코칭. 각 단계마다 출발 핀–도착 핀·넷 이름·**배치**→**배선**(한국어 UI).)

[현재 상태]
(지금 시트·문서 대비 부족한 점, 추정 ERC 이슈)

[다음에 할 일]
(EasyEDA **한국어 메뉴**로 **지금 당장** 할 일: 보통 **부품 배치**가 먼저면 **배치** → **부품**부터, 이후 **배선** 순서. 4~12개 번호 허용.)

[선택 개선점]
(ERC, 주석, RefDes, 기타)`;

  // ── 패널 HTML 생성 ──────────────────────────────────────────
  const panel = document.createElement("div");
  panel.id = "pcb-coach-panel";
  panel.innerHTML = `
    <div id="pcp-header">
      <div id="pcp-title">
        <span id="pcp-icon">⬡</span>
        <span>PCB Coach</span>
      </div>
      <div id="pcp-header-btns">
        <button type="button" id="pcp-project-btn" title="프로젝트 목표 보기·수정">목표</button>
        <button id="pcp-minimize" title="최소화">─</button>
        <button id="pcp-close" title="닫기">✕</button>
      </div>
    </div>

    <div id="pcp-body">
      <!-- 시작 시 프로젝트 목표 입력 -->
      <div id="pcp-onboarding" class="pcp-onboarding">
        <div class="pcp-onb-inner">
          <h3 class="pcp-onb-title">어떤 프로젝트를 만들고 싶으신가요?</h3>
          <!-- API 키 입력 구역 (키 없을 때만 표시) -->
          <div id="pcp-onb-api-section" style="display:none">
            <p class="pcp-onb-warn" style="margin-bottom:6px">⚙️ OpenAI API 키를 입력하면 바로 시작할 수 있습니다</p>
            <div class="pcp-onb-key-row">
              <input type="password" id="pcp-onb-key-input" class="pcp-onb-key-input" placeholder="sk-..." autocomplete="off" />
              <button type="button" id="pcp-onb-key-save" class="pcp-onb-key-save">저장</button>
            </div>
            <p id="pcp-onb-key-err" class="pcp-onb-err" style="display:none;margin-top:4px"></p>
          </div>
          <p id="pcp-onb-api-ok" class="pcp-onb-api-ok" style="display:none">✅ API 키 설정됨</p>
          <!-- 기존 경고 (숨김 대체) -->
          <p id="pcp-onb-api-warn" style="display:none"></p>

          <!-- 파일 업로드 드롭존 (주 입력) -->
          <div id="pcp-onb-dropzone" class="pcp-onb-dropzone">
            <div class="pcp-onb-drop-icon">📄</div>
            <p class="pcp-onb-drop-label">요구사항·BOM·설계 메모 파일을 드래그하거나 클릭해서 업로드</p>
            <p class="pcp-onb-drop-sub">.txt .md .csv .json .xml .c .h .py — 여러 개 가능</p>
            <input type="file" id="pcp-onb-file" multiple style="display:none"
              accept=".txt,.md,.markdown,.json,.csv,.html,.htm,.xml,.c,.h,.py,.log,.yaml,.yml" />
          </div>

          <!-- 업로드된 파일 칩 + 미리보기 -->
          <div id="pcp-onb-chips"></div>
          <div id="pcp-onb-preview-wrap" style="display:none">
            <div id="pcp-onb-preview-header">
              <span id="pcp-onb-preview-name"></span>
              <button type="button" id="pcp-onb-preview-close">✕</button>
            </div>
            <pre id="pcp-onb-preview-body"></pre>
          </div>

          <!-- 구분선 -->
          <div class="pcp-onb-divider"><span>또는 직접 입력</span></div>

          <!-- 텍스트 입력 (보조) -->
          <textarea id="pcp-onb-text" rows="3"
            placeholder="예: USB 5V 공급, ESP32, DHT22 온습도 센서, I2C OLED…"></textarea>

          <p id="pcp-onb-err" class="pcp-onb-err" style="display:none"></p>

          <div class="pcp-onb-btns">
            <button type="button" id="pcp-onb-skip" class="pcp-onb-secondary">나중에 입력</button>
            <button type="button" id="pcp-onb-start" class="pcp-onb-primary">이 내용으로 시작</button>
            <button type="button" id="pcp-onb-generate" class="pcp-onb-generate">⚡ 원리도 자동 생성</button>
          </div>
        </div>
      </div>

      <div id="pcp-main-workspace">
      <div id="pcp-project-bar" class="pcp-project-bar" style="display:none">
        <span class="pcp-project-bar-label">프로젝트</span>
        <span id="pcp-project-bar-text" class="pcp-project-bar-text"></span>
      </div>

      <!-- 원리도 자동 생성 결과 영역 -->
      <div id="pcp-gen-zone" style="display:none">
        <div id="pcp-gen-header">
          <span>⚡ AI 원리도 자동 생성 결과</span>
          <button type="button" id="pcp-gen-close">✕</button>
        </div>
        <div id="pcp-gen-tabs">
          <button class="pcp-gen-tab active" data-tab="ascii">ASCII 회로도</button>
          <button class="pcp-gen-tab" data-tab="bom">BOM</button>
          <button class="pcp-gen-tab" data-tab="json">Schematic JSON</button>
          <button class="pcp-gen-tab" data-tab="easyeda">EasyEDA JSON</button>
        </div>
        <div id="pcp-gen-content"></div>
        <div id="pcp-gen-actions">
          <button type="button" id="pcp-gen-copy">📋 복사</button>
          <button type="button" id="pcp-gen-download">💾 다운로드</button>
        </div>
      </div>

      <!-- 화면 분석 버튼 -->
      <div id="pcp-capture-zone">
        <button id="pcp-capture-btn">
          <span class="pcp-btn-icon">📷</span>
          <span>원리도 화면 분석</span>
        </button>
        <p id="pcp-capture-hint">시트에 보이는 대로 심볼·배선·네트·R/C/L까지 원리도만 단계별로 코칭합니다(AI 안내는 EasyEDA 한국어 메뉴 표기 기준)</p>
      </div>

      <div id="pcp-files-zone">
        <div id="pcp-files-row">
          <button type="button" id="pcp-file-btn" title="BOM·넷리스트·회로 메모 등 원리도와 관련된 텍스트">📎 파일 첨부</button>
          <button type="button" id="pcp-clear-btn" title="이 탭의 대화·첨부·저장 기록 초기화">기록 지우기</button>
        </div>
        <input type="file" id="pcp-file-input" multiple style="display:none" accept=".txt,.md,.markdown,.json,.js,.mjs,.cjs,.ts,.tsx,.jsx,.css,.scss,.html,.htm,.xml,.svg,.csv,.c,.cc,.cpp,.h,.hpp,.py,.rs,.go,.java,.kt,.toml,.yaml,.yml,.ini,.cfg,.properties,.env,.gitignore,.sh,.ps1,.bat,.cmd,.log" />
        <div id="pcp-file-chips"></div>
      </div>

      <!-- 대화창 -->
      <div id="pcp-messages"></div>

      <!-- 입력창 -->
      <div id="pcp-input-zone">
        <textarea id="pcp-input" placeholder="원리도 설계 질문… (예: 이 MCU 전원 핀 디커플링, Enter로 전송)" rows="2"></textarea>
        <button id="pcp-send-btn" title="전송">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>

      <div id="pcp-status"></div>
      </div><!-- /pcp-main-workspace -->
    </div>

    <!-- 최소화 탭 -->
    <div id="pcp-tab" style="display:none">
      <span>⬡</span> PCB Coach
    </div>
  `;

  document.body.appendChild(panel);

  // ── 상태 ───────────────────────────────────────────────────
  let isMinimized = false;
  let conversationHistory = [];
  let apiKey = "";
  let lastScreenshot = null;
  /** @type {{ name: string, text: string }[]} */
  let pendingAttachments = [];
  /** @type {{ text: string, files: { name: string, text: string }[], skipped?: boolean }} */
  let projectBrief = { text: "", files: [] };
  /** 온보딩 단계에서만 사용하는 첨부 */
  let onboardingFiles = [];

  document.getElementById("pcp-file-btn").addEventListener("click", () => {
    document.getElementById("pcp-file-input").click();
  });

  document.getElementById("pcp-file-input").addEventListener("change", async (e) => {
    const inputEl = e.target;
    const files = inputEl.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > 800000) {
        addMessage("system", `⚠️ 건너뜀(800KB 초과): ${file.name}`);
        continue;
      }
      try {
        const text = await readFileAsTextTruncated(file, MAX_FILE_CHARS);
        pendingAttachments.push({ name: file.name, text });
      } catch (err) {
        addMessage("system", `⚠️ 읽기 실패: ${file.name} — ${err.message || err}`);
      }
    }
    inputEl.value = "";
    updateFileChips();
  });

  document.getElementById("pcp-clear-btn").addEventListener("click", () => {
    conversationHistory = [];
    pendingAttachments = [];
    onboardingFiles = [];
    projectBrief = { text: "", files: [] };
    document.getElementById("pcp-messages").innerHTML = "";
    document.getElementById("pcp-file-chips").innerHTML = "";
    document.getElementById("pcp-onb-text").value = "";
    document.getElementById("pcp-onb-chips").innerHTML = "";
    try {
      if (chrome.storage.session) chrome.storage.session.remove(STORAGE_KEY);
    } catch (_) {}
    showOnboardingUI();
    updateProjectBar();
  });

  // ── 드롭존 클릭 ──
  document.getElementById("pcp-onb-dropzone").addEventListener("click", () => {
    document.getElementById("pcp-onb-file").click();
  });

  // ── 드래그 앤 드롭 ──
  const dropzone = document.getElementById("pcp-onb-dropzone");
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("pcp-onb-dropzone--over");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("pcp-onb-dropzone--over");
  });
  dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.classList.remove("pcp-onb-dropzone--over");
    const files = e.dataTransfer?.files;
    if (files?.length) await loadOnboardingFiles(Array.from(files));
  });

  // ── 파일 input change ──
  document.getElementById("pcp-onb-file").addEventListener("change", async (e) => {
    const files = e.target.files;
    if (files?.length) await loadOnboardingFiles(Array.from(files));
    e.target.value = "";
  });

  // ── 미리보기 닫기 ──
  document.getElementById("pcp-onb-preview-close").addEventListener("click", () => {
    document.getElementById("pcp-onb-preview-wrap").style.display = "none";
  });

  document.getElementById("pcp-onb-start").addEventListener("click", commitProjectStart);
  document.getElementById("pcp-onb-skip").addEventListener("click", skipProjectOnboarding);
  document.getElementById("pcp-project-btn").addEventListener("click", openProjectEditor);
  document.getElementById("pcp-onb-generate").addEventListener("click", onClickGenerateSchematic);

  /** 파일 배열을 읽어 onboardingFiles에 추가하고 UI를 갱신 */
  async function loadOnboardingFiles(fileList) {
    const errEl = document.getElementById("pcp-onb-err");
    for (const file of fileList) {
      if (file.size > 800_000) {
        if (errEl) { errEl.style.display = "block"; errEl.textContent = `⚠️ 건너뜀 (800KB 초과): ${file.name}`; }
        continue;
      }
      // 중복 방지
      if (onboardingFiles.find((f) => f.name === file.name)) continue;
      try {
        const text = await readFileAsTextTruncated(file, MAX_FILE_CHARS);
        onboardingFiles.push({ name: file.name, text });
      } catch (err) {
        if (errEl) { errEl.style.display = "block"; errEl.textContent = `⚠️ 읽기 실패: ${file.name}`; }
      }
    }
    updateOnboardingChips();
    // 첫 번째 파일 자동 미리보기
    if (onboardingFiles.length === 1) showFilePreview(onboardingFiles[0]);
  }

  function buildProjectContextForApi() {
    if (!projectBrief || projectBrief.skipped) return "";
    const t = (projectBrief.text || "").trim();
    const files = projectBrief.files || [];
    if (!t && !files.length) return "";
    let s = "\n\n【사용자 프로젝트 목표·참고 자료】\n";
    if (t) s += t + "\n";
    let total = 0;
    const cap = 25000;
    for (const f of files) {
      if (total >= cap) break;
      let body = f.text || "";
      const room = cap - total;
      if (body.length > room) body = body.slice(0, room) + "\n…(일부 생략)";
      s += "\n--- 파일: " + f.name + " ---\n" + body + "\n";
      total += body.length;
    }
    if (files.length) {
      s +=
        "\n【위 문서·파일 처리】**[설계 스테이지]**로 단계를 잡고, 문서를 상세 분석한 뒤 **[필요 부품]** → **[배선·연결 순서]** 순으로 안내하세요. 문서에 블록도·ASCII 도면이 있으면 이를 존중하고, 답변에도 **코드 블록(```) 안 ASCII 미니 원리도**로 단계별로 그려 가며 코칭하세요.\n";
    }
    return s;
  }

  function showMainWorkspace() {
    const onb = document.getElementById("pcp-onboarding");
    const main = document.getElementById("pcp-main-workspace");
    if (onb) onb.style.display = "none";
    if (main) {
      main.style.display = "flex";
      main.style.flexDirection = "column";
      main.style.flex = "1";
      main.style.minHeight = "0";
      main.style.overflow = "hidden";
    }
  }

  function showOnboardingUI() {
    const onb = document.getElementById("pcp-onboarding");
    const main = document.getElementById("pcp-main-workspace");
    if (onb) onb.style.display = "flex";
    if (main) main.style.display = "none";
  }

  function updateProjectBar() {
    const bar = document.getElementById("pcp-project-bar");
    const el = document.getElementById("pcp-project-bar-text");
    if (!bar || !el) return;
    if (projectBrief.skipped || (!(projectBrief.text || "").trim() && !(projectBrief.files || []).length)) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";
    let preview = (projectBrief.text || "").trim();
    if ((projectBrief.files || []).length) preview += (preview ? " · " : "") + "파일 " + projectBrief.files.length + "개";
    if (preview.length > 120) preview = preview.slice(0, 118) + "…";
    el.textContent = preview || "(요약 없음)";
  }

  function applyProjectBriefFromObject(pb) {
    if (!pb) return;
    projectBrief = {
      text: pb.text || "",
      files: Array.isArray(pb.files) ? pb.files.map((f) => ({ name: f.name, text: f.text || "" })) : [],
      skipped: !!pb.skipped,
    };
    updateProjectBar();
  }

  function showFilePreview(file) {
    const wrap = document.getElementById("pcp-onb-preview-wrap");
    const nameEl = document.getElementById("pcp-onb-preview-name");
    const bodyEl = document.getElementById("pcp-onb-preview-body");
    if (!wrap || !nameEl || !bodyEl) return;
    nameEl.textContent = file.name;
    // 미리보기는 최대 2000자
    const preview = file.text.length > 2000
      ? file.text.slice(0, 2000) + `\n…(총 ${file.text.length.toLocaleString()}자 중 일부 표시)`
      : file.text;
    bodyEl.textContent = preview;
    wrap.style.display = "flex";
  }

  function updateOnboardingChips() {
    const wrap = document.getElementById("pcp-onb-chips");
    if (!wrap) return;
    wrap.innerHTML = "";

    // 파일이 있으면 드롭존을 작게 축소
    const dz = document.getElementById("pcp-onb-dropzone");
    if (dz) dz.classList.toggle("pcp-onb-dropzone--compact", onboardingFiles.length > 0);

    onboardingFiles.forEach((a, i) => {
      const chip = document.createElement("span");
      chip.className = "pcp-chip";
      const lab = document.createElement("span");
      lab.className = "pcp-chip-name";
      // 파일명 클릭 → 미리보기
      lab.style.cursor = "pointer";
      lab.title = "클릭하면 내용 미리보기";
      lab.addEventListener("click", () => showFilePreview(onboardingFiles[i]));
      lab.textContent = a.name;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "pcp-chip-x";
      x.textContent = "×";
      x.addEventListener("click", () => {
        onboardingFiles = onboardingFiles.filter((_, j) => j !== i);
        updateOnboardingChips();
      });
      chip.append(lab, x);
      wrap.appendChild(chip);
    });
  }

  function commitProjectStart() {
    const ta = document.getElementById("pcp-onb-text");
    const text = (ta && ta.value ? ta.value : "").trim();
    if (!text && !onboardingFiles.length) {
      const err = document.getElementById("pcp-onb-err");
      if (err) {
        err.style.display = "block";
        err.textContent = "목표를 입력하거나 파일을 첨부해 주세요. 건너뛰려면 「나중에 입력」을 누르세요.";
      }
      return;
    }
    const errEl = document.getElementById("pcp-onb-err");
    if (errEl) {
      errEl.style.display = "none";
      errEl.textContent = "";
    }
    projectBrief = {
      text,
      files: onboardingFiles.map((a) => ({ name: a.name, text: a.text })),
      skipped: false,
    };
    onboardingFiles = [];
    document.getElementById("pcp-onb-chips").innerHTML = "";
    if (ta) ta.value = "";
    saveSession();
    showMainWorkspace();
    updateProjectBar();
    addMessage("system", "✅ 프로젝트 목표가 저장되었습니다. 이후 코칭·분석에 반영됩니다.");
  }

  function skipProjectOnboarding() {
    projectBrief = { text: "", files: [], skipped: true };
    onboardingFiles = [];
    document.getElementById("pcp-onb-chips").innerHTML = "";
    const ta = document.getElementById("pcp-onb-text");
    if (ta) ta.value = "";
    saveSession();
    showMainWorkspace();
    updateProjectBar();
    addMessage("system", "상단 「목표」에서 언제든지 프로젝트 내용을 입력할 수 있습니다.");
  }

  function openProjectEditor() {
    const ta = document.getElementById("pcp-onb-text");
    if (ta) ta.value = (projectBrief.text || "").trim() ? projectBrief.text : "";
    onboardingFiles = (projectBrief.files || []).map((f) => ({ name: f.name, text: f.text }));
    updateOnboardingChips();
    showOnboardingUI();
  }

  // ── API 키 + 세션 복원 ─────────────────────────────────────
  chrome.storage.sync.get(["openai_api_key"], (result) => {
    apiKey = result.openai_api_key || "";
    const readSession = (cb) => {
      if (chrome.storage.session) chrome.storage.session.get([STORAGE_KEY], cb);
      else cb({});
    };
    readSession((sess) => {
      const raw = sess[STORAGE_KEY];
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch (_) {}
      }

      const legacySession = parsed && Array.isArray(parsed.history) && parsed.history.length && parsed.projectBrief === undefined;
      const pb = parsed && parsed.projectBrief;
      const hasProject =
        pb &&
        (pb.skipped || (pb.text && String(pb.text).trim()) || (Array.isArray(pb.files) && pb.files.length > 0));

      if (pb) {
        applyProjectBriefFromObject(pb);
      } else if (legacySession) {
        projectBrief = { text: "", files: [], skipped: true };
      } else {
        projectBrief = { text: "", files: [] };
      }

      const msgsEl = document.getElementById("pcp-messages");
      msgsEl.innerHTML = "";

      const needOnboarding = !legacySession && !hasProject;

      if (needOnboarding) {
        showOnboardingUI();
      } else {
        showMainWorkspace();
        updateProjectBar();
      }

      applyApiKeyUiState(!!apiKey);

      if (parsed && Array.isArray(parsed.history) && parsed.history.length) {
        conversationHistory = parsed.history.filter((m) => m && (m.role === "user" || m.role === "assistant"));
        if (!needOnboarding) {
          conversationHistory.forEach((m) => {
            const text = typeof m.content === "string" ? m.content : "(저장된 복합 메시지)";
            addMessage(m.role, text);
          });
          addMessage("system", "💾 이 브라우저 탭에서 저장된 대화를 불러왔습니다.");
        }
      }

      if (!apiKey) {
        if (!needOnboarding) {
          addMessage("system", "⚙️ 먼저 확장 아이콘을 클릭해서 OpenAI API 키를 설정해주세요.");
        }
      } else if (!needOnboarding && !conversationHistory.length) {
        addMessage("system", "✅ 준비 완료! 「원리도 화면 분석」 또는 질문으로 시작하세요.");
      }

      msgsEl.scrollTop = msgsEl.scrollHeight;
    });
  });

  // ── UI 이벤트 ──────────────────────────────────────────────
  document.getElementById("pcp-minimize").addEventListener("click", () => {
    isMinimized = true;
    document.getElementById("pcp-body").style.display = "none";
    document.getElementById("pcp-minimize").style.display = "none";
    document.getElementById("pcp-tab").style.display = "flex";
    panel.style.width = "auto";
    panel.style.height = "auto";
  });

  document.getElementById("pcp-tab").addEventListener("click", () => {
    isMinimized = false;
    document.getElementById("pcp-body").style.display = "flex";
    document.getElementById("pcp-minimize").style.display = "inline-flex";
    document.getElementById("pcp-tab").style.display = "none";
    panel.style.width = "";
    panel.style.height = "";
  });

  document.getElementById("pcp-close").addEventListener("click", () => {
    panel.remove();
  });

  // 드래그
  let dragging = false, ox = 0, oy = 0;
  document.getElementById("pcp-header").addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    dragging = true;
    ox = e.clientX - panel.offsetLeft;
    oy = e.clientY - panel.offsetTop;
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - ox)) + "px";
    panel.style.top = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - oy)) + "px";
    panel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => (dragging = false));

  // 화면 분석 버튼
  document.getElementById("pcp-capture-btn").addEventListener("click", captureAndAnalyze);

  // 질문 전송
  document.getElementById("pcp-send-btn").addEventListener("click", sendQuestion);
  document.getElementById("pcp-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });

  // ── 인라인 API 키 저장 버튼 ──────────────────────────────
  document.getElementById("pcp-onb-key-save").addEventListener("click", () => {
    const keyInput = document.getElementById("pcp-onb-key-input");
    const keyErr   = document.getElementById("pcp-onb-key-err");
    const key = (keyInput.value || "").trim();
    if (!key) {
      keyErr.textContent = "API 키를 입력해 주세요.";
      keyErr.style.display = "block";
      return;
    }
    if (!key.startsWith("sk-")) {
      keyErr.textContent = "올바른 OpenAI API 키 형식이 아닙니다 (sk-로 시작해야 함).";
      keyErr.style.display = "block";
      return;
    }
    keyErr.style.display = "none";
    chrome.storage.sync.set({ openai_api_key: key }, () => {
      apiKey = key;
      applyApiKeyUiState(true);
    });
  });

  document.getElementById("pcp-onb-key-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("pcp-onb-key-save").click();
  });

  /** API 키 설정 여부에 따라 온보딩 패널 UI를 동기화 */
  function applyApiKeyUiState(hasKey) {
    const section = document.getElementById("pcp-onb-api-section");
    const okBadge = document.getElementById("pcp-onb-api-ok");
    if (section) section.style.display = hasKey ? "none" : "block";
    if (okBadge) okBadge.style.display = hasKey ? "block" : "none";
  }

  // 설정 변경 감지 (popup 또는 다른 탭에서 저장 시)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.openai_api_key) {
      apiKey = changes.openai_api_key.newValue || "";
      applyApiKeyUiState(!!apiKey);
      if (apiKey) {
        // 메인 워크스페이스가 표시 중이면 채팅에도 알림
        const main = document.getElementById("pcp-main-workspace");
        if (main && main.style.display !== "none") {
          addMessage("system", "✅ API 키가 저장되었습니다.");
        }
      }
    }
  });

  // popup에서 키 저장 시 직접 메시지 수신 (storage.onChanged 보완)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === "api_key_updated" && msg.key) {
      apiKey = msg.key;
      applyApiKeyUiState(true);
    }
  });

  /** 확장 API 캡처가 막힐 때(권한/포커스 등): 사용자 제스처로 화면 공유 폴백 */
  async function captureViaDisplayMedia() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("이 브라우저는 화면 공유 캡처를 지원하지 않습니다.");
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", cursor: "never" },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
    } catch {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    }
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("화면 공유 미리보기 로드 시간이 초과되었습니다.")), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(t);
        video.play().then(resolve, reject);
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error("화면 공유 영상을 재생할 수 없습니다."));
      };
    });

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      track.stop();
      throw new Error("캡처 해상도를 읽을 수 없습니다.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      track.stop();
      throw new Error("캔버스를 초기화할 수 없습니다.");
    }
    ctx.drawImage(video, 0, 0);
    track.stop();
    video.srcObject = null;

    return canvas.toDataURL("image/png");
  }

  async function captureVisibleToDataUrl() {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ action: "capture_tab" });
    } catch (e) {
      response = { error: e && e.message ? e.message : String(e) };
    }

    if (response?.dataUrl) return response.dataUrl;

    const detail =
      response?.error ||
      (response === undefined
        ? "확장 프로그램에서 응답이 없습니다. chrome://extensions 에서 확장을 다시 로드해 보세요."
        : null);

    addMessage(
      "system",
      "탭 캡처를 건너뜁니다: " + (detail || "알 수 없는 오류") + " — 화면 공유로 다시 시도합니다."
    );

    try {
      return await captureViaDisplayMedia();
    } catch (e) {
      const msg = e && e.name === "NotAllowedError" ? "화면 공유가 거부되었습니다." : e && e.message ? e.message : "화면 공유 실패";
      const extra = detail ? ` (탭 캡처: ${detail})` : "";
      throw new Error(msg + extra);
    }
  }

  // ── 화면 캡처 & 분석 ────────────────────────────────────────
  async function captureAndAnalyze() {
    if (!apiKey) {
      addMessage("system", "⚙️ API 키를 먼저 설정해주세요 (확장 아이콘 클릭)");
      return;
    }

    setStatus("화면 캡처 중...", true);
    document.getElementById("pcp-capture-btn").disabled = true;

    try {
      lastScreenshot = await captureVisibleToDataUrl();
      const base64 = lastScreenshot.split(",")[1];

      setStatus("원리도 분석 중...", true);
      addMessage("user", "📷 [원리도 화면 분석]");

      const prompt = `이 이미지는 **EasyEDA 원리도 시트**(한국어 UI)라고 가정하고 답하세요.

- **모든 메뉴·도구 이름은 한국어 UI 표기만** 사용하세요(영어 Place/Wire/File 등 금지). 스크린샷에 보이는 한글 메뉴가 있으면 그대로 따르세요.
- 화면이 **PCB/동판**이면 [현재 상태]에 "PCB 화면"이라고 한 줄 적고, **같은 회로의 원리도에서** 확인할 항목만 [다음에 할 일]에 옮기세요. 동판 라우팅·레이어 조언은 하지 마세요.
- 원리도면이면 보이는 **심볼·핀·배선·네트 라벨·접지/VCC·접점·값·참조번호**를 근거로 판단하세요.

**세부 코칭**:
- 저항·캡·인덕터·비드: 역할, 값, 개수, 핀–넷, 라이브러리 검색어.
- 가독성: 긴 난선 대신 **네트 라벨**, **접지**/전원 심볼.
- 다음 조작: **배치** 메뉴 기준 **한국어**(예: **배치** → **배선**, **배치** → **부품**, **배치** → **네트 라벨**)와 단축키 괄호 병기.
- 복잡한 블록은 답변에 \`\`\` … \`\`\` 로 **ASCII 미니 원리도**를 넣어 단계별로 코칭(시스템 지침과 동일).

시스템에 프로젝트 문서·목표가 있으면 반영하세요. **여덟 섹션** 출력 형식을 따릅니다. 화면만 볼 때는 [문서 분석 요약]에 "화면 기준" 등, **[설계 스테이지]**에는 이 회로에 맞는 단계(예: 전원·배치·배선·ERC)와 **지금 화면이 어느 스테이지쯤인지**를 적습니다.

반드시 아래 제목을 그대로 쓰고 한국어로 채우세요.

[프로젝트 요약]
[설계 스테이지]
[문서 분석 요약]
[필요 부품]
[배선·연결 순서]
[현재 상태]
[다음에 할 일]
[선택 개선점]`;

      const reply = await callOpenAIVision(base64, prompt);
      addMessage("assistant", reply);

      // 히스토리에 추가 (이미지 포함)
      conversationHistory.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: lastScreenshot, detail: "high" } },
          { type: "text", text: "EasyEDA 원리도만 기준으로, 메뉴·도구명은 한국어 UI 표기만 사용해 주세요(배치→배선, 네트 라벨, 접지 등). 저항·캡·인덕터 값·핀·넷까지 단계별로 코칭. PCB 동판은 제외." }
        ]
      });
      conversationHistory.push({ role: "assistant", content: reply });
      saveSession();

    } catch (err) {
      addMessage("system", `❌ 오류: ${err.message}`);
    } finally {
      setStatus("", false);
      document.getElementById("pcp-capture-btn").disabled = false;
    }
  }

  // ── 질문 전송 ──────────────────────────────────────────────
  async function sendQuestion() {
    const input = document.getElementById("pcp-input");
    const question = input.value.trim();
    const attachBlock = buildAttachmentsBlock();
    if (!question && !attachBlock) return;
    if (!apiKey) {
      addMessage("system", "⚙️ API 키를 먼저 설정해주세요");
      return;
    }

    const hadFiles = pendingAttachments.length > 0;
    let apiUserContent;
    if (attachBlock && question) {
      apiUserContent = `${question}\n\n[사용자 첨부 파일]${attachBlock}\n\n【응답 지침】첨부를 **상세히 분석**한 뒤 출력 형식: [설계 스테이지] → [문서 분석 요약] → **[필요 부품]** → **[배선·연결 순서]**(블록마다 \`\`\`ASCII 미니 원리도\`\`\` 포함) → 나머지. 설계서 스타일(예: 캐리어보드 MD의 Stage·ASCII 블록)이 있으면 **같은 방식으로** 단계별 도식을 이어 그리며 코칭. PCB 동판 제외.`;
    } else if (attachBlock) {
      apiUserContent = `아래 **프로젝트·회로 문서**만으로 답하세요. PCB 동판은 제외.

【필수 순서】
1) **[설계 스테이지]**: 어떤 단계가 필요한지 나열하고, **스테이지마다** 목표·완료 조건·EasyEDA에서 할 일(한국어 UI).
2) 문서를 항목별로 **상세 분석**([문서 분석 요약]).
3) **[필요 부품]**에 부품을 **먼저** 전부 나열·설명(역할·수량·값·검색 키워드).
4) **[배선·연결 순서]**에 **선 연결 순서**와 함께, **하위 블록마다** 마크다운 \`\`\` 코드 펜스 \`\`\` 로 **ASCII 미니 원리도**를 넣어 그림을 그려 가며 코칭.
5) 이후 [프로젝트 요약]·[현재 상태]·[다음에 할 일]·[선택 개선점]을 채웁니다.
불명확하면 확인 질문은 1~2개만.${attachBlock}`;
    } else {
      apiUserContent = question;
    }

    const displayUser = question || "(첨부 파일 분석 요청)";

    input.value = "";
    addMessage("user", displayUser + (hadFiles ? "\n📎 파일 첨부" : ""));
    setStatus("답변 생성 중...", true);

    conversationHistory.push({ role: "user", content: apiUserContent });

    try {
      const reply = await callOpenAIChat(conversationHistory);
      conversationHistory.push({ role: "assistant", content: reply });
      addMessage("assistant", reply);
      if (hadFiles) {
        pendingAttachments = [];
        updateFileChips();
      }
      saveSession();
    } catch (err) {
      addMessage("system", `❌ 오류: ${err.message}`);
      conversationHistory.pop();
    } finally {
      setStatus("", false);
    }
  }

  // ── OpenAI API 호출 (Vision) ──────────────────────────────
  async function callOpenAIVision(base64Image, prompt) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 4000,
        messages: [
          {
            role: "system",
            content: COACH_SYSTEM + buildProjectContextForApi(),
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}`, detail: "high" } },
              {
                type: "text",
                text:
                  prompt +
                  (buildProjectContextForApi()
                    ? "\n\n(시스템 지침에 포함된 프로젝트 목표·첨부를 반드시 반영해 답하세요.)"
                    : ""),
              },
            ],
          },
        ]
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `API 오류 ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  // ── OpenAI API 호출 (Chat) ────────────────────────────────
  async function callOpenAIChat(history) {
    const messages = [
      {
        role: "system",
        content: COACH_SYSTEM + buildProjectContextForApi(),
      },
      ...history
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 4000,
        messages
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `API 오류 ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  // ── 첨부·세션 ─────────────────────────────────────────────
  function readFileAsTextTruncated(file, maxChars) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        let t = typeof reader.result === "string" ? reader.result : "";
        if (t.length > maxChars) {
          t = t.slice(0, maxChars) + "\n\n…(이후 생략)";
        }
        resolve(t);
      };
      reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
      reader.readAsText(file, "UTF-8");
    });
  }

  function buildAttachmentsBlock() {
    if (!pendingAttachments.length) return "";
    let total = 0;
    const parts = [];
    for (const a of pendingAttachments) {
      if (total >= MAX_TOTAL_ATTACH_CHARS) break;
      const room = MAX_TOTAL_ATTACH_CHARS - total;
      let body = a.text;
      if (body.length > room) {
        body = body.slice(0, Math.max(0, room - 100)) + "\n\n…(첨부 분량 제한으로 잘림)";
      }
      parts.push(`\n\n--- 파일: ${a.name} ---\n${body}`);
      total += body.length;
    }
    return parts.join("");
  }

  function updateFileChips() {
    const el = document.getElementById("pcp-file-chips");
    if (!el) return;
    el.innerHTML = "";
    pendingAttachments.forEach((a, i) => {
      const chip = document.createElement("span");
      chip.className = "pcp-chip";
      const lab = document.createElement("span");
      lab.className = "pcp-chip-name";
      lab.textContent = a.name;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "pcp-chip-x";
      x.setAttribute("aria-label", "첨부 제거");
      x.textContent = "×";
      x.addEventListener("click", () => {
        pendingAttachments = pendingAttachments.filter((_, j) => j !== i);
        updateFileChips();
      });
      chip.append(lab, x);
      el.appendChild(chip);
    });
  }

  function historyToStorable() {
    return conversationHistory
      .map((m) => {
        if (typeof m.content === "string") return { role: m.role, content: m.content };
        if (Array.isArray(m.content)) {
          const hasImage = m.content.some((c) => c && c.type === "image_url");
          if (hasImage) {
            return {
              role: m.role,
              content: "[이전 메시지: 화면 이미지 — 세션에는 텍스트 요약만 저장됩니다]",
            };
          }
          return { role: m.role, content: JSON.stringify(m.content) };
        }
        return { role: m.role, content: String(m.content ?? "") };
      })
      .slice(-MAX_STORED_MESSAGES);
  }

  function saveSession() {
    if (!chrome.storage.session) return;
    try {
      chrome.storage.session.set({
        [STORAGE_KEY]: JSON.stringify({
          history: historyToStorable(),
          projectBrief: {
            text: projectBrief.text || "",
            files: (projectBrief.files || []).map((f) => ({ name: f.name, text: f.text || "" })),
            skipped: !!projectBrief.skipped,
          },
          savedAt: Date.now(),
        }),
      });
    } catch (_) {}
  }

  // ── 헬퍼 함수 ─────────────────────────────────────────────
  function addMessage(role, text) {
    const msgs = document.getElementById("pcp-messages");
    const div = document.createElement("div");
    div.className = `pcp-msg pcp-msg-${role}`;

    if (role === "assistant") {
      div.innerHTML = simpleMarkdown(text);
    } else {
      div.textContent = text;
    }

    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setStatus(text, loading) {
    const el = document.getElementById("pcp-status");
    el.textContent = text;
    el.className = loading ? "pcp-loading" : "";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatMdProse(s) {
    if (!s) return "";
    let h = escapeHtml(s);
    h = h.replace(/^## (.+)$/gm, '<span class="pcp-md-h2">$1</span>');
    h = h.replace(
      /\[(프로젝트 요약|설계 스테이지|문서 분석 요약|필요 부품|배선·연결 순서|현재 상태|다음에 할 일|선택 개선점)\]/g,
      '<strong class="pcp-section-label">[$1]</strong>'
    );
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/^(\d+)\. /gm, "<b>$1.</b> ");
    return h.replace(/\n/g, "<br>");
  }

  // ── 원리도 자동 생성 ──────────────────────────────────────
  let _genResult = null; // 마지막 생성 결과 캐시
  let _genActiveTab = "ascii";

  async function onClickGenerateSchematic() {
    const errEl = document.getElementById("pcp-onb-err");
    const clearErr = () => { if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; } };
    const showErr = (msg) => { if (errEl) { errEl.style.display = "block"; errEl.textContent = msg; } };

    const ta = document.getElementById("pcp-onb-text");
    const description = (ta && ta.value ? ta.value : "").trim();
    const hasFiles = onboardingFiles.length > 0;

    // ── 입력 검증 ──
    if (!hasFiles && !description) {
      showErr("파일을 업로드하거나 프로젝트 설명을 입력해 주세요.");
      return;
    }
    if (!apiKey) {
      showErr("OpenAI API 키가 필요합니다. 툴바 아이콘(⬡)에서 먼저 설정해 주세요.");
      return;
    }

    clearErr();

    // ── 버튼 로딩 ──
    const btn = document.getElementById("pcp-onb-generate");
    btn.disabled = true;
    const srcLabel = hasFiles
      ? `${onboardingFiles.length}개 파일 분석 중…`
      : "설명 분석 중…";
    btn.textContent = `⏳ ${srcLabel}`;

    // ── API 요청 바디 구성 ──
    // 파일이 있으면 attached_files로 전달 (주 소스)
    // 텍스트가 있으면 description으로 전달 (보조 또는 단독)
    const requestBody = {
      api_key: apiKey,
      options: {
        output_formats: ["schematic_json", "easyeda_json", "bom", "ascii"],
        language: "ko",
        detail_level: "full",
      },
    };

    if (hasFiles) {
      requestBody.attached_files = onboardingFiles.map((f) => ({
        name: f.name,
        content: f.text,
      }));
    }
    if (description) {
      requestBody.description = description;
    }

    try {
      const resp = await fetch(SCHEMATIC_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || err.error || `HTTP ${resp.status}`);
      }

      _genResult = await resp.json();

      // 온보딩 완료 → 메인 워크스페이스 전환
      projectBrief = {
        text: description || onboardingFiles.map((f) => f.name).join(", "),
        files: onboardingFiles.map((f) => ({ name: f.name, text: f.text })),
        skipped: false,
      };
      onboardingFiles = [];
      if (ta) ta.value = "";
      document.getElementById("pcp-onb-preview-wrap").style.display = "none";
      saveSession();
      showMainWorkspace();
      updateProjectBar();

      showGenerateResult(_genResult);

      // 채팅에도 요약 표시
      const srcInfo = hasFiles
        ? `파일: ${requestBody.attached_files.map((f) => f.name).join(", ")}`
        : "텍스트 설명";
      addMessage(
        "assistant",
        `✅ 원리도 자동 생성 완료! (소스: ${srcInfo})\n\n**${_genResult.project_summary || ""}**\n\n상단 탭에서 ASCII 회로도, BOM, EasyEDA JSON을 확인하세요.`
      );

    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        showErr("❌ API 서버에 연결할 수 없습니다. pcb-schematic-api 서버를 먼저 실행하세요. (python run.py)");
      } else {
        showErr(`❌ 생성 실패: ${msg}`);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "⚡ 원리도 자동 생성";
    }
  }

  function showGenerateResult(result) {
    const zone = document.getElementById("pcp-gen-zone");
    if (!zone) return;
    zone.style.display = "flex";
    zone.style.flexDirection = "column";

    // 탭 전환
    document.querySelectorAll(".pcp-gen-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".pcp-gen-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        _genActiveTab = tab.dataset.tab;
        renderGenTab(_genActiveTab, result);
      });
    });

    // 닫기
    const closeBtn = document.getElementById("pcp-gen-close");
    if (closeBtn) closeBtn.onclick = () => { zone.style.display = "none"; };

    // 복사
    const copyBtn = document.getElementById("pcp-gen-copy");
    if (copyBtn) copyBtn.onclick = () => {
      const content = document.getElementById("pcp-gen-content");
      navigator.clipboard.writeText(content.innerText || content.textContent || "")
        .then(() => { copyBtn.textContent = "✅ 복사됨"; setTimeout(() => { copyBtn.textContent = "📋 복사"; }, 2000); })
        .catch(() => {});
    };

    // 다운로드
    const dlBtn = document.getElementById("pcp-gen-download");
    if (dlBtn) dlBtn.onclick = () => downloadGenResult(result, _genActiveTab);

    renderGenTab("ascii", result);
  }

  function renderGenTab(tab, result) {
    const el = document.getElementById("pcp-gen-content");
    if (!el) return;

    if (tab === "ascii") {
      el.innerHTML = result.ascii_diagram
        ? `<pre class="pcp-schematic pcp-gen-pre">${escapeHtml(result.ascii_diagram)}</pre>`
        : "<p>ASCII 다이어그램이 없습니다.</p>";

    } else if (tab === "bom") {
      if (!result.bom || !result.bom.length) {
        el.innerHTML = "<p>BOM 데이터가 없습니다.</p>";
        return;
      }
      let html = '<table class="pcp-bom-table"><thead><tr>'
        + "<th>Ref</th><th>값</th><th>설명</th><th>패키지</th><th>수량</th><th>카테고리</th><th>검색 키워드</th>"
        + "</tr></thead><tbody>";
      for (const item of result.bom) {
        html += `<tr><td>${escapeHtml(item.ref)}</td><td>${escapeHtml(item.value)}</td><td>${escapeHtml(item.description)}</td>`
          + `<td>${escapeHtml(item.package)}</td><td>${item.quantity}</td><td>${escapeHtml(item.category)}</td>`
          + `<td>${escapeHtml(item.search_keyword)}</td></tr>`;
      }
      html += "</tbody></table>";
      el.innerHTML = html;

    } else if (tab === "json") {
      el.innerHTML = result.schematic_json
        ? `<pre class="pcp-schematic pcp-gen-pre">${escapeHtml(JSON.stringify(result.schematic_json, null, 2))}</pre>`
        : "<p>Schematic JSON이 없습니다.</p>";

    } else if (tab === "easyeda") {
      el.innerHTML = result.easyeda_json
        ? `<pre class="pcp-schematic pcp-gen-pre">${escapeHtml(JSON.stringify(result.easyeda_json, null, 2))}</pre>`
        : "<p>EasyEDA JSON이 없습니다.</p>";
    }
  }

  function downloadGenResult(result, tab) {
    let content = "";
    let filename = "schematic";
    let type = "text/plain";

    if (tab === "ascii") {
      content = result.ascii_diagram || "";
      filename = "schematic-ascii.txt";
    } else if (tab === "bom") {
      if (result.bom) {
        const headers = ["Ref", "Value", "Description", "Package", "Qty", "Category", "SearchKeyword"];
        const rows = result.bom.map((b) =>
          [b.ref, b.value, b.description, b.package, b.quantity, b.category, b.search_keyword]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        );
        content = [headers.join(","), ...rows].join("\n");
        filename = "bom.csv";
        type = "text/csv";
      }
    } else if (tab === "json") {
      content = JSON.stringify(result.schematic_json, null, 2);
      filename = "schematic.json";
      type = "application/json";
    } else if (tab === "easyeda") {
      content = JSON.stringify(result.easyeda_json, null, 2);
      filename = "easyeda-schematic.json";
      type = "application/json";
    }

    if (!content) return;
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** 마크다운 펜스(```) 안은 ASCII 회로도용 등고정폭으로 표시 */
  function simpleMarkdown(text) {
    const raw = String(text);
    const fence = /```(\w*)\r?\n([\s\S]*?)```/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = fence.exec(raw)) !== null) {
      out += formatMdProse(raw.slice(last, m.index));
      out += '<pre class="pcp-schematic" spellcheck="false">' + escapeHtml(m[2]) + "</pre>";
      last = m.index + m[0].length;
    }
    out += formatMdProse(raw.slice(last));
    return out;
  }
})();
