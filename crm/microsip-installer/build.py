"""Build the DaraClean MicroSIP (telephony) installer with PyInstaller.

Bundles MicroSIP-*.exe (from vendor/) + telephony.config.json (constants + per-manager extensions +
shared encrypted password) into one windowed exe: installer/dist/DaraCleanTelephonySetup.exe.

Run from repo root:  python microsip-installer/build.py
Requires: pyinstaller; vendor/MicroSIP-*.exe present; telephony.config.json filled.
The built exe contains the SIP password → gitignored, ship by hand.
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE / "dist"
BUILD = HERE / "_build"


def main():
    cfg = HERE / "telephony.config.json"
    if not cfg.exists():
        sys.exit("ERROR: microsip-installer/telephony.config.json missing (copy from *.example.json)")
    msi = next(iter(HERE.glob("vendor/MicroSIP*.exe")), None)
    if not msi:
        sys.exit("ERROR: vendor/MicroSIP-*.exe missing")
    sep = ";"
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--onefile", "--windowed",
                    "--name", "DaraCleanTelephonySetup",
                    "--distpath", str(DIST), "--workpath", str(BUILD), "--specpath", str(BUILD),
                    "--paths", str(HERE), "--hidden-import", "microsip_config",
                    "--add-data", f"{msi}{sep}.",
                    "--add-data", f"{cfg}{sep}.",
                    str(HERE / "installer.py")], check=True)
    exe = DIST / "DaraCleanTelephonySetup.exe"
    if not exe.exists():
        sys.exit("ERROR: DaraCleanTelephonySetup.exe not produced")
    print(f"\nDONE: {exe}\nShip to each manager PC; pick the manager; it installs MicroSIP + configures it.")


if __name__ == "__main__":
    main()
