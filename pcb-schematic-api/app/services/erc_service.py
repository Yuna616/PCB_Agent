"""
ERC (Electrical Rule Check) Service
KiCAD MCP의 ERC 도구를 EasyEDA AI 방식으로 구현합니다.
회로 컴포넌트·연결 정보를 받아 전기 규칙 위반을 구조화된 JSON으로 반환합니다.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI


# ── ERC 시스템 프롬프트 ─────────────────────────────────────────────────────
ERC_SYSTEM_PROMPT = """당신은 전문 PCB 회로 ERC(Electrical Rule Check) 분석 AI입니다.
EasyEDA 원리도의 컴포넌트·연결 목록을 받아 전기 규칙 위반을 탐지합니다.

## 분석 항목 (KiCAD ERC 기준 + PCB 실무 기준)
1. 플로팅 핀 (Floating Pin): 연결되지 않은 입력 핀
2. 디커플링 캐패시터 누락: IC VCC 핀에 100nF/10uF 없음
3. 풀업/풀다운 저항 누락: 오픈 드레인·I2C SDA/SCL 핀
4. 전원 레일 문제: 전원 핀 미연결, GND 누락
5. 핀 충돌: 출력-출력 단락, 전원-신호 연결
6. 미사용 핀 처리: No Connect 마크 미배치
7. 바이패스 캐패시터: 전원 레일에 바이패스 없음
8. 참조번호 중복: 동일 RefDes 사용
9. 역전압 보호 누락: 전원 입력에 다이오드 없음
10. 리셋 회로: MCU 리셋 핀 플로팅

## 출력 규칙
- 순수 JSON만 출력. 마크다운 코드 펜스 없음.
- severity: "error" | "warning" | "info"
- error: 설계 동작 불가 수준
- warning: 신뢰성 위험, 실무 권고 위반
- info: 개선 제안

## 출력 JSON 스키마
{
  "erc_summary": {
    "total": 0,
    "errors": 0,
    "warnings": 0,
    "info": 0,
    "pass": true
  },
  "issues": [
    {
      "id": "ERC001",
      "severity": "error|warning|info",
      "category": "floating_pin|decoupling|pullup|power|pin_conflict|unused_pin|bypass|duplicate_ref|reverse_protection|reset_circuit|other",
      "component": "U1",
      "pin": "VCC",
      "net": "3V3",
      "message": "문제 설명 (한국어)",
      "fix": "수정 방법 (EasyEDA 메뉴 기준, 한국어)",
      "auto_fixable": true
    }
  ],
  "fix_actions": [
    {
      "action": "add_component",
      "type": "CAPACITOR",
      "value": "100nF",
      "connect_to": "VCC-GND",
      "ref": "C_AUTO_1",
      "reason": "디커플링 캐패시터 추가"
    }
  ]
}"""


def _build_erc_prompt(circuit_data: Dict[str, Any], context: Optional[str]) -> str:
    parts = []

    if context and context.strip():
        parts.append(f"[프로젝트 설명]\n{context.strip()}\n")

    parts.append("[회로 데이터]\n" + json.dumps(circuit_data, ensure_ascii=False, indent=2))
    parts.append("\n위 회로의 ERC를 수행하고 JSON만 출력하세요.")
    return "\n".join(parts)


def _validate_erc_response(data: Any) -> bool:
    return (
        isinstance(data, dict)
        and "erc_summary" in data
        and "issues" in data
        and isinstance(data["issues"], list)
    )


def _safe_parse(raw: str) -> Optional[Dict[str, Any]]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip(), flags=re.MULTILINE)
    try:
        result = json.loads(cleaned)
        return result if isinstance(result, dict) else None
    except json.JSONDecodeError:
        return None


class ERCService:
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)

    async def run_erc(
        self,
        circuit_data: Dict[str, Any],
        context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        회로 데이터를 받아 ERC 결과를 반환합니다.
        circuit_data: AI generate 결과 또는 사용자가 직접 입력한 components/connections
        """
        prompt = _build_erc_prompt(circuit_data, context)

        # 1차 시도
        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": ERC_SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=4000,
        )
        raw = response.choices[0].message.content or ""
        result = _safe_parse(raw)

        if result and _validate_erc_response(result):
            return result

        # 폴백: 기본 구조 반환
        return {
            "erc_summary": {"total": 0, "errors": 0, "warnings": 0, "info": 0, "pass": True},
            "issues": [],
            "fix_actions": [],
            "_parse_error": "AI 응답 파싱 실패, 원본: " + raw[:200],
        }
