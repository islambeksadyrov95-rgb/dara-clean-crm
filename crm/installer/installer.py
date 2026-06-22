"""DaraClean Agbis agent — self-contained setup wizard.

Bundled (by build.py) with: agent.exe (the daemon, Python+firebird-driver inside), fbclient.dll
(64-bit), and secrets.json (Supabase url+key baked at build from .env.local). On the office PC it:
  1. finds Agbis automatically (LicensingService.ini + the Firebird .FDB),
  2. copies agent.exe + fbclient.dll into %LOCALAPPDATA%\DaraCleanAgent,
  3. writes agent.config.json (discovered Agbis paths + baked Supabase creds),
  4. installs a hidden auto-restarting autostart entry (per-user Startup — no admin),
  5. verifies (agent.exe --dry-run --once): Firebird + Supabase + depot-3 reachable.

GUI by default (Tkinter wizard). `--silent` runs discover→install→verify headless;
`--test` installs to a temp dir and skips autostart + daemon start (safe to run on the dev machine).
"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile

APP_NAME = "DaraCleanAgent"
DEFAULT_DB_NAME = "ARM_7.FDB"
DEFAULT_PORT = "3050"


def bundle_dir():
    """Where PyInstaller extracted our bundled data (agent.exe, fbclient.dll, secrets.json)."""
    return pathlib.Path(getattr(sys, "_MEIPASS", pathlib.Path(__file__).resolve().parent))


def baked_secrets():
    p = bundle_dir() / "secrets.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}


# ── discovery ─────────────────────────────────────────────────────────────────
def _fixed_drives():
    drives = []
    for letter in "CDEFGH":
        root = pathlib.Path(f"{letter}:\\")
        if root.exists():
            drives.append(root)
    return drives


def _find_licensing_ini():
    """LicensingService.ini marks the Agbis install root. Check likely paths, then a bounded scan."""
    likely = []
    for d in _fixed_drives():
        likely += [d / "Agbis" / "LicensingService.ini", d / "AGBIS" / "LicensingService.ini",
                   d / "Program Files" / "Agbis" / "LicensingService.ini",
                   d / "Program Files (x86)" / "Agbis" / "LicensingService.ini"]
    for p in likely:
        if p.exists():
            return p
    for d in _fixed_drives():  # shallow fallback scan (depth ~2) for a renamed folder
        for top in d.iterdir() if d.exists() else []:
            try:
                cand = top / "LicensingService.ini"
                if cand.exists():
                    return cand
            except (PermissionError, OSError):
                continue
    return None


def _find_fdb(agbis_root):
    db_dir = agbis_root / "DB"
    search = [db_dir] if db_dir.exists() else [agbis_root]
    fdbs = []
    for base in search:
        fdbs += list(base.glob("*.FDB")) + list(base.glob("*.fdb"))
    if not fdbs:
        return None
    for f in fdbs:
        if f.name.upper() == DEFAULT_DB_NAME:
            return f
    return fdbs[0]


def _detect_port(agbis_root):
    conf = agbis_root / "firebird.conf"
    if conf.exists():
        import re
        m = re.search(r"^\s*RemoteServicePort\s*=\s*(\d+)", conf.read_text(errors="ignore"), re.MULTILINE)
        if m:
            return m.group(1)
    return DEFAULT_PORT


def discover_agbis():
    """Return {agbis_root, licensing_ini, fb_dsn, fdb} or None if Agbis is not found."""
    ini = _find_licensing_ini()
    if not ini:
        return None
    root = ini.parent
    fdb = _find_fdb(root)
    if not fdb:
        return None
    port = _detect_port(root)
    dsn = f"127.0.0.1/{port}:{str(fdb).replace(chr(92), '/')}"
    return {"agbis_root": str(root), "licensing_ini": str(ini), "fdb": str(fdb), "fb_dsn": dsn}


# ── install ───────────────────────────────────────────────────────────────────
def startup_dir():
    return pathlib.Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def write_config(install_dir, found):
    secrets = baked_secrets()
    cfg = {
        "fb_client": str(install_dir / "fbclient.dll"),
        "fb_dsn": found["fb_dsn"],
        "licensing_ini": found["licensing_ini"],
        "supabase_url": secrets.get("supabase_url", ""),
        "supabase_key": secrets.get("supabase_key", ""),
    }
    (install_dir / "agent.config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


def write_autostart(install_dir):
    """A loop wrapper (auto-restart + log) launched hidden at logon via a Startup .vbs."""
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
    vbs = startup_dir() / "DaraClean-AgbisAgent.vbs"
    startup_dir().mkdir(parents=True, exist_ok=True)
    vbs.write_text(
        f'CreateObject("WScript.Shell").Run "cmd /c ""{run_cmd}""", 0, False\r\n', encoding="utf-8"
    )
    return run_cmd, vbs


