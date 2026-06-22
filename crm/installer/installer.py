"""DaraClean Agbis agent — self-contained setup wizard.

Bundled (by build.py) with: agent.exe (the daemon, Python+firebird-driver inside), fbclient.dll
(64-bit), and secrets.json (Supabase url+key baked at build from .env.local). On the office PC it:
  1. finds Agbis automatically (LicensingService.ini + the Firebird .FDB),
  2. copies agent.exe + fbclient.dll into the install dir,
  3. writes agent.config.json (discovered Agbis paths + baked Supabase creds),
  4. installs autostart — per-user Startup (no admin) OR a SYSTEM scheduled task (--task, needs admin,
     runs even with nobody logged in),
  5. verifies (agent.exe --dry-run --once): Firebird + Supabase + depot-3 reachable.

GUI by default (Tkinter wizard). Flags: --silent (headless install), --task (always-on SYSTEM task,
self-elevates), --uninstall, --test (temp dir, no autostart/daemon — safe on the dev machine),
--check-gui (frozen-build self-test).
"""

import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

import autostart

APP_NAME = "DaraCleanAgent"
DEFAULT_DB_NAME = "ARM_7.FDB"
DEFAULT_PORT = "3050"
LOGFILE = pathlib.Path(tempfile.gettempdir()) / "DaraCleanAgentSetup.log"
LOCALAPPDATA_DIR = pathlib.Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / APP_NAME
PROGRAMDATA_DIR = pathlib.Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / APP_NAME


def _emit(msg):
    """Print when a console is attached (sys.stdout is None in a --windowed exe) and always append to a
    logfile — so --silent/--test/--check-gui stay verifiable even in the GUI build."""
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


def bundle_dir():
    """Where PyInstaller extracted our bundled data (agent.exe, fbclient.dll, secrets.json)."""
    return pathlib.Path(getattr(sys, "_MEIPASS", pathlib.Path(__file__).resolve().parent))


def baked_secrets():
    p = bundle_dir() / "secrets.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


# ── discovery ─────────────────────────────────────────────────────────────────
def _fixed_drives():
    return [pathlib.Path(f"{d}:\\") for d in "CDEFGH" if pathlib.Path(f"{d}:\\").exists()]


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
    for d in _fixed_drives():  # shallow fallback scan (depth ~1) for a renamed folder
        try:
            tops = list(d.iterdir())
        except (PermissionError, OSError):
            continue
        for top in tops:
            try:
                cand = top / "LicensingService.ini"
                if cand.exists():
                    return cand
            except (PermissionError, OSError):
                continue
    return None


def _find_fdb(agbis_root):
    db_dir = agbis_root / "DB"
    fdbs = []
    for base in ([db_dir] if db_dir.exists() else [agbis_root]):
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


def discover_agbis(root_hint=None):
    """Return {agbis_root, licensing_ini, fb_dsn, fdb} or None if Agbis is not found.
    root_hint = a folder the user picked manually (must contain LicensingService.ini); falls back to
    the automatic scan when no hint is given or the hint has no LicensingService.ini."""
    ini = None
    if root_hint:
        cand = pathlib.Path(root_hint) / "LicensingService.ini"
        if cand.exists():
            ini = cand
    if ini is None:
        ini = _find_licensing_ini()
    if not ini:
        return None
    root = ini.parent
    fdb = _find_fdb(root)
    if not fdb:
        return None
    dsn = f"127.0.0.1/{_detect_port(root)}:{str(fdb).replace(chr(92), '/')}"
    return {"agbis_root": str(root), "licensing_ini": str(ini), "fdb": str(fdb), "fb_dsn": dsn}


# ── install ───────────────────────────────────────────────────────────────────
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


def install_dir_for(mode, test=False):
    """task → ProgramData (SYSTEM-friendly, no spaces); startup → per-user LocalAppData; test → temp."""
    if test:
        return pathlib.Path(tempfile.gettempdir()) / (APP_NAME + "_test")
    return PROGRAMDATA_DIR if mode == "task" else LOCALAPPDATA_DIR


def do_install(found, install_dir, mode):
    """mode: 'startup' (Startup .vbs), 'task' (SYSTEM ONSTART), or 'none' (files only, for --test)."""
    install_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(bundle_dir() / "agent.exe", install_dir / "agent.exe")
    shutil.copy2(bundle_dir() / "fbclient.dll", install_dir / "fbclient.dll")
    write_config(install_dir, found)
    autostart.write_run_cmd(install_dir)
    if mode == "startup":
        autostart.write_startup_vbs(install_dir)
    elif mode == "task":
        autostart.install_task(install_dir)
    return install_dir


