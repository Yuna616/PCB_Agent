"""
PCB Schematic API - AI Service
GPT-4o에게 프로젝트 설명 / 업로드 파일을 보내고 구조화된 스키매틱 데이터를 JSON으로 받습니다.
"""
import json
import re
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from app.models.request import AttachedFile


MAX_FILE_CHARS   = 40_000
MAX_TOTAL_CHARS  = 100_000
MAX_TOKENS_FULL  = 16_000
MAX_TOKENS_RETRY =  6_000


SYSTEM_PROMPT = """당신은 전문 PCB 원리도(Schematic) 설계 AI입니다.
사용자의 프로젝트 설명 또는 업로드된 파일을 분석해 EasyEDA 호환 원리도 설계 데이터를 JSON으로 출력합니다.

## 입력 처리 우선순위
1. [첨부 파일]이 있으면 파일 내용을 주 소스로 삼습니다.
2. [프로젝트 설명]이 있으면 파일 분석을 보완하거나 단독 입력으로 사용합니다.

## 출력 규칙
- 반드시 순수 JSON만 출력합니다. 마크다운 코드 펜스 없이 JSON 객체만.
- 모든 부품 포함 (수동소자: 디커플링 캡, 풀업/풀다운 저항, 바이패스 캡 등).
- 핀 번호/넷 이름은 실제 데이터시트 기준.
- 전원 레일(VCC, GND, 3V3, 5V)은 파워 심볼로 별도 처리.
- 참조번호: U1, U2 / R1, R2 / C1, C2 / J1, J2 순서.
- 응답이 길어질 것 같으면 핀 목록을 주요 핀만 포함해 길이를 줄이세요.

## 출력 JSON 스키마
{
  "project_summary": "string",
  "design_stages": [{"stage":1,"name":"string","description":"string","tasks":["string"],"completion_criteria":"string"}],
  "power_supply": {"input":"string","rails":[{"name":"string","voltage":"string","current_ma":0,"source":"string"}]},
  "components": [{"ref":"U1","value":"string","description":"string","package":"string","category":"MCU|Sensor|Regulator|Passive|Connector|Display|Other","quantity":1,"search_keyword":"string","datasheet_url":null,"pins":[{"pin_number":"string","pin_name":"string","net":"string","direction":"input|output|power|passive|bidirectional"}]}],
  "nets": [{"name":"string","net_type":"power|signal|ground","voltage":null,"description":null}],
  "connections": [{"net":"string","nodes":[{"ref":"string","pin":"string","pin_name":"string"}]}],
  "erc_notes": ["string"]
}"""

SYSTEM_PROMPT_COMPACT = SYSTEM_PROMPT + """

## 토큰 절약 모드 (이전 응답이 너무 길어 잘림)
- design_stages: 최대 3개
- components[].pins: 부품당 최대 6개
- connections: 최대 15개
- erc_notes: 최대 3개
- tasks: 스테이지당 최대 3개"""


REQUIRED_KEYS = {
    "project_summary": "",
    "design_stages": [],
    "power_supply": {"input": "알 수 없음", "rails": []},
    "components": [],
    "nets": [],
    "connections": [],
    "erc_notes": [],
}


def _build_user_prompt(
    description: Optional[str],
    attached_files: List[AttachedFile],
    detail_level: str,
    language: str,
) -> str:
    parts: List[str] = []

    if attached_files:
        parts.append("[첨부 파일 - 원리도 생성의 주 소스]")
        total_chars = 0
        for f in attached_files:
            if total_chars >= MAX_TOTAL_CHARS:
                parts.append("(이하 파일 생략 - 전체 용량 초과)")
                break
            body = f.content
            remaining = MAX_TOTAL_CHARS - total_chars
            if len(body) > MAX_FILE_CHARS:
                body = body[:MAX_FILE_CHARS] + f"\n...({len(f.content) - MAX_FILE_CHARS:,}자 생략)"
            if len(body) > remaining:
                body = body[:remaining] + "\n...(전체 용량 한도 도달, 이하 생략)"
            parts.append(f"--- 파일: {f.name} ---\n{body}")
            total_chars += len(body)
        parts.append("")

    if description and description.strip():
        label = "[추가 프로젝트 설명 - 파일 내용 보완]" if attached_files else "[프로젝트 설명]"
        parts.append(f"{label}\n{description.strip()}\n")

    parts.append(
        "[설계 지침]\n"
        f"- 상세도: {detail_level}\n"
        "- full이면 디커플링 캡(100nF/10uF), 풀업/풀다운 저항, 보호 소자 포함\n"
        "- minimal이면 핵심 IC와 커넥터만\n"
        f"- 언어: {language} (한국어 설명, 영문 부품명/넷 이름)\n"
        "\nJSON만 출력하세요."
    )

    return "\n".join(parts)


