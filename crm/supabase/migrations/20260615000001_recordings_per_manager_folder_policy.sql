-- Migration: per-manager folders for MicroSIP local recordings — EXPAND step
-- Recordings now upload to call-recordings/local/<manager_uid>/<file>.mp3 instead of a
-- shared flat local/ prefix. The flat prefix keyed objects by filename only, so two
-- managers with identically-named MP3s collided: the second upload hit "exists" and the
-- recording was silently dropped (never stored, never attached to the call).
-- Per-manager folders isolate each manager's recordings and remove the collision.
--
-- EXPAND/CONTRACT — this INSERT policy is intentionally backwards-compatible so it can be
-- applied in ANY order relative to the client deploy (no breakage window, tolerant of a
-- stale browser tab still running the old flat-path client):
--   * new per-manager path  local/<auth_uid>/<file>  -> allowed ONLY for the owner
--   * legacy flat path       local/<file>            -> still allowed (transition only)
-- Once every browser runs the new build, apply the CONTRACT step (drop the legacy-flat
-- branch — exact SQL recorded in DECISIONS D-2026-06-15) to require per-manager folders.
--
-- Server-side uploads (transcribe route, VPBX) use the service role and bypass RLS, so they
-- are unaffected. Reads stay via service-role signed URLs (bucket remains private — no
-- SELECT policy).
-- Created: 2026-06-15

drop policy if exists "authenticated upload call-recordings" on storage.objects;
drop policy if exists "authenticated upload own call-recordings folder" on storage.objects;
create policy "authenticated upload own call-recordings folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'call-recordings'
    and (storage.foldername(name))[1] = 'local'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or array_length(storage.foldername(name), 1) = 1
    )
  );
