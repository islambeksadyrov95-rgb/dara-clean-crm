-- Migration: per-manager folders for MicroSIP local recordings — CONTRACT step
-- Completes D-2026-06-15-recordings-per-manager-folder. The EXPAND step
-- (20260615000001_recordings_per_manager_folder_policy.sql) temporarily allowed BOTH the new
-- per-manager path local/<auth_uid>/<file> AND the legacy flat local/<file> path, so the policy
-- was safe to apply before the new client shipped. The new per-manager client is now live on
-- production (deployed in cbf831e and every later deploy), so this CONTRACT step drops the
-- legacy-flat allowance: authenticated clients may write ONLY into their own local/<auth_uid>/.
--
-- Safe rollout: a stale browser tab still on the old flat-path client gets its upload rejected
-- (error is not "exists") → uploadEntry returns false → the MP3 stays in the local folder and
-- re-syncs to local/<uid>/ once that tab reloads the new client. No data loss.
--
-- Server-side uploads (transcribe route, VPBX) use the service role and bypass RLS.
-- Created: 2026-06-15

drop policy if exists "authenticated upload own call-recordings folder" on storage.objects;
create policy "authenticated upload own call-recordings folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'call-recordings'
    and (storage.foldername(name))[1] = 'local'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
