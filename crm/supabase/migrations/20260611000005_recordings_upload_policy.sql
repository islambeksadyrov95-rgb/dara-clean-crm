-- Migration: allow browser upload of MicroSIP local recordings
-- The CRM syncs MP3 files from a manager's local folder (File System Access API)
-- straight into the private `call-recordings` bucket. Authenticated CRM users get
-- INSERT; reads stay via service-role signed URLs, so no SELECT policy is added
-- (bucket remains private).
-- Created: 2026-06-11

drop policy if exists "authenticated upload call-recordings" on storage.objects;
create policy "authenticated upload call-recordings"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'call-recordings');
