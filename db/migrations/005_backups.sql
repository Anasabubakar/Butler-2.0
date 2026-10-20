-- Saved files already copied to Google Drive, so each one is uploaded once.
create table backed_up_files (
  path text primary key,
  drive_id text not null,
  uploaded_at timestamptz not null default now()
);
