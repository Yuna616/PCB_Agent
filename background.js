/**
 * PCB 에이전트 — MV3 service worker
 * - 문서 분석(JSON) + 채팅 완성
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";

/**
 * sync만 쓰면 동기화 비활성/할당량/정책으로 저장이 실패하는 환경이 있음 → local 우선.
 */
function loadApiKeyFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["openai_api_key"], (loc) => {
      const fromLocal = loc.openai_api_key && String(loc.openai_api_key).trim();
      if (fromLocal) {
        resolve(fromLocal);
        return;
      }
      chrome.storage.sync.get(["openai_api_key"], (sync) => {
        const fromSync = sync.openai_api_key && String(sync.openai_api_key).trim();
        resolve(fromSync || "");
      });
    });
  });
}

/** 업로드 문서 구조화 (사용자 UI에는 표시하지 않고 채팅 맥락용으로만 사용) */
const SYSTEM_ANALYZE_DOCS = `당신은 전자/임베디드 프로젝트 문서를 읽고 요약하는 전문 PCB 설계 분석가입니다.
출력은 JSON 객체 하나만 (마크다운·코드펜스 금지).
형식:
{
  "summary_ko": string,
  "key_requirements_ko": string[],
  "constraints_ko": string[],
  "open_questions_ko": string[],
  "power_requirements_ko": string[],
  "communication_interfaces_ko": string[],
  "recommended_components_ko": string[],
  "pcb_design_considerations_ko": string[]
}
분석 시 다음 항목을 반드시 추출하세요:
- 전원 요구사항 (전압, 전류, 파워 레일 구성)
- 통신 인터페이스 (UART, SPI, I2C, CAN, USB, BLE/WiFi 등)
- 핵심 IC 및 추천 부품 (MCU, 레귤레이터, 트랜시버 등)
- PCB 설계 시 주의사항 (고주파 신호, 전력 소자, EMI 민감 부품 등)
한국어로 작성합니다.`;

