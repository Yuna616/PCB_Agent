@echo off
echo 🗑  __pycache__ 삭제 중...
for /d /r "%~dp0app" %%d in (__pycache__) do (
    if exist "%%d" (
        rmdir /s /q "%%d"
        echo    삭제: %%d
    )
)
echo ✅ 완료. 이제 python run.py 를 실행하세요.
pause
