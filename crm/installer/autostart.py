"""OS integration for the DaraClean agent — how the agent starts itself at boot/logon.

Two autostart modes (both use the same agent-run.cmd wrapper: auto-restart + log):
  startup — per-user Startup-folder .vbs → hidden cmd loop. No admin. Runs ONLY while the user is
            logged in.
  task    — a SYSTEM scheduled task (ONSTART). Runs even when nobody is logged in (PC just powered on).
            Needs admin once to create.

Pure OS calls — no Agbis discovery / no secrets here.
"""

import ctypes
import os
import pathlib
import subprocess

APP_NAME = "DaraCleanAgent"
TASK_NAME = "DaraCleanAgbisAgent"
VBS_NAME = "DaraClean-AgbisAgent.vbs"


def startup_dir():
    return pathlib.Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def write_run_cmd(install_dir):
    """The auto-restart + logging wrapper, shared by both modes. Returns its path."""
    agent_exe = install_dir / "agent.exe"
    run_cmd = install_dir / "agent-run.cmd"
    run_cmd.write_text(
        "@echo off\r\n"
        f'cd /d "{install_dir}"\r\n'
        ":loop\r\n"
        f'echo [%date% %time%] starting agent >> "{install_dir}\\agent.log"\r\n'
        f'"{agent_exe}" >> "{install_dir}\\agent.log" 2>&1\r\n'
        f'echo [%date% %time%] agent exited (%errorlevel%), restart in 15s >> "{install_dir}\\agent.log"\r\n'
        "timeout /t 15 /nobreak >nul\r\n"
        "goto loop\r\n",
        encoding="utf-8",
    )
    return run_cmd


def write_startup_vbs(install_dir):
    """Per-user autostart: a hidden launcher in the Startup folder (no admin)."""
    run_cmd = install_dir / "agent-run.cmd"
    startup_dir().mkdir(parents=True, exist_ok=True)
    vbs = startup_dir() / VBS_NAME
    vbs.write_text(f'CreateObject("WScript.Shell").Run "cmd /c ""{run_cmd}""", 0, False\r\n', encoding="utf-8")
    return vbs


def start_startup_daemon():
    subprocess.Popen(["wscript", str(startup_dir() / VBS_NAME)], close_fds=True)


def install_task(install_dir):
    """SYSTEM ONSTART task → runs at boot, no login needed. Needs admin. Starts it immediately.
    install_dir is under ProgramData (no spaces) so /tr needs no inner quoting."""
    run_cmd = install_dir / "agent-run.cmd"
    subprocess.run(
        ["schtasks", "/create", "/tn", TASK_NAME, "/tr", f"cmd /c {run_cmd}",
         "/sc", "ONSTART", "/ru", "SYSTEM", "/rl", "HIGHEST", "/f"],
        check=True, capture_output=True,
    )
    subprocess.run(["schtasks", "/run", "/tn", TASK_NAME], capture_output=True)


def task_exists():
    # capture_output WITHOUT text=True: schtasks prints in the OEM codepage; decoding with the ru-RU
    # locale (cp1251) raises UnicodeDecodeError on bytes like 0x98. We only need the return code → keep bytes.
    return subprocess.run(["schtasks", "/query", "/tn", TASK_NAME], capture_output=True).returncode == 0


def remove_startup():
    vbs = startup_dir() / VBS_NAME
    if vbs.exists():
        vbs.unlink()


def remove_task():
    subprocess.run(["schtasks", "/end", "/tn", TASK_NAME], capture_output=True)
    subprocess.run(["schtasks", "/delete", "/tn", TASK_NAME, "/f"], capture_output=True)


def stop_daemon():
    """Kill our auto-restart wrapper (so it won't relaunch) + agent.exe. Matches our install path, so the
    dev source agent (binding\\agent-run.cmd) is left untouched."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | "
          f"Where-Object {{ $_.CommandLine -like '*{APP_NAME}*agent-run.cmd*' }} | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
    subprocess.run(["taskkill", "/F", "/IM", "agent.exe"], capture_output=True)


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_as_admin(args, exe, script=None):
    """Re-launch elevated (UAC prompt). exe = sys.executable; script = installer.py path when not frozen.
    Returns True if the elevated process was started."""
    parts = ([f'"{script}"'] if script else []) + list(args)
    rc = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, " ".join(parts), None, 1)
    return int(rc) > 32
