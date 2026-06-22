"""Generate/merge a working microsip.ini for a chosen manager from the baked telephony.config.json.

NON-DESTRUCTIVE line-based merge: an existing microsip.ini (the live config has ~140 keys — audio
devices, codecs, window state) is preserved exactly — same key CASING, order, and untouched keys.
Only the Account1 identity (label/username/authID + server/proxy/domain/password) and recording flags
are forced; an already-set recordingPath is KEPT so a working machine's CRM-connected folder is not
changed. MicroSIP keys are camelCase (authID, registerRefresh, recordingPath…) and the file is UTF-16.
"""

import json
import pathlib
import sys

# Canonical MicroSIP key casing (verified against a live microsip.ini).
ACCOUNT_ORDER = ["label", "server", "proxy", "domain", "username", "password", "authID",
                 "transport", "registerRefresh", "keepAlive", "publish", "ICE",
                 "allowRewrite", "disableSessionTimer"]


def base_dir():
    if getattr(sys, "frozen", False):
        return pathlib.Path(getattr(sys, "_MEIPASS", pathlib.Path(sys.executable).resolve().parent))
    return pathlib.Path(__file__).resolve().parent


def load_config():
    return json.loads((base_dir() / "telephony.config.json").read_text(encoding="utf-8"))


def manager_names(cfg):
    return [m["name"] for m in cfg["managers"]]


def _targets(cfg, extension, recording_dir):
    ext = str(extension)
    acc = {
        "label": ext, "server": cfg["sip_server"], "proxy": cfg["sip_proxy"], "domain": cfg["domain"],
        "username": ext, "password": cfg["password_encrypted"], "authID": ext,
        "transport": cfg.get("transport", "udp"),
        "registerRefresh": str(cfg.get("registerRefresh", cfg.get("registerrefresh", "300"))),
        "keepAlive": str(cfg.get("keepAlive", cfg.get("keepalive", "15"))),
        "publish": "0", "ICE": "0", "allowRewrite": "0", "disableSessionTimer": "0",
    }
    settings = {
        "recordingPath": recording_dir,
        "recordingFormat": cfg.get("recordingformat", "mp3"),
        "autoRecording": cfg.get("autorecording", "1"),
        "recordingButton": cfg.get("recordingbutton", "1"),
    }
    order = {"Account1": ACCOUNT_ORDER, "Settings": list(settings)}
    return ({"Account1": acc, "Settings": settings}, order,
            {"Settings": {"recordingpath"}})  # only_if_absent (lower-keyed)


def build_ini(cfg, extension, recording_dir, existing_text=None):
    targets, order, only_if_absent = _targets(cfg, extension, recording_dir)
    lines = (existing_text or "").splitlines()
    # existing lower-keys per target section, to honor only_if_absent
    existing = {s: set() for s in targets}
    cur = None
    for ln in lines:
        s = ln.strip()
        if s.startswith("[") and s.endswith("]"):
            cur = s[1:-1]
        elif cur in existing and "=" in s and not s.startswith(";"):
            existing[cur].add(s.split("=", 1)[0].strip().lower())
    # effective targets (drop only_if_absent keys that already exist)
    want = {}
    for sec, kv in targets.items():
        skip = only_if_absent.get(sec, set())
        want[sec] = {k.lower(): (k, v) for k, v in kv.items()
                     if not (k.lower() in skip and k.lower() in existing[sec])}
    # walk + update in place (preserve original key spelling/order/untouched lines)
    out, applied, cur = [], {s: set() for s in targets}, None
    for ln in lines:
        s = ln.strip()
        if s.startswith("[") and s.endswith("]"):
            if cur in want:  # flush unapplied keys at end of previous section
                for lk, (k, v) in want[cur].items():
                    if lk not in applied[cur]:
                        out.append(f"{k}={v}")
            cur = s[1:-1]
            out.append(ln)
            continue
        if cur in want and "=" in s and not s.startswith(";"):
            lk = s.split("=", 1)[0].strip().lower()
            if lk in want[cur] and lk not in applied[cur]:
                out.append(f"{want[cur][lk][0]}={want[cur][lk][1]}")
                applied[cur].add(lk)
                continue
        out.append(ln)
    if cur in want:
        for lk, (k, v) in want[cur].items():
            if lk not in applied[cur]:
                out.append(f"{k}={v}")
    # append target sections that did not exist at all (fresh PC), in canonical order
    seen = {ln.strip()[1:-1] for ln in lines if ln.strip().startswith("[") and ln.strip().endswith("]")}
    for sec in targets:
        if sec not in seen:
            out.append(f"[{sec}]")
            for k in order[sec]:
                if k.lower() in want[sec]:
                    out.append(f"{want[sec][k.lower()][0]}={want[sec][k.lower()][1]}")
    return "\n".join(out) + "\n"


def write_ini(cfg, extension, recording_dir, dest_path):
    """Merge into the existing microsip.ini at dest_path (UTF-16), preserving all other settings."""
    dest_path = pathlib.Path(dest_path)
    existing = dest_path.read_text(encoding="utf-16") if dest_path.exists() else None
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_text(build_ini(cfg, extension, recording_dir, existing), encoding="utf-16")
    return dest_path


if __name__ == "__main__":  # fresh-PC self-test (no existing file) → never touches a live config
    import tempfile
    cfg = load_config()
    print("managers:", manager_names(cfg))
    tmp = pathlib.Path(tempfile.gettempdir()) / "_microsip_test" / "microsip.ini"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    if tmp.exists():
        tmp.unlink()
    ext = cfg["managers"][0]["extension"]
    write_ini(cfg, ext, r"C:\Users\Test\DaraClean\Record call", tmp)
    back = tmp.read_text(encoding="utf-16")
    ok = all(s in back for s in (f"username={ext}", f"authID={ext}", "server=cloudpbx.beeline.kz",
                                 "autoRecording=1", "recordingPath=", "password="))
    print("fresh ini:", "OK" if ok else "FAIL")
    import shutil
    shutil.rmtree(tmp.parent, ignore_errors=True)