def verify(install_dir):
    """Run agent.exe --dry-run --once and capture its output (Firebird+Supabase+depot reachability)."""
    out = subprocess.run([str(install_dir / "agent.exe"), "--dry-run", "--once"],
                         capture_output=True, text=True, errors="replace", timeout=90)
    return out.returncode, (out.stdout or "") + (out.stderr or "")


def cleanup_existing():
    """Guarantee EXACTLY ONE agent (depot-3 invariant): clear any prior install of EITHER autostart mode
    and stop its daemon before installing the new one. Idempotent. remove_task needs admin — the caller
    elevates when a SYSTEM task is present."""
    autostart.remove_startup()
    if autostart.task_exists():
        autostart.remove_task()
    autostart.stop_daemon()


def run_silent(test=False, mode="startup"):
    _emit("Поиск Агбиса...")
    found = discover_agbis()
    if not found:
        _emit("ОШИБКА: Агбис не найден (нет LicensingService.ini + .FDB). Запусти на офисном ПК с Агбисом.")
        return 2
    _emit(f"  Агбис: {found['agbis_root']}")
    _emit(f"  Firebird DSN: {found['fb_dsn']}")
    eff_mode = "none" if test else mode
    install_dir = install_dir_for(mode, test=test)
    if not test:
        cleanup_existing()  # one-agent guarantee: remove any previous install/mode first
    _emit(f"Установка в {install_dir}" + (" (TEST: без автозапуска)" if test else f" [{mode}]"))
    try:
        do_install(found, install_dir, eff_mode)
    except Exception as e:  # silent/elevated run has no console — surface the failure in the log
        _emit(f"ОШИБКА установки: {e}")
        return 1
    code, log = verify(install_dir)
    _emit("--- проверка (agent.exe --dry-run --once) ---")
    _emit(log.strip())
    if code != 0:
        _emit("ОШИБКА проверки — см. вывод выше.")
        return 1
    if not test:
        if mode == "task":
            _emit("Служба установлена (Task ONSTART, SYSTEM) и запущена — работает даже без входа в систему.")
        else:
            autostart.start_startup_daemon()
            _emit("Автозапуск (при входе в систему) установлен, демон запущен.")
        _emit("ВАЖНО: в системе должен быть РОВНО ОДИН агент (депо 3) — выключи агента на других машинах.")
    _emit("Готово.")
    return 0


def uninstall():
    autostart.remove_startup()
    autostart.remove_task()
    autostart.stop_daemon()
    for d in (LOCALAPPDATA_DIR, PROGRAMDATA_DIR):
        shutil.rmtree(d, ignore_errors=True)
    if autostart.task_exists():  # remove_task needs admin — if UAC was declined the SYSTEM task survives
        _emit("ВНИМАНИЕ: SYSTEM-задача НЕ снята (нужны права администратора). Запусти uninstall «от администратора».")
        return 1
    _emit("Удалено: автозапуск + задача (служба) + демон + папки установки.")
    _emit("Если на этой машине был агент из исходника — снова запусти его.")
    return 0


def check_gui():
    """Self-test for the frozen build: confirm bundled files exist + Tkinter/gui_wizard/autostart load."""
    bd = bundle_dir()
    for name in ("agent.exe", "fbclient.dll", "secrets.json"):
        _emit(f"bundle {name}: {'OK' if (bd / name).exists() else 'MISSING'}")
    try:
        import gui_wizard  # noqa
        import tkinter
        tkinter.Tk().destroy()
        _emit(f"gui: gui_wizard + tkinter OK; admin={autostart.is_admin()}")
        return 0
    except Exception as e:
        _emit(f"gui: ERROR {e}")
        return 1


def _elevate(flag_args):
    """Re-launch elevated (UAC) with the given flags. Returns True if elevation was started (caller exits)."""
    frozen = getattr(sys, "frozen", False)
    script = None if frozen else str(pathlib.Path(__file__).resolve())
    _emit("Нужны права администратора — запрашиваю (подтвердите UAC)...")
    return autostart.relaunch_as_admin(flag_args, sys.executable, script)


def main():
    if "--check-gui" in sys.argv:
        return check_gui()
    if "--uninstall" in sys.argv:
        if autostart.task_exists() and not autostart.is_admin() and _elevate(["--uninstall"]):
            return 0
        return uninstall()
    if "--silent" in sys.argv or "--test" in sys.argv:
        test = "--test" in sys.argv
        task = "--task" in sys.argv
        # Admin needed to create a SYSTEM task OR to clear an existing one before reinstall (one-agent guarantee).
        need_admin = not test and (task or autostart.task_exists())
        if need_admin and not autostart.is_admin():
            if _elevate(["--silent"] + (["--task"] if task else [])):
                return 0
        return run_silent(test=test, mode="task" if task else "startup")
    import gui_wizard  # noqa: lazy import so headless/test mode needs no Tk
    return gui_wizard.run(globals())


if __name__ == "__main__":
    sys.exit(main())
