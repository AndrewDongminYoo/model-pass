create table public.application_photo_upload_reservations (
  id uuid primary key,
  application_id uuid not null references public.applications(id) on delete cascade,
  storage_path text not null unique,
  content_type text not null check (
    content_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif')
  ),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  created_at timestamptz not null default now(),
  check (
    storage_path ~ '^opportunity/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/application/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

alter table public.application_photo_upload_reservations enable row level security;

revoke all on table public.application_photo_upload_reservations
from public, anon, authenticated;

grant select, insert, update, delete
on table public.application_photo_upload_reservations
to service_role;
