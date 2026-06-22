# DaraClean Agbis agent — installer

One double-clickable `.exe` that sets up the binding+cancel agent on the office PC (the always-on
machine where Agbis/Firebird runs). It finds Agbis automatically, installs everything, and needs
**no Python and no admin rights** on the office PC.

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
3. **Autostart** — a hidden, auto-restarting Startup entry (per-user, no admin).
4. **Verifies** — runs `agent.exe --dry-run --once` and shows whether Firebird + Supabase + the depot-3
   junctions are reachable. Only then starts the daemon.

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
