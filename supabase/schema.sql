create extension if not exists "pgcrypto";

create table if not exists public.prompt_groups (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  prompt text not null default '',
  negative_prompt text default '',
  memo text default '',
  category text default '',
  tags text[] not null default '{}',
  favorite boolean not null default false,
  created_at timestamptz not null,
  registered_at timestamptz not null,
  updated_at timestamptz not null,
  representative_image_id text,
  deleted_at timestamptz
);

create table if not exists public.generated_images (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id text not null references public.prompt_groups(id) on delete cascade,
  title text default '',
  memo text default '',
  tags text[] not null default '{}',
  status text not null default 'pending',
  favorite boolean not null default false,
  rating integer not null default 0 check (rating between 0 and 5),
  width integer not null default 0,
  height integer not null default 0,
  file_type text not null default 'image/webp',
  hash text not null default '',
  storage_path text not null,
  storage_mode text not null default 'webp-1024-only',
  original_width integer,
  original_height integer,
  original_file_type text,
  registered_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.reference_images (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id text not null references public.prompt_groups(id) on delete cascade,
  type text not null default 'other',
  memo text default '',
  width integer not null default 0,
  height integer not null default 0,
  file_type text not null default 'image/webp',
  hash text not null default '',
  storage_path text not null,
  storage_mode text not null default 'webp-1024-only',
  original_width integer,
  original_height integer,
  original_file_type text,
  registered_at timestamptz not null,
  deleted_at timestamptz
);

create index if not exists prompt_groups_user_updated_idx
  on public.prompt_groups(user_id, updated_at desc);

create index if not exists generated_images_user_group_idx
  on public.generated_images(user_id, group_id);

create index if not exists reference_images_user_group_idx
  on public.reference_images(user_id, group_id);

alter table public.prompt_groups enable row level security;
alter table public.generated_images enable row level security;
alter table public.reference_images enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.prompt_groups to authenticated;
grant select, insert, update, delete on public.generated_images to authenticated;
grant select, insert, update, delete on public.reference_images to authenticated;

drop policy if exists "prompt_groups_select_own" on public.prompt_groups;
create policy "prompt_groups_select_own"
  on public.prompt_groups for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "prompt_groups_insert_own" on public.prompt_groups;
create policy "prompt_groups_insert_own"
  on public.prompt_groups for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "prompt_groups_update_own" on public.prompt_groups;
create policy "prompt_groups_update_own"
  on public.prompt_groups for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "prompt_groups_delete_own" on public.prompt_groups;
create policy "prompt_groups_delete_own"
  on public.prompt_groups for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "generated_images_select_own" on public.generated_images;
create policy "generated_images_select_own"
  on public.generated_images for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "generated_images_insert_own" on public.generated_images;
create policy "generated_images_insert_own"
  on public.generated_images for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "generated_images_update_own" on public.generated_images;
create policy "generated_images_update_own"
  on public.generated_images for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "generated_images_delete_own" on public.generated_images;
create policy "generated_images_delete_own"
  on public.generated_images for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "reference_images_select_own" on public.reference_images;
create policy "reference_images_select_own"
  on public.reference_images for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "reference_images_insert_own" on public.reference_images;
create policy "reference_images_insert_own"
  on public.reference_images for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "reference_images_update_own" on public.reference_images;
create policy "reference_images_update_own"
  on public.reference_images for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "reference_images_delete_own" on public.reference_images;
create policy "reference_images_delete_own"
  on public.reference_images for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "archive_images_select_own" on storage.objects;
create policy "archive_images_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'archive-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "archive_images_insert_own" on storage.objects;
create policy "archive_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'archive-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "archive_images_update_own" on storage.objects;
create policy "archive_images_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'archive-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'archive-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "archive_images_delete_own" on storage.objects;
create policy "archive_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'archive-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
