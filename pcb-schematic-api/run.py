"""
PCB Schematic API — 서버 실행 스크립트
실행: python run.py
"""
import os
import shutil
import sys

# ── __pycache__ 자동 정리 (소스 변경 후 오래된 .pyc 충돌 방지) ──────────
def _clean_pycache(base: str) -> None:
    for root, dirs, _ in os.walk(base):
        for d in dirs:
            if d == "__pycache__":
                path = os.path.join(root, d)
                try:
                    shutil.rmtree(path)
                except Exception:
                    pass  # 권한 없으면 Python이 알아서 재컴파일

_clean_pycache(os.path.join(os.path.dirname(__file__), "app"))

import uvicorn
from dotenv import load_dotenv

load_dotenv()

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

if __name__ == "__main__":
    print(f"🔧 PCB Schematic API 시작 → http://{HOST}:{PORT}")
    print(f"📖 Swagger UI → http://localhost:{PORT}/docs")
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=True,
        log_level="info",
    )
