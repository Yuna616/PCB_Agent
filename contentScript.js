/**
 * PCB 에이전트 — 탭 기반 UI
 * 탭: AI 코치 / 문서 / 체크리스트 / 빠른질문
 */
(function () {
  "use strict";

  if (document.getElementById("pcb-agent-root")) return;

  const BRIDGE = window.PCBAgentBridge;
  if (!BRIDGE) {
    console.error("PCB_Agent: messageBridge.js must load first.");
    return;
  }

  const SEED_QUESTION =
    "업로드한 프로젝트 문서를 기준으로, EasyEDA 원리도에서 앞으로 어떤 순서로 무엇을 하면 좋은지 단계별로 알려 줘. " +
    "다음 항목을 반드시 포함해 줘: " +
    "1) 필요한 기능 블록 목록 (전원부, MCU, 통신, 센서 등), " +
    "2) 추천 부품 (IC 모델명, 저항·캐패시터 값, LCSC 부품번호 있으면 포함), " +
    "3) 각 IC의 데커플링 캐패시터 배치 지침, " +
    "4) 보호 회로 (역극성, ESD, 과전류), " +
    "5) 주요 넷 이름 지정 규칙, " +
    "6) PCB 레이아웃 시 주의사항 (트레이스 폭, 부품 배치 순서, 접지 플레인 전략).";

  // ── HTML 구조 ─────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "pcb-agent-root";
  root.innerHTML = `
    <div id="pcb-panel" class="pcb-panel">

      <!-- 헤더 -->
      <div class="pcb-header">
        <span class="pcb-logo">⬡ PCB 에이전트</span>
        <div class="pcb-header-actions">
          <button type="button" id="pcb-btn-min"   class="pcb-hbtn" title="최소화">─</button>
          <button type="button" id="pcb-btn-close" class="pcb-hbtn" title="닫기">✕</button>
        </div>
      </div>

      <!-- 탭 바 -->
      <div class="pcb-tabbar" role="tablist">
        <button class="pcb-tab pcb-tab--active" data-tab="chat"      role="tab">💬 AI 코치</button>
        <button class="pcb-tab"                 data-tab="docs"      role="tab">📂 문서</button>
        <button class="pcb-tab"                 data-tab="checklist" role="tab">✅ 체크리스트</button>
        <button class="pcb-tab"                 data-tab="quick"     role="tab">⚡ 빠른질문</button>
      </div>

      <!-- 상태바 -->
      <div id="pcb-status" class="pcb-status"></div>

      <!-- ── 탭: AI 코치 ── -->
      <div class="pcb-tabpane pcb-tabpane--active" id="pcb-pane-chat">
        <div id="pcb-chat-log" class="pcb-chat-log" aria-live="polite">
          <div class="pcb-chat-empty">
            <span>📂 문서 탭에서 프로젝트 파일을 업로드하면<br>AI가 설계 방법을 단계별로 안내합니다.</span>
          </div>
        </div>
        <div class="pcb-chat-input-row">
          <textarea id="pcb-chat-input" class="pcb-chat-input" rows="2"
            placeholder="궁금한 점을 입력하세요… (Shift+Enter 줄바꿈)"></textarea>
          <button type="button" id="pcb-chat-send" class="pcb-send-btn">전송</button>
        </div>
      </div>

      <!-- ── 탭: 문서 ── -->
      <div class="pcb-tabpane" id="pcb-pane-docs">
        <div class="pcb-docs-intro">
          텍스트 기반 프로젝트 파일을 올리면 AI가 분석 후 설계를 안내합니다.
        </div>
        <div class="pcb-file-actions">
          <input type="file" id="pcb-file-input" class="pcb-file-input-hidden" multiple
            accept="text/*,.txt,.json,.md,.csv,.log,.xml,.ino,.sch,.net,.lib,.pro,.kicad_pcb,.kicad_sch" />
          <label for="pcb-file-input" class="pcb-btn-primary">＋ 파일 추가</label>
          <button type="button" id="pcb-file-clear" class="pcb-btn-ghost">전체 제거</button>
        </div>
        <ul id="pcb-file-list" class="pcb-file-list"></ul>
        <p class="pcb-docs-note">최대 20개 · 파일당 40,000자까지 전송됩니다.</p>
      </div>

      <!-- ── 탭: 체크리스트 ── -->
      <div class="pcb-tabpane" id="pcb-pane-checklist">
        <div class="pcb-checklist-scroll">
          <div class="pcb-cl-section">
            <div class="pcb-cl-section-title">📐 스케매틱</div>
            <label class="pcb-cl-item"><input type="checkbox"><span>기능 블록별 구역 분리 (전원 / MCU / 통신 / 센서)</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>모든 IC에 바이패스 캐패시터 (100nF + 10µF)</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>모든 GND 핀에 GND 심볼 연결</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>넷 라벨로 주요 신호 명명 (3V3, CAN_H, SPI_CS 등)</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>풀업/풀다운 저항 배치 (RST, BOOT, I2C SDA/SCL)</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>ESD 보호 소자 (USB, CAN, 외부 커넥터 핀)</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>역극성 / 과전류 보호 (퓨즈, 쇼트키 다이오드)</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>DRC 에러 0개 확인</span></label>
          </div>
          <div class="pcb-cl-section">
            <div class="pcb-cl-section-title">🔲 PCB 레이아웃</div>
            <label class="pcb-cl-item"><input type="checkbox"><span>커넥터 → 전원 IC → MCU → 주변 소자 순 배치</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>바이패스 캐패시터 IC 핀 1 mm 이내 배치</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>접지 플레인 (Copper Pour) 전 보드 채우기</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>전류별 트레이스 폭 설정 (1A→0.5mm, 2A→1mm)</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>차동쌍 (USB D+/D−, CAN H/L) 동일 길이 라우팅</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>발열 부품에 Thermal Via 배치</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>DRC 에러 0개 확인</span></label>
            <label class="pcb-cl-item"><input type="checkbox"><span>Gerber 파일 생성 및 미리보기 확인</span></label>
          </div>
          <div class="pcb-cl-reset-row">
            <button type="button" id="pcb-cl-reset" class="pcb-btn-ghost pcb-cl-reset-btn">체크 초기화</button>
          </div>
        </div>
      </div>

      <!-- ── 탭: 빠른질문 ── -->
      <div class="pcb-tabpane" id="pcb-pane-quick">
        <div class="pcb-quick-scroll">
          <div class="pcb-quick-group-title">🔍 회로 검토</div>
          <button class="pcb-qbtn" data-q="현재 회로에서 빠진 보호 회로나 데커플링 캐패시터가 있으면 구체적으로 알려줘.">보호 회로 / 캐패시터 검토</button>
          <button class="pcb-qbtn" data-q="EMI/EMC 관점에서 현재 설계에서 주의해야 할 사항과 개선 방법을 알려줘.">EMI / EMC 검토</button>
          <button class="pcb-qbtn" data-q="전원 설계를 검토해줘. 레귤레이터 선택, 입출력 캐패시터, 전원 순서(Power Sequencing) 등을 포함해줘.">전원 설계 검토</button>

          <div class="pcb-quick-group-title">📦 부품 정보</div>
          <button class="pcb-qbtn" data-q="각 IC의 LCSC 부품번호와 EasyEDA 라이브러리 검색 키워드를 알려줘.">LCSC 부품번호 조회</button>
          <button class="pcb-qbtn" data-q="데커플링 캐패시터를 어떤 값으로, 어떤 위치에 몇 개 배치해야 하는지 IC별로 알려줘.">데커플링 캐패시터 가이드</button>
          <button class="pcb-qbtn" data-q="보호 소자 (TVS 다이오드, 폴리퓨즈, 쇼트키 다이오드) 선택 기준과 추천 부품을 알려줘.">보호 소자 추천</button>

          <div class="pcb-quick-group-title">📐 PCB 레이아웃</div>
          <button class="pcb-qbtn" data-q="PCB 레이아웃 시 부품 배치 순서와 각 단계에서 주의사항을 알려줘.">부품 배치 순서 가이드</button>
          <button class="pcb-qbtn" data-q="접지 플레인 설정 방법과 GND Via 배치 전략을 EasyEDA에서 어떻게 하면 좋은지 알려줘.">접지 플레인 / GND Via 전략</button>
          <button class="pcb-qbtn" data-q="트레이스 폭 계산 방법과 각 신호 종류별 (전원, 신호, 차동쌍) 권장 폭을 알려줘.">트레이스 폭 계산</button>
          <button class="pcb-qbtn" data-q="USB 또는 CAN 차동쌍 라우팅 방법을 EasyEDA에서 단계별로 설명해줘.">차동쌍 라우팅 방법</button>

          <div class="pcb-quick-group-title">📁 마무리</div>
          <button class="pcb-qbtn" data-q="Gerber 파일 생성 전 최종 체크리스트와 EasyEDA에서 생성하는 방법을 단계별로 알려줘.">Gerber 파일 생성 가이드</button>
          <button class="pcb-qbtn" data-q="EasyEDA에서 BOM(Bill of Materials)을 내보내는 방법과 JLCPCB에 발주하는 절차를 알려줘.">BOM 내보내기 / JLCPCB 발주</button>
        </div>
      </div>

    </div>

    <!-- 최소화 탭 -->
    <button type="button" id="pcb-restore-tab" class="pcb-restore-tab" style="display:none">⬡ PCB</button>
  `;
  document.body.appendChild(root);

  // ── DOM 참조 ────────────────────────────────────────────────────────────
  const panel      = root.querySelector("#pcb-panel");
  const restoreTab = root.querySelector("#pcb-restore-tab");
  const statusEl   = root.querySelector("#pcb-status");
  const fileInput  = root.querySelector("#pcb-file-input");
  const fileListEl = root.querySelector("#pcb-file-list");
  const chatLog    = root.querySelector("#pcb-chat-log");
  const chatInput  = root.querySelector("#pcb-chat-input");
  const chatSend   = root.querySelector("#pcb-chat-send");

  const MAX_UPLOAD_TEXT_PER_FILE = 40000;
  const MAX_REFERENCE_FILES = 20;

  /** @type {{ id: string, name: string, text: string }[]} */
  let referenceFiles = [];
  /** @type {object|null} */
  let documentAnalysisResult = null;
  /** @type {{ role: string, content: string }[]} */
  let chatMessages = [];
  let aiBusy = false;

  // ── 탭 전환 ─────────────────────────────────────────────────────────────
  root.querySelectorAll(".pcb-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", () => {
      root.querySelectorAll(".pcb-tab").forEach(t => t.classList.remove("pcb-tab--active"));
      root.querySelectorAll(".pcb-tabpane").forEach(p => p.classList.remove("pcb-tabpane--active"));
      tabEl.classList.add("pcb-tab--active");
      const pane = root.querySelector(`#pcb-pane-${tabEl.dataset.tab}`);
      if (pane) pane.classList.add("pcb-tabpane--active");
    });
  });

  // 빠른질문 버튼 클릭 시 AI 코치 탭으로 자동 이동
  function switchToChat() {
    root.querySelectorAll(".pcb-tab").forEach(t => t.classList.remove("pcb-tab--active"));
    root.querySelectorAll(".pcb-tabpane").forEach(p => p.classList.remove("pcb-tabpane--active"));
    root.querySelector('[data-tab="chat"]').classList.add("pcb-tab--active");
    root.querySelector("#pcb-pane-chat").classList.add("pcb-tabpane--active");
  }

  // ── 유틸 ────────────────────────────────────────────────────────────────
  function newRefId() {
    return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("pcb-status--err", !!isError);
    if (msg) {
      statusEl.style.display = "block";
      clearTimeout(statusEl._hideTimer);
      if (!isError) {
        statusEl._hideTimer = setTimeout(() => {
          statusEl.style.display = "none";
        }, 4000);
      }
    } else {
      statusEl.style.display = "none";
    }
  }

  function setAiBusy(busy) {
    aiBusy = !!busy;
    chatSend.disabled = aiBusy;
    chatInput.disabled = aiBusy;
    chatSend.textContent = aiBusy ? "…" : "전송";
    root.querySelectorAll(".pcb-qbtn").forEach(b => b.disabled = aiBusy);
  }

  function buildProjectContext() {
    return { documentAnalysis: documentAnalysisResult };
  }

  async function callAi(op, extra) {
    setStatus("AI 처리 중…");
    const res = await BRIDGE.send({ op, referenceFiles, ...extra });
    if (!res || !res.ok) throw new Error((res && res.error) || "브리지 오류");
    return res.result;
  }

  // ── 채팅 버블 렌더 (마크다운 간이 변환) ─────────────────────────────────
  function renderMarkdown(text) {
    return String(text)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      // 코드 블록
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="pcb-code">$1</pre>')
      // 인라인 코드
      .replace(/`([^`]+)`/g, '<code class="pcb-inline-code">$1</code>')
      // 굵게
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 번호 목록
      .replace(/^\d+\.\s+(.+)$/gm, '<div class="pcb-list-item pcb-list-num">$1</div>')
      // 불릿 목록
      .replace(/^[-•]\s+(.+)$/gm, '<div class="pcb-list-item">• $1</div>')
      // 줄바꿈
      .replace(/\n/g, '<br>');
  }

  function appendChatBubble(role, text) {
    // 첫 안내 메시지 제거
    const empty = chatLog.querySelector(".pcb-chat-empty");
    if (empty) empty.remove();

    const wrap = document.createElement("div");
    wrap.className = `pcb-bubble pcb-bubble--${role}`;
    if (role === "assistant") {
      wrap.innerHTML = renderMarkdown(text);
    } else {
      wrap.textContent = text;
    }
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // ── 파일 업로드 ──────────────────────────────────────────────────────────
  async function runUploadGuidance() {
    if (!referenceFiles.length) return;
    setAiBusy(true);
    try {
      documentAnalysisResult = await callAi("analyze_documents");
      chatMessages.push({ role: "user", content: SEED_QUESTION });
      appendChatBubble("user", "업로드한 문서 기준으로, 앞으로 EasyEDA에서 어떻게 진행하면 좋을지 알려 줘.");
      const result = await callAi("chat", { messages: chatMessages, projectContext: buildProjectContext() });
      const reply = result && result.reply ? String(result.reply) : "";
      chatMessages.push({ role: "assistant", content: reply });
      appendChatBubble("assistant", reply);
      setStatus("분석 완료! 아래 채팅에서 이어서 질문할 수 있습니다.");
      // 자동으로 AI 코치 탭으로 이동
      switchToChat();
    } catch (e) {
      documentAnalysisResult = null;
      const err = String(e.message || e);
      setStatus(err, true);
      appendChatBubble("assistant", `문서를 처리하지 못했습니다.\n${err}`);
    } finally {
      setAiBusy(false);
    }
  }

  function renderFileList() {
    if (!referenceFiles.length) {
      fileListEl.innerHTML = '<li class="pcb-file-empty">업로드된 파일 없음</li>';
      return;
    }
    fileListEl.innerHTML = referenceFiles.map(f => `
      <li class="pcb-file-item">
        <span class="pcb-file-icon">📄</span>
        <span class="pcb-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <button type="button" class="pcb-file-remove" data-remove="${escapeHtml(f.id)}" aria-label="제거">✕</button>
      </li>`).join("");
    fileListEl.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        referenceFiles = referenceFiles.filter(x => x.id !== btn.getAttribute("data-remove"));
        documentAnalysisResult = null;
        renderFileList();
        setStatus("파일을 제거했습니다.");
      });
    });
  }

  function readOneReferenceFile(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        let t = typeof reader.result === "string" ? reader.result : "";
        if (t.length > MAX_UPLOAD_TEXT_PER_FILE) {
          t = t.slice(0, MAX_UPLOAD_TEXT_PER_FILE) +
            `\n\n[파일이 커서 앞부분 ${MAX_UPLOAD_TEXT_PER_FILE.toLocaleString("ko-KR")}자만 사용합니다.]`;
        }
        referenceFiles.push({ id: newRefId(), name: file.name || "업로드", text: t });
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsText(file);
    });
  }

  // ── 채팅 전송 ────────────────────────────────────────────────────────────
  async function onChatSend() {
    if (aiBusy) return;
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    appendChatBubble("user", text);
    chatMessages.push({ role: "user", content: text });
    setAiBusy(true);
    try {
      const result = await callAi("chat", { messages: chatMessages, projectContext: buildProjectContext() });
      const reply = result && result.reply ? String(result.reply) : "";
      chatMessages.push({ role: "assistant", content: reply });
      appendChatBubble("assistant", reply);
      setStatus("");
    } catch (e) {
      chatMessages.pop();
      if (chatLog.lastChild) chatLog.removeChild(chatLog.lastChild);
      setStatus(String(e.message || e), true);
    } finally {
      setAiBusy(false);
    }
  }

  // ── 이벤트 바인딩 ────────────────────────────────────────────────────────
  chatSend.addEventListener("click", onChatSend);
  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onChatSend(); }
  });

  fileInput.addEventListener("change", async () => {
    const list = fileInput.files ? Array.from(fileInput.files) : [];
    fileInput.value = "";
    if (!list.length) return;
    const room = MAX_REFERENCE_FILES - referenceFiles.length;
    if (room <= 0) { setStatus(`파일은 최대 ${MAX_REFERENCE_FILES}개까지입니다.`, true); return; }
    const toAdd = list.slice(0, room);
    if (list.length > room) setStatus(`일부만 추가했습니다 (최대 ${MAX_REFERENCE_FILES}개).`);
    for (const f of toAdd) await readOneReferenceFile(f);
    renderFileList();
    await runUploadGuidance();
  });

  root.querySelector("#pcb-file-clear").addEventListener("click", () => {
    referenceFiles = [];
    documentAnalysisResult = null;
    if (fileInput) fileInput.value = "";
    renderFileList();
    setStatus("모든 파일을 제거했습니다.");
  });

  // 빠른질문 버튼
  root.querySelectorAll(".pcb-qbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = btn.getAttribute("data-q");
      if (!q || aiBusy) return;
      switchToChat();
      chatInput.value = q;
      onChatSend();
    });
  });

  // 체크리스트 초기화
  root.querySelector("#pcb-cl-reset").addEventListener("click", () => {
    root.querySelectorAll(".pcb-cl-item input").forEach(cb => cb.checked = false);
  });

  // 최소화 / 복구
  root.querySelector("#pcb-btn-min").addEventListener("click", () => {
    panel.style.display = "none";
    restoreTab.style.display = "flex";
  });
  restoreTab.addEventListener("click", () => {
    restoreTab.style.display = "none";
    panel.style.display = "flex";
  });
  root.querySelector("#pcb-btn-close").addEventListener("click", () => {
    root.style.display = "none";
  });

  // API key 갱신 메시지
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "api_key_updated") {
      setStatus("✅ API 키가 저장되었습니다.");
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });

  renderFileList();
  BRIDGE.ping().catch(() => {});
})();
