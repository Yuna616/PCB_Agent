"""
JLCPCB / LCSC Parts Search & BOM Service
KiCAD MCP의 JLCPCB 통합 기능을 EasyEDA용으로 구현합니다.

- 부품 설명 → LCSC 부품번호 + 가격 + 재고 추정
- 회로 JSON → JLCPCB 주문용 BOM CSV
- JLCPCB SMT 조립 적합성 분석
"""
from __future__ import annotations

import csv
import io
import json
import re
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI


# ── 부품 검색 시스템 프롬프트 ───────────────────────────────────────────────
PARTS_SEARCH_SYSTEM = """당신은 LCSC/JLCPCB 전자부품 전문가입니다.
부품 설명·사양을 받아 LCSC에서 구매 가능한 실제 부품을 JSON으로 반환합니다.

## 규칙
- LCSC 부품번호는 'C' + 숫자 형식 (예: C2040, C14663)
- 실제로 존재할 가능성이 높은 번호만 제안 (모르면 추정이라고 표시)
- JLCPCB SMT 기본 라이브러리 여부 반드시 표시
- 가격은 100개 기준 USD 추정
- 순수 JSON만 출력

## 출력 스키마
{
  "query": "검색어",
  "results": [
    {
      "lcsc_number": "C14663",
      "manufacturer": "제조사",
      "mpn": "제조사 부품번호",
      "description": "부품 설명",
      "package": "패키지",
      "value": "값/사양",
      "unit_price_usd": 0.05,
      "min_qty": 5,
      "jlcpcb_basic": true,
      "in_stock": true,
      "datasheet_url": "https://...",
      "confidence": "high|medium|low",
      "note": "추가 참고사항"
    }
  ],
  "recommendation": "추천 부품과 이유 (한국어)"
}"""


# ── BOM 생성 시스템 프롬프트 ─────────────────────────────────────────────────
BOM_SYSTEM = """당신은 JLCPCB SMT 조립 전문가입니다.
회로 컴포넌트 목록을 받아 JLCPCB에서 바로 사용할 수 있는 BOM 정보를 생성합니다.

## 규칙
- 각 부품에 LCSC 부품번호 제안 (모르면 검색 키워드 제공)
- JLCPCB 기본 라이브러리 부품 우선
- 가격은 최소 주문량 기준 추정
- 전체 예상 제조비용 계산 (부품비만, 조립비 제외)
- 순수 JSON만 출력

## 출력 스키마
{
  "bom": [
    {
      "ref": "U1",
      "quantity": 1,
      "value": "ESP32-WROOM-32",
      "package": "WROOM-32",
      "lcsc_number": "C82899",
      "manufacturer": "Espressif",
      "mpn": "ESP32-WROOM-32(16MB)",
      "description": "ESP32 WiFi+BLE 모듈",
      "unit_price_usd": 3.5,
      "total_price_usd": 3.5,
      "jlcpcb_basic": false,
      "smt_available": true,
      "confidence": "high",
      "note": ""
    }
  ],
  "cost_summary": {
    "total_components": 0,
    "total_cost_usd": 0.0,
    "jlcpcb_basic_count": 0,
    "jlcpcb_extended_count": 0,
    "smt_feasible": true
  },
  "warnings": ["경고 메시지"],
  "jlcpcb_notes": "JLCPCB 주문 시 주의사항"
}"""


def _safe_parse(raw: str) -> Optional[Dict[str, Any]]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip(), flags=re.MULTILINE)
    try:
        result = json.loads(cleaned)
        return result if isinstance(result, dict) else None
    except json.JSONDecodeError:
        return None