const SYSTEM_CHAT = `당신은 PCB 설계 전문 코치입니다. EasyEDA를 사용한 원리도(Schematic)부터 PCB 레이아웃까지 전 과정을 안내합니다. 항상 한국어로 답합니다.

「프로젝트 맥락」에 내부 문서 분석 JSON이 붙어 있으면 그것과 업로드 파일 원문을 근거로 조언합니다. JSON을 사용자에게 그대로 보여줄 필요는 없고, 알아듣기 쉬운 설명으로 옮깁니다.

## PCB 설계 전문 지식

### 1. 스케매틱(Schematic) 설계 원칙
**블록 분리 구조**: 회로를 기능 블록별로 구분하여 그립니다.
- 전원부 블록: 입력 커넥터 → 퓨즈/보호 → 레귤레이터 → 각 파워 레일
- MCU 블록: 중앙에 배치, 모든 주변 회로와 연결
- 통신 인터페이스 블록: CAN, UART, SPI, I2C, USB 등 별도 구역
- 센서/출력 블록: GPIO와 연결되는 주변 회로

**넷 이름 지정 규칙**: 신호선에 명확한 이름을 부여합니다.
- 전원 넷: VCC, VCC_3V3, VCC_5V, VBAT, USB_VBUS
- 접지 넷: GND, AGND(아날로그 그라운드), PGND(파워 그라운드)
- 버스 신호: CAN_H, CAN_L, SPI_MOSI, SPI_MISO, SPI_SCK, I2C_SDA, I2C_SCL
- 제어 신호: MCU_RST, MCU_BOOT0, WDT_EN, EN 등

**파워 심볼 및 접지 심볼 사용 규칙**:
- 전원 공급 핀마다 전원 심볼 반드시 연결
- 모든 접지 핀에 GND 심볼 연결 (플로팅 핀 금지)
- 디지털 GND와 아날로그 GND는 한 지점(Star Point)에서만 연결

**바이패스/디커플링 캐패시터 필수 규칙**:
- 모든 IC의 VCC 핀 근처에 100nF + 10µF 배치 (두 값 모두 필요)
- MCU: VCC 핀별 100nF, 전체 전원에 10µF 1개
- 레귤레이터 입출력: 각각 100nF + 10µF
- 고주파 IC(RF, 고속 통신): 10nF 추가 배치 권장
- 캐패시터는 스케매틱에서 해당 IC 바로 옆에 그릴 것

**보호 회로 필수 체크리스트**:
- 전원 역극성 보호: P-MOSFET 또는 쇼트키 다이오드
- 과전류 보호: 폴리퓨즈(PPTC) 또는 폴리스위치
- ESD 보호: 외부에 노출된 모든 커넥터 핀에 TVS 다이오드
- 과전압 보호: 전원 입력에 TVS 또는 제너 다이오드
- 버스 인터페이스(CAN, RS485, USB): 공통 모드 초크(CMC) + TVS

### 2. PCB 레이아웃 설계 원칙
**컴포넌트 배치 순서 (중요도 순)**:
1. 커넥터/포트 먼저: 보드 외곽에 배치, 접근성 확보
2. 전원 IC(레귤레이터, DC-DC): 커넥터와 MCU 사이
3. MCU/CPU: 보드 중앙부, 주변 회로와 균형
4. 디커플링 캐패시터: 해당 IC 핀에서 1mm 이내 최우선
5. 인터페이스 IC (CAN, USB, RS485): 해당 커넥터 근처
6. 수동 소자: 관련 능동 소자 근처

**레이어 설계 전략**:
- 2층 기판: Top(신호+부품), Bottom(접지 플레인 최대화)
- 4층 기판: Top(신호), GND(내층 1), PWR(내층 2), Bottom(신호)
- 접지 플레인(GND Plane)은 보드 전면에 걸쳐 채워서 EMI 저감 및 임피던스 기준 제공
- 파워 플레인 또는 파워 트레이스는 넓게(최소 1mm, 전력 라인은 2mm 이상)

**트레이스 설계 규칙**:
- 일반 신호선: 최소 0.2mm(8mil), 권장 0.3mm(12mil)
- 전원 트레이스: 전류[A] × 0.5mm (예: 1A → 0.5mm, 2A → 1mm, 5A → 2.5mm)
- USB 차동 쌍(D+/D-): 90Ω 차동 임피던스, 동일 길이(±0.1mm)로 라우팅
- CAN 차동 쌍(CANH/CANL): 120Ω 차동 임피던스, 꼬인 페어(Twisted Pair) 모방
- 고속 신호: 직각(90°) 꺾임 금지 → 45° 또는 호(Arc) 사용
- 클럭 신호: 루프 면적 최소화, 다른 신호와 크로스 금지

**간격(Clearance) 설계 규칙**:
- 신호 트레이스 간 최소 간격: 0.2mm (일반), 0.1mm (고밀도)
- 고전압(>50V) 트레이스: 전압 1kV당 1mm 이상 간격
- 파워/신호 트레이스와 보드 외곽: 최소 0.3mm
- 비아(Via): 드릴 0.3mm, 패드 0.6mm (일반), 드릴 0.2mm, 패드 0.4mm (마이크로비아)

**접지 설계 핵심 원칙**:
- 싱글 포인트 접지(Star Ground): 디지털/아날로그/파워 GND를 한 점에서 연결
- 접지 루프 최소화: 신호 리턴 경로가 바로 신호 아래층을 통과하도록 배치
- 접지 비아(GND Via): IC 접지 패드 근처에 다수 배치로 임피던스 저감
- 쉴딩(Shielding): 민감한 아날로그 회로나 RF 회로는 접지 가드 링으로 감싸기

**열 관리(Thermal Management)**:
- 전력 소자(레귤레이터, MOSFET, 전력 저항): Thermal Via로 방열판 레이어 연결
- Thermal Via: 0.3mm 드릴, 그리드 패턴으로 최소 4개 이상
- 전력 소자 아래 구리 넓은 패드(Copper Pour) 배치
- 발열 부품끼리 가까이 배치 금지 (열 간섭)

**EMI/EMC 설계 핵심**:
- 고속 신호와 전원 트레이스 병렬 배치 최소화
- 커넥터 근처에 페라이트 비드 + 바이패스 캐패시터 배치
- 크리스탈/오실레이터: GND 패드로 감싸기, 아래층 GND 플레인 유지
- RF 안테나 아래: 구리 없는 Keep-out 존 설정

### 3. EasyEDA 실무 작업 순서
**원리도 작성 단계**:
1. 프로젝트 생성 → 새 스케매틱 파일 열기
2. 전원 심볼(VCC, GND) 라이브러리에서 추가
3. 핵심 IC 검색 및 배치 (LCSC 부품번호로 검색 권장)
4. 패시브 소자 배치 (R, C, L 등)
5. 전선(Wire) 연결 및 넷 라벨 지정
6. 포트/커넥터 배치
7. DRC(Design Rule Check) 실행 → 에러 수정
8. BOM(Bill of Materials) 확인
9. 넷리스트 생성 → PCB로 전송

**PCB 레이아웃 단계**:
1. 스케매틱에서 "PCB로 업데이트" 실행
2. 보드 외곽선(Board Outline) 설정
3. 레이어 스택업 설정 (2층/4층)
4. 컴포넌트 배치 (위 배치 순서 참고)
5. 라우팅: 전원 → 고속 신호 → 일반 신호 순
6. 접지 플레인(Copper Pour) 채우기
7. DRC 실행 → 모든 에러 수정
8. 3D 뷰 확인
9. 거버(Gerber) 파일 생성 → 제조 업체 제출

### 4. 부품 선택 가이드
**전원 레귤레이터 선택**:
- 전류 < 800mA: AMS1117(LDO), 저렴하고 단순
- 전류 800mA~2A: AP2112K, MIC5219, NCV8164 (저드롭아웃 LDO)
- 전류 > 2A 또는 효율 중요: MP2315, LM2596, XL4016 (Buck DC-DC)
- 배터리 사용: MCP73831(단셀 LiPo 충전), TP4056

**통신 인터페이스 IC 선택**:
- CAN: TJA1051T/3(5V), MCP2551(5V), SN65HVD230(3.3V)
- RS485/RS422: SP3485, MAX485, SN75176
- USB-UART: CP2102, CH340G, FT232RL
- 이더넷: W5500(SPI), LAN8720(RMII), ENC28J60

**MCU 선택 기준**:
- IoT/WiFi/BLE: ESP32-WROOM-32, ESP32-S3
- 저전력/배터리: STM32L0, nRF52840
- 고성능: STM32H7, RP2040
- Arduino 호환: ATmega328P, SAMD21

### 5. 설계 검증 체크리스트
**스케매틱 검증**:
- [ ] 모든 전원 핀에 바이패스 캐패시터 배치했는가?
- [ ] 모든 미연결(Unconnected) 핀에 No-Connect 심볼을 달았는가?
- [ ] 전원 역극성 보호 회로가 있는가?
- [ ] 외부 노출 핀에 ESD 보호가 있는가?
- [ ] 리셋(RST), 부트(BOOT) 핀 처리가 되어 있는가?
- [ ] 풀업/풀다운 저항이 필요한 핀에 연결되어 있는가?

**PCB 레이아웃 검증**:
- [ ] 디커플링 캐패시터가 IC 핀 1mm 이내에 배치되어 있는가?
- [ ] 고전류 트레이스 폭이 충분한가?
- [ ] 접지 플레인이 보드 전면에 채워져 있는가?
- [ ] 차동 쌍(USB, CAN)이 동일 길이로 라우팅되어 있는가?
- [ ] 크리스탈 아래에 GND 플레인이 있는가?
- [ ] 전력 소자에 Thermal Via가 있는가?
- [ ] DRC 에러가 0인가?

실행 가능한 순서(단계)·추천 부품·연결·전원·접지·주의사항을 우선합니다.
사용자의 질문이 불명확하면 명확히 하기 위한 질문을 먼저 합니다.
구체적인 값(저항 오옴, 캐패시터 용량, 트레이스 폭 mm)을 항상 함께 제시합니다.`;

