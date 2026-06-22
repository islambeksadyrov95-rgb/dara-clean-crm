"""Central config resolver for the Agbis agent — shared by agent.py and cancel_recipe.py.

Two modes, auto-detected, so the existing source-run setup keeps working unchanged:

* INSTALLED (frozen exe, or an agent.config.json next to it): read every path + the Supabase
  credentials from agent.config.json. The installer discovers the real Agbis location on the office
  PC and writes this file, so nothing is hardcoded.
* DEV / SOURCE (no config file): fall back to the historical hardcoded Agbis paths and read the
  Supabase credentials from the repo's .env.local — identical to the original behaviour.

Resolved once at import and cached. agent.config.json shape:
  {"fb_client": "...", "fb_dsn": "...", "licensing_ini": "...",
   "supabase_url": "...", "supabase_key": "..."}
"""

import json
import pathlib
import re
import sys

# Historical hardcoded defaults (this dev/admin machine) — used only when no config file is present.
DEFAULTS = {
    "fb_client": r"C:\fb64client\fbclient.dll",
    "fb_dsn": "127.0.0.1/3050:C:/Agbis/DB/ARM_7.FDB",
    "licensing_ini": r"C:\Agbis\LicensingService.ini",
}
CONFIG_NAME = "agent.config.json"


def base_dir():
    """Directory that holds agent.config.json / .env.local: next to the exe when frozen, else repo root."""
    if getattr(sys, "frozen", False):
        return pathlib.Path(sys.executable).resolve().parent
    return pathlib.Path(__file__).resolve().parent.parent


def _supabase_from_env(bd):
    """DEV mode: read Supabase creds from .env.local next to base_dir (repo root)."""
    env_path = bd / ".env.local"
    if not env_path.exists():
        return None, None
    text = env_path.read_text(encoding="utf-8", errors="ignore")
    env = dict(re.findall(r"^([A-Z0-9_]+)=(.*)$", text, re.MULTILINE))
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    return (url or None), (key or None)


def _resolve():
    cfg = dict(DEFAULTS)
    bd = base_dir()
    config_path = bd / CONFIG_NAME
    if config_path.exists():
        cfg.update(json.loads(config_path.read_text(encoding="utf-8")))
    else:
        url, key = _supabase_from_env(bd)
        cfg["supabase_url"], cfg["supabase_key"] = url, key
    return cfg


CONFIG = _resolve()


def fb_client():
    return CONFIG["fb_client"]


def fb_dsn():
    return CONFIG["fb_dsn"]


def licensing_ini():
    return CONFIG["licensing_ini"]


def supabase():
    """(url, key). Raises a clear error if missing — the agent cannot reach the CRM without them."""
    url, key = CONFIG.get("supabase_url"), CONFIG.get("supabase_key")
    if not url or not key:
        raise RuntimeError(
            "Supabase credentials missing — expected supabase_url/supabase_key in "
            f"{base_dir() / CONFIG_NAME} or NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in .env.local"
        )
    return url, key


def fb_password():
    """Firebird SYSDBA password from Agbis' LicensingService.ini."""
    text = pathlib.Path(licensing_ini()).read_text(errors="ignore")
    return re.search(r"Password=(.+)", text).group(1).strip()
