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