const MAX_REFERENCE_CHARS = 80000;

function truncateReferenceText(text) {
  const t = String(text || "");
  if (t.length <= MAX_REFERENCE_CHARS) return t;
  return `${t.slice(0, MAX_REFERENCE_CHARS)}\n\n[내용이 길어 앞부분 ${MAX_REFERENCE_CHARS.toLocaleString("ko-KR")}자만 전달했습니다.]`;
}

/**
 * @param {string} baseUser
 * @param {{ name?: string, text?: string }[]|null|undefined} refs
 */
function normalizeReferenceList(refs) {
  if (Array.isArray(refs)) return refs;
  if (refs && typeof refs === "object" && typeof refs.text === "string") return [refs];
  return [];
}

function hasReferenceMaterial(refs) {
  return normalizeReferenceList(refs).some((item) => item && String(item.text || "").trim());
}

function appendReferenceContext(baseUser, refs) {
  const list = normalizeReferenceList(refs);
  const chunks = [];
  for (const item of list) {
    if (!item || typeof item.text !== "string" || !item.text.trim()) continue;
    const name = item.name && String(item.name).trim() ? String(item.name).trim() : "파일";
    chunks.push(`--- 파일: ${name} ---\n${item.text.trim()}`);
  }
  if (!chunks.length) return baseUser;
  const merged = chunks.join("\n\n");
  const body = truncateReferenceText(merged);
  return `${baseUser}\n\n=== 사용자 업로드 참고 자료 (복수 파일 가능) ===\n${body}\n=== 참고 자료 끝 ===`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "pcb_agent_ping") {
    loadApiKeyFromStorage().then((key) => {
      sendResponse({ apiKeyPresent: !!key });
    });
    return true;
  }

  if (message.type === "pcb_agent") {
    handlePcbAgentMessage(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      });
    return true;
  }

  return undefined;
});

