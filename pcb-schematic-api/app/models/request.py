"""
PCB Schematic API — Request Models
"""
from typing import List, Optional
from pydantic import BaseModel, Field, model_validator


class AttachedFile(BaseModel):
    """업로드된 파일 하나"""
    name: str = Field(description="파일 이름 (예: requirements.txt, bom.csv)")
    content: str = Field(description="파일 텍스트 내용")


class GenerateOptions(BaseModel):
    """출력 옵션 설정"""
    output_formats: List[str] = Field(
        default=["schematic_json", "easyeda_json", "bom", "ascii"],
        description="생성할 출력 포맷 목록: schematic_json, easyeda_json, bom, ascii",
    )
    language: str = Field(
        default="ko",
        description="응답 언어 (ko=한국어, en=영어)",
    )
    detail_level: str = Field(
        default="full",
        description="설계 상세도: minimal(핵심 부품만) | full(수동소자·디커플링 포함)",
    )


class GenerateRequest(BaseModel):
    """
    스키매틱 생성 요청.

    - attached_files 만 제공: 파일 내용을 분석해 원리도 생성
    - description 만 제공: 텍스트 설명으로 원리도 생성
    - 둘 다 제공: 파일 내용을 주 소스, description을 보조 컨텍스트로 사용
    - 둘 다 없으면 422 오류
    """
    description: Optional[str] = Field(
        default=None,
        min_length=5,
        description="프로젝트 설명 (보조 또는 단독 입력). attached_files가 있으면 보조 컨텍스트로 사용됩니다.",
        examples=["USB 5V 공급, ESP32, DHT22 센서, I2C OLED"],
    )
    attached_files: List[AttachedFile] = Field(
        default_factory=list,
        description="업로드된 파일 목록. 파일 내용이 원리도 생성의 주 소스가 됩니다.",
    )
    api_key: str = Field(
        ...,
        description="OpenAI API 키 (sk-...)",
    )
    options: GenerateOptions = Field(default_factory=GenerateOptions)

    @model_validator(mode="after")
    def check_input_provided(self) -> "GenerateRequest":
        """description 또는 attached_files 중 하나는 반드시 있어야 합니다."""
        has_desc = bool(self.description and self.description.strip())
        has_files = bool(self.attached_files)
        if not has_desc and not has_files:
            raise ValueError(
                "description 또는 attached_files 중 하나 이상을 제공해야 합니다."
            )
        return self

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "summary": "파일 업로드로 생성",
                    "value": {
                        "attached_files": [
                            {
                                "name": "requirements.txt",
                                "content": "전원: USB 5V\nMCU: ESP32\n센서: DHT22 온습도\n디스플레이: 0.96\" I2C OLED\n통신: Wi-Fi MQTT"
                            }
                        ],
                        "api_key": "sk-xxxxxxxxxxxxxxxxxxxx",
                        "options": {
                            "output_formats": ["schematic_json", "easyeda_json", "bom", "ascii"],
                            "language": "ko",
                            "detail_level": "full",
                        },
                    }
                },
                {
                    "summary": "텍스트 설명으로 생성",
                    "value": {
                        "description": "USB 5V 공급, ESP32로 Wi-Fi MQTT 온습도 전송, DHT22 센서, I2C OLED",
                        "api_key": "sk-xxxxxxxxxxxxxxxxxxxx",
                        "options": {
                            "output_formats": ["schematic_json", "easyeda_json", "bom", "ascii"],
                            "language": "ko",
                            "detail_level": "full",
                        },
                    }
                },
            ]
        }
    }


# ─────────────────────────────────────────────
# ERC 요청
# ─────────────────────────────────────────────

class ERCRequest(BaseModel):
    """전기 규칙 검사 요청"""
    circuit_data: dict = Field(
        ...,
        description="회로 데이터 (components + connections). /generate 결과 전체 또는 직접 입력.",
    )
    context: Optional[str] = Field(
        default=None,
        description="프로젝트 설명 (선택). 회로 목적을 알면 더 정확한 ERC 수행.",
    )
    api_key: str = Field(..., description="OpenAI API 키")


# ─────────────────────────────────────────────
# 부품 검색 요청
# ─────────────────────────────────────────────

class PartsSearchRequest(BaseModel):
    """JLCPCB/LCSC 부품 검색 요청"""
    query: str = Field(
        ...,
        min_length=2,
        description="검색어 (예: '3.3V LDO SOT-223', 'CAN transceiver SOP-8', '100nF 0402')",
    )
    category: Optional[str] = Field(default=None, description="카테고리 필터 (선택)")
    package: Optional[str] = Field(default=None, description="패키지 필터 (선택)")
    jlcpcb_basic_only: bool = Field(
        default=False,
        description="JLCPCB 기본 라이브러리 부품만 검색 (추가 수수료 없음)",
    )
    api_key: str = Field(..., description="OpenAI API 키")


# ─────────────────────────────────────────────
# BOM 생성 요청
# ─────────────────────────────────────────────

class BOMRequest(BaseModel):
    """JLCPCB BOM 생성 요청"""
    components: List[dict] = Field(
        ...,
        description="컴포넌트 목록. /generate 결과의 components 배열 또는 직접 입력.",
    )
    board_qty: int = Field(
        default=5,
        ge=1,
        le=10000,
        description="보드 제작 수량 (총 부품 수량 및 가격 계산에 사용)",
    )
    api_key: str = Field(..., description="OpenAI API 키")