def _try_recover_json(raw: str) -> Optional[Dict[str, Any]]:
    """
    잘린 JSON 강제 복구 (스택 방식).

    순서:
      1) 문자열 안에서 잘린 경우 닫는 따옴표 추가
      2) 콜론 뒤 값이 없으면 null 삽입
      3) 열린 괄호를 스택에 쌓았다가 역순으로 닫기
      4) json.loads 시도
    """
    in_string    = False
    escape_next  = False
    stack: List[str] = []   # 열린 컨테이너의 닫는 문자 스택

    prev_non_ws  = ""       # 직전 공백이 아닌 문자 (값 부재 감지용)

    for ch in raw:
        if escape_next:
            escape_next = False
            prev_non_ws = ch
            continue
        if ch == "\\" and in_string:
            escape_next = True
            prev_non_ws = ch
            continue
        if ch == '"':
            in_string = not in_string
            prev_non_ws = ch
            continue
        if in_string:
            prev_non_ws = ch
            continue
        if ch == '{':
            stack.append('}')
        elif ch == '[':
            stack.append(']')
        elif ch in ']}' and stack:
            stack.pop()
        if ch.strip():
            prev_non_ws = ch

    suffix = ""

    # 1) 열린 문자열 닫기
    if in_string:
        suffix += '"'
        prev_non_ws = '"'

    # 2) 콜론 뒤에 값이 없으면 null 삽입
    if prev_non_ws == ':':
        suffix += 'null'

    # 3) 열린 컨테이너를 역순으로 닫기
    suffix += "".join(reversed(stack))

    candidate = raw + suffix
    try:
        result = json.loads(candidate)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    return None


def _fill_missing_keys(data: Dict[str, Any]) -> Dict[str, Any]:
    """필수 키가 빠져 있으면 기본값으로 채움"""
    for key, default in REQUIRED_KEYS.items():
        if key not in data:
            import copy
            data[key] = copy.deepcopy(default)
    return data


def _safe_parse(raw: str) -> Optional[Dict[str, Any]]:
    """마크다운 펜스 제거 후 JSON 파싱. 실패하면 None 반환."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$",           "", cleaned.strip(), flags=re.MULTILINE)
    try:
        result = json.loads(cleaned)
        return result if isinstance(result, dict) else None
    except json.JSONDecodeError:
        return None


class AIService:

    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)

    async def generate_schematic_data(
        self,
        description: Optional[str] = None,
        attached_files: Optional[List[AttachedFile]] = None,
        detail_level: str = "full",
        language: str = "ko",
    ) -> Dict[str, Any]:
        """
        1차: max_tokens=16000 으로 전체 생성 시도
        -> JSON 파싱 실패 시 스택 방식 강제 복구
        -> 복구 실패 시 2차: compact 모드 max_tokens=6000 재시도
        """
        user_prompt = _build_user_prompt(
            description=description,
            attached_files=attached_files or [],
            detail_level=detail_level,
            language=language,
        )

        # 1차 시도
        raw = await self._call_api(SYSTEM_PROMPT, user_prompt, MAX_TOKENS_FULL)

        result = _safe_parse(raw)
        if result is not None:
            return _fill_missing_keys(result)

        recovered = _try_recover_json(raw)
        if recovered is not None:
            recovered.setdefault("erc_notes", [])
            recovered["erc_notes"].append(
                "응답이 너무 길어 일부가 잘렸습니다. 부분 복구된 데이터입니다."
            )
            return _fill_missing_keys(recovered)

        # 2차 시도: compact 모드
        raw2 = await self._call_api(SYSTEM_PROMPT_COMPACT, user_prompt, MAX_TOKENS_RETRY)

        result2 = _safe_parse(raw2)
        if result2 is not None:
            result2.setdefault("erc_notes", [])
            result2["erc_notes"].append(
                "응답 축약 모드로 생성되었습니다 (토큰 한도 초과로 인한 재시도)."
            )
            return _fill_missing_keys(result2)

        recovered2 = _try_recover_json(raw2)
        if recovered2 is not None:
            recovered2.setdefault("erc_notes", [])
            recovered2["erc_notes"].append(
                "축약 모드에서도 응답이 잘렸습니다. 부분 복구된 데이터입니다."
            )
            return _fill_missing_keys(recovered2)

        raise ValueError(
            f"AI 응답 JSON 파싱 실패 (1차/2차 모두 실패).\n"
            f"원본 앞부분:\n{raw[:300]}"
        )

    async def _call_api(self, system: str, user: str, max_tokens: int) -> str:
        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""
