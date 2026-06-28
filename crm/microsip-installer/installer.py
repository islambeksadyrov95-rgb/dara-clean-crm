"""DaraClean MicroSIP setup — per-manager softphone installer (office manager PCs).

One screen: pick the manager. Then it silently installs the bundled MicroSIP, writes a working
microsip.ini (Beeline CloudPBX account for that extension + the shared encrypted password + call
recording on), and creates the recording folder. The manager then connects that folder in the CRM.

Bundled by build.py with: MicroSIP-*.exe + telephony.config.json (constants + per-manager extensions
+ shared MicroSIP-encrypted password, baked at build).

GUI by default. Flags: --check (frozen self-test: bundle + config + ini-gen, no install),
--list (print managers). The actual MicroSIP install runs only from the GUI «Установить».
"""

import os
import pathlib
import subprocess
import sys
import tempfile

import microsip_config as mc

APP_TITLE = "Установка телефонии DaraClean (MicroSIP)"
RECORDING_DIR = r"%USERPROFILE%\DaraClean\Record call"


def bundled_microsip():
    """Path to the bundled MicroSIP installer exe inside the package."""
    for p in mc.base_dir().glob("MicroSIP*.exe"):
        return p
    return None


def microsip_ini_path():
    return pathlib.Path(os.environ["APPDATA"]) / "MicroSIP" / "microsip.ini"


def install_for(extension, log=print):
    """Silent-install MicroSIP (if bundled) + write microsip.ini for this extension + make rec folder."""
    cfg = mc.load_config()
    rec = os.path.expandvars(RECORDING_DIR)
    pathlib.Path(rec).mkdir(parents=True, exist_ok=True)
    setup = bundled_microsip()
    if setup:
        log(f"Установка MicroSIP ({setup.name})...")
        subprocess.run([str(setup), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], check=False)
    else:
        log("MicroSIP не вшит — пропускаю установку (настрою только конфиг).")
    ini = microsip_ini_path()
    mc.write_ini(cfg, extension, rec, ini)
    log(f"Конфиг записан: {ini}")
    log(f"Папка записей: {rec}")
    return ini


def check():
    cfg = mc.load_config()
    print("bundle MicroSIP:", bundled_microsip() or "MISSING")
    print("managers:", mc.manager_names(cfg))
    tmp = pathlib.Path(tempfile.gettempdir()) / "_microsip_check" / "microsip.ini"
    mc.write_ini(cfg, cfg["managers"][0]["extension"], r"C:\Tmp\rec", tmp)
    ok = "server=cloudpbx.beeline.kz" in tmp.read_text(encoding="utf-16")
    import shutil
    shutil.rmtree(tmp.parent, ignore_errors=True)
    print("ini-gen:", "OK" if ok else "FAIL")
    return 0 if (bundled_microsip() and ok) else 1


def run_gui():
    import threading
    import tkinter as tk
    from tkinter import ttk
    cfg = mc.load_config()
    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("560x420")
    ttk.Label(root, text=APP_TITLE, font=("Segoe UI", 12, "bold")).pack(pady=(12, 6))
    ttk.Label(root, text="Кому ставим телефонию (выбери менеджера):").pack(anchor="w", padx=14)
    names = mc.manager_names(cfg)
    sel = ttk.Combobox(root, values=names, state="readonly")
    # НЕ выбираем первого по умолчанию: иначе на 2-м ПК молча садился добавочный 0367 (баг —
    # «настройки сели как у первого менеджера»). Принуждаем к явному выбору перед установкой.
    sel.set("— выбери менеджера —")
    sel.pack(fill="x", padx=14, pady=6)
    log = tk.Text(root, height=14, wrap="word")
    log.pack(fill="both", expand=True, padx=14, pady=8)

    def say(m):
        log.insert("end", m + "\n"); log.see("end"); root.update_idletasks()

    def go():
        name = sel.get()
        if name not in names:  # пусто/плейсхолдер → не даём ставить «первого по умолчанию»
            say("Сначала выбери менеджера в списке.")
            return
        btn.configure(state="disabled")
        ext = next(m["extension"] for m in cfg["managers"] if m["name"] == name)

        def work():
            try:
                say(f"Менеджер: {name} (добавочный {ext})")
                install_for(ext, say)
                say("Готово! MicroSIP настроен. Открой MicroSIP — линия зарегистрируется.")
                say("Дальше: в CRM подключи папку записей звонков (один раз).")
            except Exception as e:
                say(f"ОШИБКА: {e}")
            finally:
                btn.configure(state="normal")
        threading.Thread(target=work, daemon=True).start()

    btn = ttk.Button(root, text="Установить", command=go)
    btn.pack(side="right", padx=14, pady=(0, 12))
    ttk.Button(root, text="Закрыть", command=root.destroy).pack(side="left", padx=14, pady=(0, 12))
    root.mainloop()
    return 0


def main():
    if "--check" in sys.argv:
        return check()
    if "--list" in sys.argv:
        print("\n".join(mc.manager_names(mc.load_config())))
        return 0
    return run_gui()


if __name__ == "__main__":
    sys.exit(main())
