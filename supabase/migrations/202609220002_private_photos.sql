insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'application-photos',
  'application-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif']
);

alter table public.application_photos
  add column content_type text not null,
  add column byte_size bigint not null,
  add constraint application_photos_content_type_check
    check (content_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  add constraint application_photos_byte_size_check
    check (byte_size > 0 and byte_size <= 10485760),
  add constraint application_photos_storage_path_check
    check (
      storage_path ~ '^opportunity/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/application/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    );