def do_install(found, install_dir, with_autostart=True):
    install_dir.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(bundle_dir() / "agent.exe", install_dir / "agent.exe")
    shutil.copy2(bundle_dir() / "fbclient.dll", install_dir / "fbclient.dll")
    write_config(install_dir, found)
    if with_autostart:
        write_autostart(install_dir)
    return install_dir


def verify(install_dir):
    """Run agent.exe --dry-run --once and capture its output (Firebird+Supabase+depot reachability)."""
    out = subprocess.run([str(install_dir / "agent.exe"), "--dry-run", "--once"],
                         capture_output=True, text=True, timeout=90)
    return out.returncode, (out.stdout or "") + (out.stderr or "")


def start_daemon():
    vbs = startup_dir() / "DaraClean-AgbisAgent.vbs"
    subprocess.Popen(["wscript", str(vbs)], close_fds=True)


def stop_daemon():
    """Stop this install's daemon: kill its auto-restart wrapper (so it won't relaunch) + agent.exe.
    The wrapper is matched by the install-dir path so the dev source agent (binding\\agent-run.cmd) is
    left untouched."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | "
          f"Where-Object {{ $_.CommandLine -like '*{APP_NAME}*agent-run.cmd*' }} | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
    subprocess.run(["taskkill", "/F", "/IM", "agent.exe"], capture_output=True)


def uninstall():
    """Clean removal: drop the Startup entry, stop the daemon, delete the install dir."""
    import shutil
    install_dir = pathlib.Path(os.environ["LOCALAPPDATA"]) / APP_NAME
    vbs = startup_dir() / "DaraClean-AgbisAgent.vbs"
    if vbs.exists():
        vbs.unlink()
    stop_daemon()
    shutil.rmtree(install_dir, ignore_errors=True)
    _emit(f"Удалено: автозапуск ({vbs.name}), демон (agent.exe), папка {install_dir}.")
    _emit("ВАЖНО: если на этой машине был агент из исходника — снова запусти его.")
    return 0


# ── silent / test entry (GUI lives in gui_wizard) ────────────────────────────
LOGFILE = pathlib.Path(tempfile.gettempdir()) / "DaraCleanAgentSetup.log"


def _emit(msg):
    """Print when a console is attached (sys.stdout is None in a --windowed exe) and always append to
    a logfile — so --silent/--test/--check-gui stay verifiable even in the GUI build."""
    try:
        if sys.stdout is not None:
            print(msg, flush=True)
    except Exception:
        pass
    try:
        with open(LOGFILE, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        pass


def run_silent(test=False):
    _emit("Поиск Агбиса...")
    found = discover_agbis()
    if not found:
        _emit("ОШИБКА: Агбис не найден (нет LicensingService.ini + .FDB). Запусти на офисном ПК с Агбисом.")
        return 2
    _emit(f"  Агбис: {found['agbis_root']}")
    _emit(f"  Firebird DSN: {found['fb_dsn']}")
    install_dir = pathlib.Path(tempfile.gettempdir()) / (APP_NAME + "_test") if test \
        else pathlib.Path(os.environ["LOCALAPPDATA"]) / APP_NAME
    _emit(f"Установка в {install_dir}" + (" (TEST: без автозапуска)" if test else ""))
    do_install(found, install_dir, with_autostart=not test)
    code, log = verify(install_dir)
    _emit("--- проверка (agent.exe --dry-run --once) ---")
    _emit(log.strip())
    if code != 0:
        _emit("ОШИБКА проверки — см. вывод выше.")
        return 1
    if not test:
        start_daemon()
        _emit("Автозапуск установлен, демон запущен.")
        _emit("ВАЖНО: выключи агента на своей машине — в системе должен быть РОВНО ОДИН агент (депо 3).")
    _emit("Готово.")
    return 0


def check_gui():
    """Self-test for the frozen build: confirm the bundled files exist + Tkinter/gui_wizard load."""
    bd = bundle_dir()
    for name in ("agent.exe", "fbclient.dll", "secrets.json"):
        _emit(f"bundle {name}: {'OK' if (bd / name).exists() else 'MISSING'}")
    try:
        import gui_wizard  # noqa
        import tkinter
        tkinter.Tk().destroy()
        _emit("gui: gui_wizard + tkinter OK")
        return 0
    except Exception as e:
        _emit(f"gui: ERROR {e}")
        return 1


def main():
    if "--check-gui" in sys.argv:
        return check_gui()
    if "--uninstall" in sys.argv:
        return uninstall()
    if "--silent" in sys.argv or "--test" in sys.argv:
        return run_silent(test="--test" in sys.argv)
    import gui_wizard  # noqa: lazy import so headless/test mode needs no Tk
    return gui_wizard.run(globals())


if __name__ == "__main__":
    sys.exit(main())
