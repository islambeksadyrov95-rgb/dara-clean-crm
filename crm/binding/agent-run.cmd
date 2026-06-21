@echo off
REM Persistent runner for the Agbis binding+cancel agent (binding/agent.py).
REM Runs the daemon (poll every 150s), auto-restarts if it ever exits, logs to agent.log.
REM Launched hidden at logon by agent-autostart.vbs in the Startup folder (see binding/README.md).
REM MUST run on the admin machine that has Firebird/Agbis (127.0.0.1:3050) — never on Vercel.
cd /d "D:\Mind map\Dara Clean\crm"
:loop
echo [%date% %time%] starting agent >> "binding\agent.log"
"C:\Program Files\Python311\python.exe" "binding\agent.py" >> "binding\agent.log" 2>&1
echo [%date% %time%] agent exited (code %errorlevel%), restarting in 15s >> "binding\agent.log"
timeout /t 15 /nobreak >nul
goto loop
