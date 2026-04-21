"""
PCB Schematic API — FastAPI 메인 애플리케이션
"""
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.models.request import GenerateRequest, ERCRequest, PartsSearchRequest, BOMRequest
from app.models.response import (
    ErrorResponse, GenerateResponse,
    ERCResponse, PartsSearchResponse, JLCBOMResponse,
)
from app.services.ai_service import AIService
from app.services.ascii_service import ASCIIService
from app.services.schematic_service import SchematicService
from app.services.erc_service import ERCService
from app.services.jlcpcb_service import JLCPCBService


# ─────────────────────────────────────────────
# 커스텀 예외 핸들러 (앱 생성 전 정의)
# FastAPI.__init__ 이 setdefault 로 핸들러를 등록하므로,
# 생성자에 직접 전달해야 기본값을 확실히 덮어씁니다.
# ─────────────────────────────────────────────

async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Pydantic 422 검증 오류 → 한국어 ErrorResponse"""
    messages = []
    for err in exc.errors():
        loc = " → ".join(str(l) for l in err.get("loc", []) if l != "body")
        msg = err.get("msg", "")
        messages.append(f"{loc}: {msg}" if loc else msg)
    detail = " / ".join(messages) if messages else str(exc)
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            success=False,
            error="요청 데이터 검증 오류",
            detail=detail,
        ).model_dump(),
    )


async def _http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """HTTPException → ErrorResponse"""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            success=False,
            error=f"HTTP {exc.status_code}",
            detail=str(exc.detail),
        ).model_dump(),
    )


# ─────────────────────────────────────────────
# 앱 설정
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("✅ PCB Schematic API 서버 시작")
    yield
    print("🛑 PCB Schematic API 서버 종료")


app = FastAPI(
    title="PCB Schematic API",
    description=(
        "파일 또는 텍스트 설명을 입력하면 AI가 EasyEDA 호환 원리도 JSON, "
        "BOM, ASCII 회로도를 자동 생성하는 API입니다."
    ),
    version="1.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    # ← 생성자에 직접 전달해야 FastAPI 기본 핸들러를 확실히 교체
    exception_handlers={
        RequestValidationError: _validation_handler,
        StarletteHTTPException: _http_handler,
    },
)

# ─────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────
# · allow_credentials=True 일 때 "*" 와일드카드 사용 불가 (Starlette 제한)
# · Chrome 확장은 chrome-extension:// origin 또는 null 로 옵니다
# · API 키는 request body 로 전달하므로 credentials 불필요 → False 유지
# ─────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://easyeda.com",
        "https://pro.easyeda.com",
        "https://std.easyeda.com",
        "https://oshwlab.com",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "null",           # Chrome 확장 일부 환경
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# 서비스 싱글톤
schematic_svc = SchematicService()
ascii_svc = ASCIIService()


# ─────────────────────────────────────────────
# 헬스 체크
# ─────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "message": "PCB Schematic API is running 🔧"}


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "healthy", "version": app.version}


# ─────────────────────────────────────────────
# 메인 엔드포인트: 원리도 생성
# ─────────────────────────────────────────────

@app.post(
    "/api/v1/generate",
    response_model=GenerateResponse,
    tags=["Schematic"],
    summary="원리도 자동 생성",
    description=(
        "**attached_files** (파일 업로드) 또는 **description** (텍스트) 중 하나 이상 필요. "
        "둘 다 제공하면 파일이 주 소스, 텍스트는 보조 컨텍스트로 사용됩니다."
    ),
    responses={
        200: {"description": "생성 성공"},
        401: {"model": ErrorResponse, "description": "OpenAI API 키 오류"},
        422: {"model": ErrorResponse, "description": "요청 검증 오류"},
        500: {"model": ErrorResponse, "description": "서버 오류"},
    },
)
async def generate_schematic(body: GenerateRequest):
    t_start = time.time()
    formats = set(body.options.output_formats)

    # EasyEDA JSON 제목 결정 (description 이 None 일 수 있으므로 안전하게 처리)
    if body.attached_files:
        title = ", ".join(f.name for f in body.attached_files)[:80]
    elif body.description:
        title = body.description[:60]
    else:
        title = "AI 생성 원리도"

    # ── 1. AI로 스키매틱 데이터 생성 ──────────────
    try:
        ai_svc = AIService(api_key=body.api_key)
        raw_data = await ai_svc.generate_schematic_data(
            description=body.description,
            attached_files=list(body.attached_files),
            detail_level=body.options.detail_level,
            language=body.options.language,
        )
    except Exception as e:
        msg = str(e)
        if any(k in msg.lower() for k in ("authentication", "api key", "incorrect api key", "401")):
            raise HTTPException(status_code=401, detail=f"OpenAI API 키가 올바르지 않습니다: {msg}")
        raise HTTPException(status_code=500, detail=f"AI 생성 실패: {msg}")

    # ── 2. 공통 모델 파싱 ──────────────────────────
    try:
        schematic_data = schematic_svc.parse_schematic_data(raw_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"데이터 파싱 실패: {e}")

    comps = schematic_data.components
    conns = schematic_data.connections
    nets  = schematic_data.nets

    # ── 3. 포맷별 출력 생성 ────────────────────────
    warnings: list[str] = []
    response_kwargs: dict = {
        "project_summary": schematic_data.project_summary,
        "design_stages":   schematic_data.design_stages,
        "power_supply":    schematic_data.power_supply,
        "erc_notes":       schematic_data.erc_notes,
        "warnings":        warnings,
    }

    if "schematic_json" in formats:
        response_kwargs["schematic_json"] = schematic_data

    if "easyeda_json" in formats:
        try:
            response_kwargs["easyeda_json"] = schematic_svc.build_easyeda_json(
                title=title, components=comps, connections=conns
            )
        except Exception as e:
            warnings.append(f"EasyEDA JSON 생성 실패: {e}")

    if "bom" in formats:
        try:
            response_kwargs["bom"] = schematic_svc.build_bom(comps)
        except Exception as e:
            warnings.append(f"BOM 생성 실패: {e}")

    if "ascii" in formats:
        try:
            response_kwargs["ascii_diagram"] = ascii_svc.generate(
                project_summary=schematic_data.project_summary,
                power_supply=schematic_data.power_supply,
                components=comps,
                connections=conns,
                nets=nets,
            )
        except Exception as e:
            warnings.append(f"ASCII 생성 실패: {e}")

    elapsed = round(time.time() - t_start, 2)
    warnings.append(f"생성 완료 ({elapsed}초)")

    return GenerateResponse(**response_kwargs)


# ─────────────────────────────────────────────
# ERC 엔드포인트
# ─────────────────────────────────────────────

@app.post(
    "/api/v1/erc",
    response_model=ERCResponse,
    tags=["ERC"],
    summary="전기 규칙 검사 (ERC)",
    description=(
        "회로 데이터를 받아 AI 기반 ERC를 수행합니다. "
        "/api/v1/generate 결과를 그대로 circuit_data에 전달하거나, "
        "components + connections 를 직접 입력할 수 있습니다."
    ),
    responses={
        200: {"description": "ERC 결과"},
        401: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def run_erc(body: ERCRequest):
    try:
        svc = ERCService(api_key=body.api_key)
        result = await svc.run_erc(
            circuit_data=body.circuit_data,
            context=body.context,
        )
    except Exception as e:
        msg = str(e)
        if any(k in msg.lower() for k in ("authentication", "api key", "401")):
            raise HTTPException(status_code=401, detail=f"OpenAI API 키 오류: {msg}")
        raise HTTPException(status_code=500, detail=f"ERC 분석 실패: {msg}")

    return ERCResponse(
        success=True,
        erc_summary=result.get("erc_summary", {}),
        issues=result.get("issues", []),
        fix_actions=result.get("fix_actions", []),
    )


# ─────────────────────────────────────────────
# JLCPCB 부품 검색
# ─────────────────────────────────────────────

@app.post(
    "/api/v1/parts/search",
    response_model=PartsSearchResponse,
    tags=["JLCPCB"],
    summary="JLCPCB/LCSC 부품 검색",
    description=(
        "자연어 설명으로 LCSC 부품번호·가격·재고 정보를 검색합니다. "
        "예: '3.3V LDO SOT-223 500mA', 'CAN transceiver 3.3V SOP-8'"
    ),
)
async def search_parts(body: PartsSearchRequest):
    try:
        svc = JLCPCBService(api_key=body.api_key)
        result = await svc.search_parts(
            query=body.query,
            category=body.category,
            package=body.package,
            jlcpcb_basic_only=body.jlcpcb_basic_only,
        )
    except Exception as e:
        msg = str(e)
        if any(k in msg.lower() for k in ("authentication", "api key", "401")):
            raise HTTPException(status_code=401, detail=f"OpenAI API 키 오류: {msg}")
        raise HTTPException(status_code=500, detail=f"부품 검색 실패: {msg}")

    return PartsSearchResponse(
        success=True,
        query=body.query,
        results=result.get("results", []),
        recommendation=result.get("recommendation"),
    )


# ─────────────────────────────────────────────
# JLCPCB BOM 생성
# ─────────────────────────────────────────────

@app.post(
    "/api/v1/bom/jlcpcb",
    response_model=JLCBOMResponse,
    tags=["JLCPCB"],
    summary="JLCPCB 주문용 BOM 생성",
    description=(
        "컴포넌트 목록에서 LCSC 부품번호·가격을 포함한 BOM을 생성합니다. "
        "JLCPCB 업로드용 CSV 포맷도 함께 반환됩니다."
    ),
)
async def generate_jlcpcb_bom(body: BOMRequest):
    try:
        svc = JLCPCBService(api_key=body.api_key)
        result = await svc.generate_bom(
            components=body.components,
            board_qty=body.board_qty,
        )
    except Exception as e:
        msg = str(e)
        if any(k in msg.lower() for k in ("authentication", "api key", "401")):
            raise HTTPException(status_code=401, detail=f"OpenAI API 키 오류: {msg}")
        raise HTTPException(status_code=500, detail=f"BOM 생성 실패: {msg}")

    return JLCBOMResponse(
        success=True,
        bom=result.get("bom", []),
        cost_summary=result.get("cost_summary", {}),
        warnings=result.get("warnings", []),
        jlcpcb_notes=result.get("jlcpcb_notes"),
        csv=result.get("csv"),
    )