def _bom_to_csv(bom_data: Dict[str, Any]) -> str:
    """JLCPCB 업로드용 CSV 포맷 생성"""
    output = io.StringIO()
    writer = csv.writer(output)

    # JLCPCB BOM CSV 헤더 (공식 형식)
    writer.writerow([
        "Comment", "Designator", "Footprint",
        "LCSC Part #", "Manufacturer", "MPN",
        "Qty", "Unit Price(USD)", "Total Price(USD)"
    ])

    for item in bom_data.get("bom", []):
        writer.writerow([
            item.get("value", ""),
            item.get("ref", ""),
            item.get("package", ""),
            item.get("lcsc_number", ""),
            item.get("manufacturer", ""),
            item.get("mpn", ""),
            item.get("quantity", 1),
            f"{item.get('unit_price_usd', 0):.4f}",
            f"{item.get('total_price_usd', 0):.4f}",
        ])

    return output.getvalue()


class JLCPCBService:
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)

    async def search_parts(
        self,
        query: str,
        category: Optional[str] = None,
        package: Optional[str] = None,
        jlcpcb_basic_only: bool = False,
    ) -> Dict[str, Any]:
        """
        자연어 부품 설명 → LCSC 부품 검색 결과
        예: "3.3V LDO 500mA SOT-223" → LCSC 부품번호 + 가격
        """
        user_prompt_parts = [f"검색어: {query}"]
        if category:    user_prompt_parts.append(f"카테고리: {category}")
        if package:     user_prompt_parts.append(f"패키지: {package}")
        if jlcpcb_basic_only:
            user_prompt_parts.append("JLCPCB 기본 라이브러리 부품만 검색")
        user_prompt_parts.append("\nJSON만 출력하세요.")

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": PARTS_SEARCH_SYSTEM},
                {"role": "user",   "content": "\n".join(user_prompt_parts)},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=3000,
        )
        raw = response.choices[0].message.content or ""
        result = _safe_parse(raw)
        return result or {"query": query, "results": [], "recommendation": "검색 결과 없음"}

    async def generate_bom(
        self,
        components: List[Dict[str, Any]],
        board_qty: int = 5,
    ) -> Dict[str, Any]:
        """
        컴포넌트 목록 → JLCPCB BOM JSON + CSV
        """
        user_prompt = (
            f"보드 수량: {board_qty}개\n"
            f"컴포넌트 목록:\n"
            + json.dumps(components, ensure_ascii=False, indent=2)
            + "\n\nJLCPCB BOM JSON을 생성하세요. JSON만 출력."
        )

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": BOM_SYSTEM},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=4000,
        )
        raw = response.choices[0].message.content or ""
        result = _safe_parse(raw)

        if not result:
            return {"bom": [], "cost_summary": {}, "warnings": ["BOM 생성 실패"]}

        # 수량에 따른 총 가격 계산
        for item in result.get("bom", []):
            qty = item.get("quantity", 1) * board_qty
            item["quantity_total"] = qty
            item["total_price_usd"] = round(item.get("unit_price_usd", 0) * qty, 4)

        # 총 비용 업데이트
        total = sum(i.get("total_price_usd", 0) for i in result.get("bom", []))
        if "cost_summary" in result:
            result["cost_summary"]["total_cost_usd"] = round(total, 2)
            result["cost_summary"]["board_qty"] = board_qty

        # CSV 생성
        result["csv"] = _bom_to_csv(result)

        return result

    async def analyze_smt_feasibility(
        self,
        components: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        JLCPCB SMT 조립 적합성 분석
        - 통孔(THT) 부품 식별
        - 최소 주문 수량 문제
        - 리드타임 이슈
        """
        prompt = (
            "다음 부품 목록의 JLCPCB SMT 조립 적합성을 분석하세요.\n"
            "THT 부품, 최소 주문량 문제, 조립 불가 부품을 식별하세요.\n"
            "JSON만 출력:\n"
            '{"smt_issues": [{"ref":"","issue":"","suggestion":""}], '
            '"tht_components": [{"ref":"","type":""}], '
            '"overall_feasible": true, "notes": ""}\n\n'
            + json.dumps(components, ensure_ascii=False)
        )

        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=2000,
        )
        raw = response.choices[0].message.content or ""
        return _safe_parse(raw) or {"smt_issues": [], "overall_feasible": True}
