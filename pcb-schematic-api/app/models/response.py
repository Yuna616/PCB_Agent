"""
PCB Schematic API — Response Models
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ─────────────────────────────────────────────
# 스키매틱 내부 구성 요소
# ─────────────────────────────────────────────

class PinConnection(BaseModel):
    """부품 핀 하나의 넷 연결 정보"""
    pin_number: str
    pin_name: str
    net: str
    direction: Optional[str] = None  # input / output / power / passive / bidirectional


class Component(BaseModel):
    """원리도 부품 심볼"""
    ref: str = Field(description="참조번호 (U1, R1, C1 …)")
    value: str = Field(description="부품 값 또는 모델명 (ESP32-WROOM-32, 10kΩ …)")
    description: str
    package: str = Field(description="패키지 / 풋프린트 (SOT-23, 0402, Module …)")
    category: str = Field(description="MCU / Sensor / Regulator / Passive / Connector / Display …")
    quantity: int = 1
    search_keyword: str = Field(description="EasyEDA 라이브러리 검색 키워드")
    datasheet_url: Optional[str] = None
    pins: List[PinConnection] = Field(default_factory=list)


class Net(BaseModel):
    """전기적 넷(신호선)"""
    name: str
    net_type: str = Field(description="power / signal / ground")
    voltage: Optional[str] = None
    description: Optional[str] = None


class ConnectionNode(BaseModel):
    """넷에 연결된 핀 하나"""
    ref: str
    pin: str
    pin_name: str


class Connection(BaseModel):
    """하나의 넷에 연결된 모든 핀 목록"""
    net: str
    nodes: List[ConnectionNode]


class PowerRail(BaseModel):
    """전원 레일 정보"""
    name: str
    voltage: str
    current_ma: Optional[int] = None
    source: Optional[str] = None  # 레귤레이터 참조번호 또는 "USB"


class PowerSupply(BaseModel):
    """전원 공급 구성"""
    input: str = Field(description="입력 전원 (예: USB 5V, LiPo 3.7V)")
    rails: List[PowerRail] = Field(default_factory=list)


class DesignStage(BaseModel):
    """설계 단계"""
    stage: int
    name: str
    description: str
    tasks: List[str] = Field(description="EasyEDA에서 할 일 (한국어 메뉴)")
    completion_criteria: str = Field(description="완료 조건")


# ─────────────────────────────────────────────
# BOM
# ─────────────────────────────────────────────

class BOMItem(BaseModel):
    ref: str
    value: str
    description: str
    package: str
    quantity: int
    category: str
    search_keyword: str
    unit_price_usd: Optional[float] = None
    notes: Optional[str] = None


# ─────────────────────────────────────────────
# EasyEDA JSON 출력
# ─────────────────────────────────────────────

class EasyEDAPin(BaseModel):
    pin_number: str
    pin_name: str
    net: str
    x: int
    y: int


class EasyEDAComponent(BaseModel):
    ref: str
    value: str
    package: str
    x: int
    y: int
    rotation: int = 0
    pins: List[EasyEDAPin]


class EasyEDAWire(BaseModel):
    net: str
    points: List[List[int]]  # [[x1,y1],[x2,y2], ...]


class EasyEDANetLabel(BaseModel):
    name: str
    x: int
    y: int
    rotation: int = 0


class EasyEDASchematic(BaseModel):
    """EasyEDA Standard Edition 호환 스키매틱 JSON"""
    title: str
    description: str
    canvas_width: int = 2000
    canvas_height: int = 1500
    components: List[EasyEDAComponent]
    wires: List[EasyEDAWire]
    net_labels: List[EasyEDANetLabel]
    power_symbols: List[EasyEDANetLabel]
    raw_shapes: List[str] = Field(
        default_factory=list,
        description="EasyEDA shape 문자열 (LIB~, W~, N~ 형식) — 직접 임포트용",
    )


# ─────────────────────────────────────────────
# 최종 응답
# ─────────────────────────────────────────────

class SchematicData(BaseModel):
    """AI가 생성한 원리도 구조 데이터"""
    project_summary: str
    design_stages: List[DesignStage]
    power_supply: PowerSupply
    components: List[Component]
    nets: List[Net]
    connections: List[Connection]
    erc_notes: List[str] = Field(
        default_factory=list,
        description="ERC 주의사항 (미연결 핀, 전원 충돌 등)",
    )


class GenerateResponse(BaseModel):
    """스키매틱 생성 응답"""
    success: bool = True
    project_summary: str
    design_stages: List[DesignStage]
    power_supply: PowerSupply

    # 출력 포맷 (요청한 것만 포함)
    schematic_json: Optional[SchematicData] = None
    easyeda_json: Optional[EasyEDASchematic] = None
    bom: Optional[List[BOMItem]] = None
    ascii_diagram: Optional[str] = None

    erc_notes: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    detail: Optional[str] = None
