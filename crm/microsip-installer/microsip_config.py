"""Generate a working microsip.ini for a chosen manager from the baked telephony.config.json.

The format mirrors a PROVEN working MicroSIP config (read from a live install): [Account1] with the
Beeline CloudPBX constants + the manager's extension (label/username/authid) + the shared
MicroSIP-encrypted password (portable across machines), plus [Settings] with call recording on.
MicroSIP's ini is UTF-16. Pure functions — the GUI/silent-install layer lives in installer.py.
"""

import configparser
import io
import json
import pathlib
import sys


def base_dir():
    """Folder holding telephony.config.json + the bundled MicroSIP exe (next to the frozen exe)."""
    if getattr(sys, "frozen", False):
        return pathlib.Path(getattr(sys, "_MEIPASS", pathlib.Path(sys.executable).resolve().parent))
    return pathlib.Path(__file__).resolve().parent


def load_config():
    return json.loads((base_dir() / "telephony.config.json").read_text(encoding="utf-8"))


def manager_names(cfg):
    return [m["name"] for m in cfg["managers"]]


def _manager_by_name(cfg, name):
    for m in cfg["managers"]:
        if m["name"] == name:
            return m
    raise KeyError(f"manager not found: {name}")


def build_ini(cfg, extension, recording_dir):
    """Return microsip.ini text for one extension. recording_dir is the absolute MP3 folder."""
    ext = str(extension)
    acc = {
        "label": ext, "server": cfg["sip_server"], "proxy": cfg["sip_proxy"], "domain": cfg["domain"],
        "username": ext, "password": cfg["password_encrypted"], "authid": ext,
        "transport": cfg.get("transport", "udp"),
        "registerrefresh": str(cfg.get("registerrefresh", "300")),
        "keepalive": str(cfg.get("keepalive", "15")),
        "publish": "0", "ice": "0", "allowrewrite": "0", "disablesessiontimer": "0",
    }
    settings = {
        "recordingpath": recording_dir,
        "recordingformat": cfg.get("recordingformat", "mp3"),
        "autorecording": cfg.get("autorecording", "1"),
        "recordingbutton": cfg.get("recordingbutton", "1"),
    }
    cp = configparser.ConfigParser()
    cp.optionxform = str  # keep key case as MicroSIP expects (lowercase already)
    cp["Account1"] = acc
    cp["Settings"] = settings
    buf = io.StringIO()
    cp.write(buf, space_around_delimiters=False)
    return buf.getvalue()


def write_ini(cfg, extension, recording_dir, dest_path):
    """Write microsip.ini as UTF-16 (MicroSIP's encoding) to dest_path."""
    dest_path = pathlib.Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_text(build_ini(cfg, extension, recording_dir), encoding="utf-16")
    return dest_path


if __name__ == "__main__":  # self-test: generate to a temp file, never touch the live config
    import tempfile
    cfg = load_config()
    print("managers:", manager_names(cfg))
    tmp = pathlib.Path(tempfile.gettempdir()) / "_microsip_test" / "microsip.ini"
    ext = cfg["managers"][0]["extension"]
    write_ini(cfg, ext, r"C:\Users\Test\DaraClean\Record call", tmp)
    back = tmp.read_text(encoding="utf-16")
    ok = all(s in back for s in (f"username={ext}", f"label={ext}", "server=cloudpbx.beeline.kz",
                                 "autorecording=1", "password="))
    print("ini written:", tmp, "| self-check:", "OK" if ok else "FAIL")
