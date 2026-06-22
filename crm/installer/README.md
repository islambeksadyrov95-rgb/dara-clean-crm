# DaraClean Agbis agent — installer

One double-clickable `.exe` that sets up the binding+cancel agent on the office PC (the always-on
machine where Agbis/Firebird runs). It finds Agbis automatically and installs everything — **no Python
needed** on the office PC. Admin is needed **only** for the optional always-on mode (SYSTEM task);
the default per-user Startup mode needs no admin.

## What gets built

`python installer/build.py` → `installer/dist/`:

- **`agent.exe`** — the daemon itself, with Python + `firebird-driver` bundled inside. This is why the
  office PC needs no Python.
- **`DaraCleanAgentSetup.exe`** — the wizard. Bundles `agent.exe`, a 64-bit `fbclient.dll`, and
  `secrets.json` (Supabase URL + service-role key, **baked from `../.env.local` at build time**).

Build requirements (on your dev machine only): `pip install pyinstaller`, and a 64-bit `fbclient.dll`
(default `C:\fb64client\fbclient.dll`; override with the `FB_CLIENT` env var).

> The built exes contain the Supabase service-role key, so they are **gitignored** and must be shipped
> by hand (USB / direct copy) — never commit them or upload them publicly.

## What the wizard does on the office PC

1. **Finds Agbis** — scans for `LicensingService.ini` + the Firebird `.FDB`, derives the DSN
   (`127.0.0.1/<port>:<db>`). If not found, asks you to point at the Agbis folder.
2. **Installs** to `%LOCALAPPDATA%\DaraCleanAgent`: copies `agent.exe` + `fbclient.dll`, writes
   `agent.config.json` (discovered Agbis paths + baked Supabase creds).
3. **Autostart** — two modes:
   - **Startup (default, no admin)** → install to `%LOCALAPPDATA%\DaraCleanAgent`; a hidden, auto-restarting
     entry in the per-user Startup folder. Runs **only while that user is logged in**.
   - **Always-on (checkbox / `--task`, needs admin once)** → install to `C:\ProgramData\DaraCleanAgent`;
     a **SYSTEM scheduled task** (`ONSTART`). Runs **even when nobody is logged in** (PC just powered on).
     The wizard self-elevates (UAC) if you tick the box without admin.
4. **One-agent guarantee** — every install first clears any previous install of **either** mode and stops
   its daemon, so there is never more than one depot-3 agent (the ID-collision invariant).
5. **Verifies** — runs `agent.exe --dry-run --once` and shows whether Firebird + Supabase + the depot-3
   junctions are reachable. Only then starts the daemon.

### Flags (frozen exe)
- `--silent` headless install · `--task` always-on (self-elevates) · `--uninstall` (self-elevates if a
  SYSTEM task exists) · `--test` (temp dir, no autostart) · `--check-gui` (frozen self-test).
- Uninstall removes both autostart modes (Startup `.vbs` + scheduled task) and both install dirs.

## Deploy

1. On your dev machine: `python installer/build.py`
2. Copy `installer/dist/DaraCleanAgentSetup.exe` to the office PC, double-click, follow the wizard.
3. **Turn off the agent on your dev machine** — there must be exactly ONE agent in the whole system
   (depot-3 junction-id safety). Kill its `python`/`agent.exe` process and delete its Startup `.vbs`.

## Test without touching production

`python installer/installer.py --test` (after staging `agent.exe`/`fbclient.dll`/`secrets.json` next
to `installer.py`, or just run the built `DaraCleanAgentSetup.exe`'s logic) installs to a temp dir,
**skips autostart and does not start a second daemon**, and runs the dry-run verification — safe to run
on the dev machine.

## Config the agent reads (`agent.config.json`, next to `agent.exe`)

```json
{ "fb_client": "...\\fbclient.dll", "fb_dsn": "127.0.0.1/3050:C:/Agbis/DB/ARM_7.FDB",
  "licensing_ini": "C:\\Agbis\\LicensingService.ini", "supabase_url": "...", "supabase_key": "..." }
```

When this file is absent (running from source on the dev machine), the agent falls back to the historical
hardcoded Agbis paths + `../.env.local` — so the existing source setup keeps working unchanged.
See `binding/agent_config.py`.

## Notes

- **Always-on task has NO execution time limit.** It is created from XML with `ExecutionTimeLimit=PT0S`
  (the plain `schtasks /create` default of ~3 days would otherwise terminate this long-running daemon).
  It also ignores battery state and allows only one instance. Runs as LocalSystem (SID `S-1-5-18`).
- **Secret exposure in always-on mode.** Per-user (Startup) mode keeps `agent.config.json` in
  `%LOCALAPPDATA%` (only that user reads it). Always-on (task) mode keeps it in `C:\ProgramData\...`,
  whose default ACL lets any local user read the file — i.e. the Supabase service-role key. On a shared
  office PC lock it down once (elevated):
  `icacls "C:\ProgramData\DaraCleanAgent" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F`
  (SYSTEM + Administrators keep full access; everyone else loses read).