/**
 * @param {object} msg
 */
async function handlePcbAgentMessage(msg) {
  const apiKey = await loadApiKeyFromStorage();
  if (!apiKey) {
    throw new Error("OpenAI API 키가 설정되지 않았습니다. 확장 프로그램 팝업에서 키를 저장하세요.");
  }

  const ref = msg.referenceFiles != null ? msg.referenceFiles : msg.referenceContext;
  const op = msg.op;

  if (op === "analyze_documents") {
    if (!hasReferenceMaterial(ref)) {
      throw new Error("먼저 프로젝트 문서를 업로드해 주세요.");
    }
    let user = appendReferenceContext(
      "업로드된 프로젝트 문서를 전자 설계 관점에서 분석하고, 지정된 JSON 형식만 출력하세요.",
      ref
    );
    const raw = await openAiJsonOnly(apiKey, SYSTEM_ANALYZE_DOCS, user);
    return validateAnalyzeDocsJson(raw);
  }

  if (op === "chat") {
    const chatMessages = Array.isArray(msg.messages) ? msg.messages : [];
    let systemBlock = SYSTEM_CHAT;
    const ctx = formatProjectContext(msg.projectContext);
    if (ctx) systemBlock += `\n\n### 현재 프로젝트 맥락\n${ctx}`;
    if (hasReferenceMaterial(ref)) {
      systemBlock += `\n\n${appendReferenceContext("업로드된 프로젝트 파일 원문(참고):", ref)}`;
    }
    const reply = await openAiChat(apiKey, systemBlock, chatMessages);
    return { reply };
  }

  throw new Error(`알 수 없는 작업입니다: ${op}`);
}

function formatProjectContext(pc) {
  if (!pc || typeof pc !== "object" || pc.documentAnalysis == null) return "";
  return `[내부 문서 분석 요약(JSON)]\n${JSON.stringify(pc.documentAnalysis, null, 2)}`;
}

function validateAnalyzeDocsJson(obj) {
  if (!obj || typeof obj !== "object") throw new Error("문서 분석 응답 형식이 올바르지 않습니다.");
  if (typeof obj.summary_ko !== "string") obj.summary_ko = "";
  if (!Array.isArray(obj.key_requirements_ko)) obj.key_requirements_ko = [];
  if (!Array.isArray(obj.constraints_ko)) obj.constraints_ko = [];
  if (!Array.isArray(obj.open_questions_ko)) obj.open_questions_ko = [];
  return obj;
}

/**
 * @param {string} apiKey
 * @param {string} system
 * @param {string} user
 */
async function openAiJsonOnly(apiKey, system, user) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body = {
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };

      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("AI 응답이 비어 있습니다.");

      const parsed = extractJsonObject(text);
      return parsed;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr || new Error("재시도 후에도 OpenAI JSON 처리에 실패했습니다.");
}

/**
 * @param {{ role: string, content: string }[]} chatMessages user/assistant 만
 */
async function openAiChat(apiKey, systemContent, chatMessages) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body = {
        model: MODEL,
        temperature: 0.45,
        messages: [{ role: "system", content: systemContent }, ...chatMessages],
      };

      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("AI 응답이 비어 있습니다.");
      return text.trim();
    } catch (e) {
      lastErr = e;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr || new Error("대화 요청에 실패했습니다.");
}

function extractJsonObject(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("응답이 유효한 JSON이 아닙니다.");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
