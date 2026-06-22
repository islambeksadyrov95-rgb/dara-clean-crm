"""Build the DaraClean Agbis agent installer with PyInstaller.

Produces two exes in installer/dist:
  agent.exe              — the daemon (Python + firebird-driver bundled; no Python needed on the office PC)
  DaraCleanAgentSetup.exe — the wizard; bundles agent.exe + fbclient.dll + secrets.json (Supabase creds
                            baked from ../.env.local at build time — never committed to git)

Run from the repo root:  python installer/build.py
Requires: pyinstaller (pip), a 64-bit fbclient.dll (default C:\\fb64client\\fbclient.dll).
"""

import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent          # repo root (crm/)
INST = ROOT / "installer"
BINDING = ROOT / "binding"
BUILD = INST / "_build"                                          # work dir (gitignored)
DIST = INST / "dist"
FB_CLIENT = pathlib.Path(os.environ.get("FB_CLIENT", r"C:\fb64client\fbclient.dll"))


def read_secrets():
    text = (ROOT / ".env.local").read_text(encoding="utf-8", errors="ignore")
    env = dict(re.findall(r"^([A-Z0-9_]+)=(.*)$", text, re.MULTILINE))
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        sys.exit("ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local")
    return {"supabase_url": url, "supabase_key": key}


def pyinstaller(*args):
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm",
                    "--distpath", str(DIST), "--workpath", str(BUILD), "--specpath", str(BUILD), *args],
                   check=True)


def build_agent():
    pyinstaller("--onefile", "--name", "agent", "--console",
                "--collect-all", "firebird", "--paths", str(BINDING), str(BINDING / "agent.py"))
    exe = DIST / "agent.exe"
    if not exe.exists():
        sys.exit("ERROR: agent.exe not produced")
    return exe


def build_setup(agent_exe):
    if not FB_CLIENT.exists():
        sys.exit(f"ERROR: 64-bit fbclient.dll not found at {FB_CLIENT} (set FB_CLIENT env to override)")
    BUILD.mkdir(parents=True, exist_ok=True)
    secrets_file = BUILD / "secrets.json"
    secrets_file.write_text(json.dumps(read_secrets()), encoding="utf-8")
    sep = ";"  # windows add-data separator
    pyinstaller("--onefile", "--windowed", "--name", "DaraCleanAgentSetup", "--paths", str(INST),
                "--hidden-import", "gui_wizard",
                "--add-data", f"{agent_exe}{sep}.",
                "--add-data", f"{FB_CLIENT}{sep}.",
                "--add-data", f"{secrets_file}{sep}.",
                str(INST / "installer.py"))
    secrets_file.unlink(missing_ok=True)  # don't leave the key on disk
    setup = DIST / "DaraCleanAgentSetup.exe"
    if not setup.exists():
        sys.exit("ERROR: DaraCleanAgentSetup.exe not produced")
    return setup


def main():
    print(">> building agent.exe ...")
    agent_exe = build_agent()
    print(">> building DaraCleanAgentSetup.exe ...")
    setup = build_setup(agent_exe)
    print(f"\nDONE:\n  {agent_exe}\n  {setup}")
    print("Ship DaraCleanAgentSetup.exe to the office PC and double-click it.")


if __name__ == "__main__":
    main()
