/**
 * PCB_Agent — schematic execution layer for EasyEDA.
 *
 * EasyEDA does not expose a stable public JS API to extensions. This module:
 * 1) Maintains a virtual circuit mirror (always works)
 * 2) Probes optional editor globals / hooks when present (best-effort)
 * 3) Provides templates + simple auto-layout helpers
 */
(function () {
  "use strict";

  const VIRTUAL_KEY = "__PCB_AGENT_VIRTUAL__";
  const GRID = 40;
  const ORIGIN_X = 120;
  const ORIGIN_Y = 160;

  /** @type {{ components: object[], connections: object[], log: string[] }} */
  function getVirtual() {
    if (!window[VIRTUAL_KEY]) {
      window[VIRTUAL_KEY] = {
        components: [],
        connections: [],
        log: [],
      };
    }
    return window[VIRTUAL_KEY];
  }

  function logLine(msg) {
    const v = getVirtual();
    v.log.push(`${new Date().toISOString()} ${msg}`);
    if (v.log.length > 200) v.log.shift();
    /* eslint-disable no-console */
    console.info("[PCB_Agent]", msg);
  }

  /**
   * Map abstract types to EasyEDA library search hints (user may place manually).
   * Real UUID/symbol IDs are tenant-specific — we store hints only.
   * Each entry includes: query, package, lcsc (LCSC part number), decoupling hint,
   * layout_tip (PCB 배치 팁), and trace_width (권장 트레이스 폭 mm).
   */
  const TYPE_LIBRARY_HINT = Object.freeze({
    // ── MCU / SoC ──────────────────────────────────────────────────────────
    ESP32:        { query: "ESP32-WROOM-32", package: "module",      lcsc: "C701341",  decoupling: ["100nF×4","10µF×1"], layout_tip: "안테나 방향을 보드 외곽으로. 아래 GND 플레인 유지." },
    ESP32_WROOM:  { query: "ESP32-WROOM-32", package: "module",      lcsc: "C701341",  decoupling: ["100nF×4","10µF×1"], layout_tip: "RF 영역에 구리 없는 Keep-out 설정 필수." },
    ESP32_S3:     { query: "ESP32-S3-WROOM", package: "module",      lcsc: "C2913202", decoupling: ["100nF×6","10µF×2"], layout_tip: "USB_D+/D- 차동 쌍 90Ω 라우팅, 길이 매칭." },
    STM32F103:    { query: "STM32F103C8T6",  package: "LQFP-48",     lcsc: "C8734",    decoupling: ["100nF×5","10µF×1"], layout_tip: "BOOT0 핀 10k 풀다운. NRST에 100nF." },
    STM32F4:      { query: "STM32F405RGT6",  package: "LQFP-64",     lcsc: "C11484",   decoupling: ["100nF×8","4.7µF×2"], layout_tip: "VCAP 핀에 2.2µF 세라믹 필수." },
    ATMEGA328:    { query: "ATmega328P-AU",  package: "TQFP-32",     lcsc: "C14877",   decoupling: ["100nF×2","10µF×1"], layout_tip: "AVCC와 VCC 분리, AVCC에 LC 필터." },
    RP2040:       { query: "RP2040",          package: "QFN-56",       lcsc: "C2040",    decoupling: ["100nF×6","10µF×2"], layout_tip: "USB_D+/D- 90Ω 차동, QSPI 플래시 옆에 배치." },
    // ── 전원 레귤레이터 ────────────────────────────────────────────────────
    "LDO_3.3V":   { query: "AMS1117-3.3",    package: "SOT-223",      lcsc: "C6186",    decoupling: ["IN:100nF+10µF","OUT:100nF+10µF"], layout_tip: "입출력 캐패시터를 IC 핀에서 1mm 이내 배치. Thermal Via 2개 이상." },
    LDO_3_3V:     { query: "AMS1117-3.3",    package: "SOT-223",      lcsc: "C6186",    decoupling: ["IN:100nF+10µF","OUT:100nF+10µF"], layout_tip: "출력 캐패시터는 전해 또는 탄탈 10µF 사용." },
    AMS1117_3_3:  { query: "AMS1117-3.3",    package: "SOT-223",      lcsc: "C6186",    decoupling: ["IN:100nF+10µF","OUT:100nF+10µF"], layout_tip: "최대 800mA. 그 이상이면 AP2112K 또는 Buck 고려." },
    AP2112K:      { query: "AP2112K-3.3",    package: "SOT-25",       lcsc: "C51118",   decoupling: ["IN:1µF","OUT:1µF"], layout_tip: "초소형, 600mA. 스마트워치급 소형 보드에 적합." },
    LDO_5V:       { query: "L7805",          package: "TO-220",       lcsc: "C55498",   decoupling: ["IN:330nF","OUT:100nF"], layout_tip: "방열판 또는 Thermal Via 필수. 드롭아웃 2V 유의." },
    BUCK_5V:      { query: "MP2315",         package: "TSOT-23-8",    lcsc: "C16457",   decoupling: ["IN:10µF+100nF","OUT:22µF"], layout_tip: "인덕터를 SW 핀 1mm 이내에 배치. 접지 플레인 아래에 루프 최소화." },
    BUCK_3_3V:    { query: "XL1509-3.3E1",  package: "SOP-8",        lcsc: "C61349",   decoupling: ["IN:47µF","OUT:47µF"], layout_tip: "고전류 트레이스 2mm 이상. 열화상 카메라로 발열 확인 권장." },
    MCP73831:     { query: "MCP73831",       package: "SOT-23-5",     lcsc: "C14879",   decoupling: ["VDD:4.7µF"], layout_tip: "PROG 핀 저항으로 충전 전류 설정: I=1000/R(kΩ) mA." },
    TP4056:       { query: "TP4056",         package: "SOP-8",        lcsc: "C16581",   decoupling: ["VCC:10µF"], layout_tip: "LED 연결 시 CHRG/STBY 핀 10k 풀업. 배터리 보호 IC 추가 권장." },
    // ── 통신 인터페이스 ────────────────────────────────────────────────────
    CAN_TRANSCEIVER: { query: "TJA1050",    package: "SOIC-8",       lcsc: "C5962",    decoupling: ["VCC:100nF"], layout_tip: "CANH/CANL 트레이스 120Ω 차동. 버스 끝단 120Ω 종단 저항. TVS 다이오드 필수." },
    TJA1051:      { query: "TJA1051T",      package: "SO-8",         lcsc: "C7376",    decoupling: ["VCC:100nF"], layout_tip: "3.3V 동작 가능. CANH/CANL 동일 길이 ±0.5mm." },
    SN65HVD230:   { query: "SN65HVD230",   package: "SOIC-8",       lcsc: "C7267",    decoupling: ["VCC:100nF"], layout_tip: "3.3V 전용 CAN 트랜시버. RS 핀 접지 시 고속 모드." },
    MAX3232:      { query: "MAX3232",        package: "SOIC-16",      lcsc: "C9951",    decoupling: ["C1~C4:100nF"], layout_tip: "차지 펌프 캐패시터를 IC 핀 근처에 배치. ±15kV ESD 내장." },
    SP3485:       { query: "SP3485",         package: "SO-8",         lcsc: "C9633",    decoupling: ["VCC:100nF"], layout_tip: "RE/DE 핀을 MCU GPIO로 제어. 종단 저항 120Ω 필요." },
    CP2102:       { query: "CP2102",         package: "QFN-28",       lcsc: "C6568",    decoupling: ["VDD:4.7µF+100nF"], layout_tip: "USB D+/D- 22Ω 직렬 저항. USB_VBUS에 500mA 폴리퓨즈." },
    CH340G:       { query: "CH340G",         package: "SOIC-16",      lcsc: "C14267",   decoupling: ["VCC:100nF","V3:4.7µF"], layout_tip: "V3 핀 4.7µF 세라믹 캐패시터 필수. 저렴하고 드라이버 호환성 양호." },
    FT232RL:      { query: "FT232RL",        package: "SSOP-28",      lcsc: "C8690",    decoupling: ["VCCIO:100nF","VCC:100nF+4.7µF"], layout_tip: "최고 신뢰도 USB-UART. EEPROM으로 VID/PID 설정 가능." },
    W5500:        { query: "W5500",          package: "LQFP-48",      lcsc: "C32843",   decoupling: ["VCC:100nF×4","VCC:10µF×2"], layout_tip: "SPI 신호 길이 매칭. 이더넷 RJ45 커넥터에 Bob Smith 종단 회로." },
    // ── 패시브 소자 ────────────────────────────────────────────────────────
    CAP_100NF:    { query: "100nF 50V X7R",  package: "0402",         lcsc: "C307331",  layout_tip: "바이패스 전용. IC VCC 핀 1mm 이내." },
    CAP_10NF:     { query: "10nF 50V X7R",   package: "0402",         lcsc: "C57112",   layout_tip: "고주파 바이패스용. RF IC 근처." },
    CAP_10UF:     { query: "10µF 10V X5R",   package: "0805",         lcsc: "C19702",   layout_tip: "벌크 캐패시터. LDO 입출력에 필수." },
    CAP_47UF:     { query: "47µF 10V",        package: "1206",         lcsc: "C145814",  layout_tip: "대용량 버퍼. DC-DC 출력에 사용." },
    CAP_4_7UF:    { query: "4.7µF 10V X5R",  package: "0603",         lcsc: "C19666",   layout_tip: "USB 회로 바이패스. CP2102 V3 핀용." },
    RES_10K:      { query: "10kΩ 1%",         package: "0402",         lcsc: "C25804",   layout_tip: "풀업/풀다운. I2C SDA/SCL 풀업에도 사용." },
    RES_4K7:      { query: "4.7kΩ 1%",        package: "0402",         lcsc: "C25905",   layout_tip: "I2C 풀업 (400kHz 속도). 3.3V 계에서 적합." },
    RES_100R:     { query: "100Ω 1%",          package: "0402",         lcsc: "C25076",   layout_tip: "USB D+/D- 직렬 저항. EMI 저감 효과." },
    RES_220R:     { query: "220Ω 1%",          package: "0402",         lcsc: "C25091",   layout_tip: "LED 전류 제한: (VCC-1.8V)/220 ≈ 7mA (3.3V 계)." },
    RES_1K:       { query: "1kΩ 1%",           package: "0402",         lcsc: "C21190",   layout_tip: "기본 베이스/게이트 저항. MOSFET 게이트 구동." },
    RES_120R:     { query: "120Ω 1%",          package: "0402",         lcsc: "C25082",   layout_tip: "CAN/RS485 버스 종단 저항. 버스 양 끝에 각 1개." },
    IND_10UH:     { query: "10µH 2A",          package: "0806",         lcsc: "C1046",    layout_tip: "DC-DC 인덕터. SW 핀 1mm 이내, 인덕터-다이오드-캐패시터 루프 최소화." },
    FERRITE_BEAD: { query: "BLM18AG121SN1D",  package: "0402",         lcsc: "C43182",   layout_tip: "전원 라인 EMI 필터. 커넥터 입력단에 배치." },
    // ── 보호 소자 ──────────────────────────────────────────────────────────
    TVS_5V:       { query: "SMAJ5.0A",        package: "DO-214AC",     lcsc: "C130012",  layout_tip: "ESD 보호. 커넥터 핀 바로 옆에 배치." },
    TVS_12V:      { query: "SMAJ12A",         package: "DO-214AC",     lcsc: "C130014",  layout_tip: "CAN 버스 ESD 보호. CANH/CANL 각 1개." },
    TVS_USB:      { query: "USBLC6-2SC6",     package: "SOT-23-6",     lcsc: "C7519",    layout_tip: "USB 전용 ESD 보호. D+/D- 공유 TVS, USB 커넥터 바로 옆." },
    SCHOTTKY:     { query: "SS34",             package: "DO-214AC",     lcsc: "C8678",    layout_tip: "역극성 보호 또는 전원 OR 다이오드. 낮은 순방향 전압강하(0.45V)." },
    PPTC:         { query: "MF-MSMF050",      package: "1812",         lcsc: "C70116",   layout_tip: "복구형 폴리퓨즈. USB/전원 입력에 직렬 삽입. 전류 사양 맞춰 선택." },
    MOSFET_P:     { query: "SI2301",           package: "SOT-23",       lcsc: "C10487",   layout_tip: "역극성 보호 P-MOSFET. 드레인-소스 역방향. 게이트 10k 풀업." },
    // ── 커넥터 ────────────────────────────────────────────────────────────
    USB_C:        { query: "TYPE-C-31-M-12",  package: "SMD",          lcsc: "C165948",  layout_tip: "외곽 배치. 케이스 개구부 맞춤. D+/D- 22Ω 직렬 저항. CC1/CC2에 5.1k 풀다운." },
    USB_MICRO:    { query: "MICRO-USB-5P",    package: "SMD",          lcsc: "C10418",   layout_tip: "기계적 고정 패드 4개 모두 납땜. D+/D- 22Ω 직렬 저항." },
    UART_HEADER:  { query: "Header 2.54mm 4P", package: "PTH",         lcsc: "C358685",  layout_tip: "UART TX/RX/GND/VCC 순서. 디버깅 위해 보드 외곽 접근 가능하게 배치." },
    OBD_CONNECTOR:{ query: "OBD-II DB9",      package: "connector",    lcsc: "",         layout_tip: "J1962 핀아웃 기준. 핀4=CHASSIS GND, 핀5=SIG GND, 핀16=VBAT." },
    JST_2P:       { query: "JST-PH 2P",       package: "PTH",          lcsc: "C157929",  layout_tip: "배터리 커넥터. 폴라리티 마킹 필수. 역극성 보호 회로와 함께 사용." },
    FUSE_INLINE:  { query: "polyfuse PPTC",   package: "PTH",          lcsc: "C70116",   layout_tip: "전원 입력 직후 배치. 정격 전류 사용 전류의 1.5~2배 선택." },
    // ── 센서 / 기타 ────────────────────────────────────────────────────────
    LED:          { query: "LED red 0402",    package: "0402",         lcsc: "C2286",    layout_tip: "220Ω~1kΩ 직렬 저항. VCC-R-LED-GND 방향. 전류 10mA 이하 권장." },
    LED_GREEN:    { query: "LED green 0402",  package: "0402",         lcsc: "C72043",   layout_tip: "동작 상태 표시용. GPIO로 직접 구동 시 33Ω 이상 직렬 저항." },
    DHT22:        { query: "DHT22 AM2302",    package: "DIP-4",        lcsc: "C540518",  layout_tip: "DATA 핀 10k 풀업. VCC-GND 사이 100nF 바이패스." },
    BME280:       { query: "BME280",          package: "LGA-8",        lcsc: "C92489",   layout_tip: "I2C 주소 SDO 핀으로 설정. 발열 부품에서 멀리 배치." },
    // ── 파워 심볼 ──────────────────────────────────────────────────────────
    GND:          { query: "GND",             package: "symbol",       lcsc: "",         layout_tip: "모든 IC 접지 핀에 반드시 연결. 플로팅 금지." },
    VCC_3V3:      { query: "VCC 3.3V",        package: "symbol",       lcsc: "",         layout_tip: "3.3V 파워 레일 심볼. 해당 레일의 모든 소자에 사용." },
    VCC_5V:       { query: "VCC 5V",          package: "symbol",       lcsc: "",         layout_tip: "5V 파워 레일 심볼. USB VBUS 또는 외부 5V 어댑터." },
    VCC_VBAT:     { query: "VBAT",            package: "symbol",       lcsc: "",         layout_tip: "배터리 전압 레일. 역극성 보호 후 분배." },
  });

  /**
   * PCB 설계 규칙 검사 (Design Rule Hints)
   * 컴포넌트 목록을 받아 잠재적인 설계 문제를 진단합니다.
   */
  const DESIGN_RULES = Object.freeze({
    /** 전류에 따른 권장 트레이스 폭 (mm) */
    traceWidthForCurrent(amperes) {
      if (amperes <= 0.3) return 0.2;
      if (amperes <= 0.5) return 0.3;
      if (amperes <= 1.0) return 0.5;
      if (amperes <= 2.0) return 1.0;
      if (amperes <= 3.0) return 1.5;
      if (amperes <= 5.0) return 2.5;
      return Math.ceil(amperes * 0.55 * 10) / 10;
    },

    /** 데커플링 캐패시터 필요 여부 확인 */
    checkDecoupling(components) {
      const issues = [];
      const compIds = components.map(c => c.id);
      const ics = components.filter(c => {
        const hint = TYPE_LIBRARY_HINT[c.type];
        return hint && hint.decoupling && hint.decoupling.length > 0;
      });
      ics.forEach(ic => {
        const hint = TYPE_LIBRARY_HINT[ic.type];
        const hasCap = components.some(c =>
          (c.type === "CAP_100NF" || c.type === "CAP_10UF" || c.type === "CAPACITOR") &&
          c.near === ic.id
        );
        if (!hasCap) {
          issues.push({
            severity: "warning",
            component: ic.id,
            message: `${ic.id}(${ic.type})에 데커플링 캐패시터가 누락되었습니다. 필요: ${hint.decoupling.join(", ")}`,
          });
        }
      });
      return issues;
    },

    /** CAN 버스 종단 저항 확인 */
    checkCanTermination(components) {
      const hasCan = components.some(c =>
        c.type === "CAN_TRANSCEIVER" || c.type === "TJA1051" || c.type === "SN65HVD230"
      );
      const hasTermRes = components.some(c =>
        (c.type === "RES_120R" || c.type === "RESISTOR") &&
        (c.value === "120" || c.value === "120R" || c.value === "120Ω")
      );
      if (hasCan && !hasTermRes) {
        return [{
          severity: "warning",
          message: "CAN 트랜시버가 있지만 종단 저항(120Ω)이 없습니다. 버스 양 끝에 각 1개씩 배치하세요.",
        }];
      }
      return [];
    },

    /** USB 보호 회로 확인 */
    checkUsbProtection(components) {
      const hasUsb = components.some(c => c.type === "USB_C" || c.type === "USB_MICRO" || c.type === "CP2102" || c.type === "CH340G");
      const hasTvs = components.some(c => c.type === "TVS_USB" || c.type === "TVS_5V" || c.type === "USBLC6");
      const hasFuse = components.some(c => c.type === "PPTC" || c.type === "FUSE_INLINE");
      const issues = [];
      if (hasUsb && !hasTvs) {
        issues.push({ severity: "warning", message: "USB 커넥터에 ESD 보호 소자(USBLC6-2SC6 등 TVS)가 없습니다." });
      }
      if (hasUsb && !hasFuse) {
        issues.push({ severity: "info", message: "USB 전원에 폴리퓨즈(PPTC) 추가를 권장합니다. 500mA 정격." });
      }
      return issues;
    },

    /** 전원 보호 회로 확인 */
    checkPowerProtection(components) {
      const hasLdo = components.some(c =>
        c.type === "LDO_3.3V" || c.type === "LDO_3_3V" || c.type === "LDO_5V" ||
        c.type === "BUCK_5V" || c.type === "BUCK_3_3V"
      );
      const hasRevPol = components.some(c =>
        c.type === "SCHOTTKY" || c.type === "MOSFET_P" || c.type === "FUSE_INLINE" || c.type === "PPTC"
      );
      if (hasLdo && !hasRevPol) {
        return [{
          severity: "warning",
          message: "전원 입력에 역극성 보호 소자가 없습니다. 쇼트키 다이오드(SS34) 또는 P-MOSFET 추가를 권장합니다.",
        }];
      }
      return [];
    },

    /** 전체 설계 규칙 검사 실행 */
    runAll(components) {
      return [
        ...this.checkDecoupling(components),
        ...this.checkCanTermination(components),
        ...this.checkUsbProtection(components),
        ...this.checkPowerProtection(components),
      ];
    },
  });

  /** Pre-built fragments (merged into larger designs). */
  const TEMPLATES = Object.freeze({
    ESP32_BASE: {
      components: [
        { id: "U1", type: "ESP32", x: ORIGIN_X + GRID * 4, y: ORIGIN_Y },
        { id: "U2", type: "LDO_3.3V", x: ORIGIN_X, y: ORIGIN_Y },
        { id: "C1", type: "CAP_10UF", x: ORIGIN_X + GRID, y: ORIGIN_Y - GRID },
        { id: "C2", type: "CAP_100NF", x: ORIGIN_X + GRID * 2, y: ORIGIN_Y - GRID },
        { id: "C3", type: "CAP_100NF", x: ORIGIN_X + GRID * 5, y: ORIGIN_Y + GRID * 2 },
      ],
      connections: [
        { from: "U2.OUT", to: "U1.VCC" },
        { from: "U2.GND", to: "GND" },
        { from: "U1.GND", to: "GND" },
        { from: "C1.1", to: "U2.IN" },
        { from: "C1.2", to: "GND" },
        { from: "C2.1", to: "U2.OUT" },
        { from: "C2.2", to: "GND" },
        { from: "C3.1", to: "U1.VCC" },
        { from: "C3.2", to: "U1.GND" },
      ],
    },
    CAN_INTERFACE: {
      components: [
        { id: "U3", type: "CAN_TRANSCEIVER", x: ORIGIN_X + GRID * 8, y: ORIGIN_Y },
        { id: "Rterm", type: "RES_10K", x: ORIGIN_X + GRID * 9, y: ORIGIN_Y + GRID },
      ],
      connections: [
        { from: "U3.VCC", to: "U1.VCC" },
        { from: "U3.GND", to: "GND" },
        { from: "U3.CAN_RX", to: "U1.GPIO4" },
        { from: "U3.CAN_TX", to: "U1.GPIO5" },
      ],
    },
    OBD_POWER: {
      components: [
        { id: "J_OBD", type: "OBD_CONNECTOR", x: ORIGIN_X - GRID * 2, y: ORIGIN_Y + GRID * 4 },
        { id: "F1", type: "FUSE_INLINE", x: ORIGIN_X, y: ORIGIN_Y + GRID * 3 },
      ],
      connections: [
        { from: "J_OBD.VBAT", to: "F1.IN" },
        { from: "F1.OUT", to: "U2.IN" },
        { from: "J_OBD.GND", to: "GND" },
      ],
    },
  });

  /**
   * Best-effort: locate a schematic editor object on window (minified names change between releases).
   * @returns {object|null}
   */
  function probeSchEditor() {
    const w = window;
    const paths = ["editor", "EasyEDA", "EDA", "lc", "lceda", "schapp", "SCH"];
    for (const p of paths) {
      if (w[p] && typeof w[p] === "object") return w[p];
    }
    return null;
  }

  /**
   * @param {{ id: string, type: string, x?: number, y?: number }} component
   */
  function insertComponent(component) {
    const hint = TYPE_LIBRARY_HINT[component.type] || {
      query: component.type,
      package: "",
    };
    const x = typeof component.x === "number" ? component.x : ORIGIN_X;
    const y = typeof component.y === "number" ? component.y : ORIGIN_Y;
    const rec = {
      id: component.id,
      type: component.type,
      x,
      y,
      libraryHint: hint,
    };

    const v = getVirtual();
    const idx = v.components.findIndex((c) => c.id === rec.id);
    if (idx >= 0) v.components[idx] = rec;
    else v.components.push(rec);

    const editor = probeSchEditor();
    if (editor && typeof editor.addComponent === "function") {
      try {
        editor.addComponent(rec);
        logLine(`editor.addComponent OK ${rec.id}`);
      } catch (e) {
        logLine(`editor.addComponent failed ${rec.id}: ${e && e.message}`);
      }
    } else {
      logLine(
        `Virtual place: ${rec.id} (${rec.type}) @ (${x},${y}) — EasyEDA hook not available; use library hint: ${hint.query}`
      );
    }
    return rec;
  }

  /**
   * @param {string} from e.g. "U1.VCC"
   * @param {string} to e.g. "U2.GND"
   */
  function connectPins(from, to) {
    const conn = { from, to };
    const v = getVirtual();
    v.connections.push(conn);

    const editor = probeSchEditor();
    if (editor && typeof editor.connect === "function") {
      try {
        editor.connect(from, to);
        logLine(`Wire: ${from} -> ${to} (editor)`);
      } catch (e) {
        logLine(`editor.connect failed: ${e && e.message}`);
      }
    } else {
      logLine(`Virtual wire: ${from} -> ${to}`);
    }
    return conn;
  }

  /**
   * Layout unpositioned components in a simple grid to reduce overlap.
   * @param {{ components: {id:string,type:string,x?:number,y?:number}[] }} spec
   */
  function applyAutoLayout(spec) {
    const cols = 4;
    spec.components.forEach((c, i) => {
      if (typeof c.x === "number" && typeof c.y === "number") return;
      const row = Math.floor(i / cols);
      const col = i % cols;
      c.x = ORIGIN_X + col * GRID * 3;
      c.y = ORIGIN_Y + row * GRID * 3;
    });
    return spec;
  }

  /**
   * @param {{ components: array, connections: array }} json
   */
  function renderCircuit(json) {
    if (!json || typeof json !== "object") throw new Error("Invalid circuit JSON");
    const spec = applyAutoLayout({
      components: Array.isArray(json.components) ? json.components.slice() : [],
      connections: Array.isArray(json.connections) ? json.connections.slice() : [],
    });

    spec.components.forEach((c) => insertComponent(c));
    spec.connections.forEach((w) => {
      if (w && w.from && w.to) connectPins(String(w.from), String(w.to));
    });

    window.dispatchEvent(
      new CustomEvent("pcb-agent-circuit-updated", {
        detail: { virtual: getVirtual(), spec },
      })
    );
    return getVirtual();
  }

  /** Current snapshot for AI analyze step (virtual + hook snapshot attempt). */
  function extractCircuitState() {
    const v = getVirtual();
    const components = v.components.map((c) => ({
      id: c.id,
      type: c.type,
      x: c.x,
      y: c.y,
      layoutTip: (TYPE_LIBRARY_HINT[c.type] || {}).layout_tip || "",
      lcsc: (TYPE_LIBRARY_HINT[c.type] || {}).lcsc || "",
    }));
    const designIssues = DESIGN_RULES.runAll(v.components);
    return {
      source: "virtual_mirror",
      components,
      connections: v.connections.slice(),
      editorProbe: probeSchEditor() ? "found_window_object" : "none",
      designIssues,
    };
  }

  /**
   * 설계 규칙 검사만 실행하고 결과를 반환합니다.
   * @returns {{ severity: string, message: string, component?: string }[]}
   */
  function runDesignRuleCheck() {
    const v = getVirtual();
    const issues = DESIGN_RULES.runAll(v.components);
    issues.forEach((issue) => {
      logLine(`[DRC] [${issue.severity.toUpperCase()}] ${issue.message}`);
    });
    return issues;
  }

  /**
   * 특정 전류에 대한 권장 트레이스 폭을 반환합니다.
   * @param {number} amperes
   * @returns {number} 트레이스 폭 (mm)
   */
  function getTraceWidth(amperes) {
    return DESIGN_RULES.traceWidthForCurrent(amperes);
  }

  /**
   * 컴포넌트의 LCSC 부품 번호와 레이아웃 팁을 반환합니다.
   * @param {string} type
   * @returns {{ lcsc: string, layout_tip: string, decoupling: string[] }}
   */
  function getComponentInfo(type) {
    const hint = TYPE_LIBRARY_HINT[type];
    if (!hint) return { lcsc: "", layout_tip: "알 수 없는 부품 타입입니다.", decoupling: [] };
    return {
      query: hint.query || type,
      package: hint.package || "",
      lcsc: hint.lcsc || "",
      layout_tip: hint.layout_tip || "",
      decoupling: hint.decoupling || [],
    };
  }

  /**
   * Apply fix actions from AI (subset supported).
   * @param {{ fixes?: { action: string, type?: string, connect_to?: string, near?: string, id?: string }[] }} bundle
   */
  function applyFixes(bundle) {
    const fixes = bundle && Array.isArray(bundle.fixes) ? bundle.fixes : [];
    let added = 0;
    fixes.forEach((fx, idx) => {
      if (!fx || typeof fx !== "object") return;
      if (fx.action === "add_component") {
        const id =
          fx.id ||
          `FIX_${idx}_${(fx.type || "X").replace(/\W+/g, "_").slice(0, 24)}`;
        insertComponent({
          id,
          type: String(fx.type || "CAP_100NF").replace(/\s+/g, "_"),
          x: ORIGIN_X + GRID * (idx + 1),
          y: ORIGIN_Y + GRID * 4,
        });
        if (fx.connect_to) {
          const parts = String(fx.connect_to).split(/[-–]/);
          if (parts.length >= 2) {
            connectPins(`${id}.1`, parts[0].trim());
            connectPins(`${id}.2`, parts[1].trim());
          }
        }
        added++;
      }
    });
    logLine(`applyFixes: applied ${added} actions`);
    return extractCircuitState();
  }

  window.PCBCircuitEngine = {
    TYPE_LIBRARY_HINT,
    DESIGN_RULES,
    TEMPLATES,
    insertComponent,
    connectPins,
    renderCircuit,
    extractCircuitState,
    applyFixes,
    applyAutoLayout,
    getVirtualSnapshot: getVirtual,
    probeSchEditor,
    // 신규 추가 기능
    runDesignRuleCheck,
    getTraceWidth,
    getComponentInfo,
  };
})();
