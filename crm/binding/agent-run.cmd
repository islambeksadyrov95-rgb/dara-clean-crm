@echo off
REM Persistent runner for the Agbis binding+cancel agent (binding/agent.py).
REM Runs the daemon (poll every 5s), auto-restarts if it ever exits, logs to agent.log
REM (rotated to agent.log.1 at ~5 MB so it never grows unbounded under a crash loop).
REM Self-locating: cd to this script's OWN folder (binding/) via %~dp0, so the repo can be
REM moved/renamed without editing this file. Python: the known deps-correct interpreter, else PATH.
REM MUST run on the admin machine that has Firebird/Agbis (127.0.0.1:3050) — never on Vercel.
cd /d "%~dp0"
set "PYEXE=C:\Program Files\Python311\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"
:loop
if exist "agent.log" for %%A in ("agent.log") do if %%~zA GTR 5242880 (
  if exist "agent.log.1" del "agent.log.1"
  move /y "agent.log" "agent.log.1" >nul
)
echo [%date% %time%] starting agent (%PYEXE%) >> "agent.log"
"%PYEXE%" "agent.py" >> "agent.log" 2>&1
echo [%date% %time%] agent exited (code %errorlevel%), restarting in 15s >> "agent.log"
timeout /t 15 /nobreak >nul
goto loop
