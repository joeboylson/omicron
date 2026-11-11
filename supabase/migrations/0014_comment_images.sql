-- Images in comments: screenshots and photos, from people (the web page)
-- and from Claude sessions (attached to their reports).
--
-- The files live in Supabase Storage, in a private bucket, filed under the
-- Project: `<project id>/<random>-<file name>`. Only people and machines in
-- that Project can see them or add them. A comment lists its images' paths;
-- it can be only images, with no text.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comment-images', 'comment-images', false, 10485760, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

-- Whether the signed-in user can use the Project a file is filed under.
create function public.can_use_project_path(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_use_project(split_part(path, '/', 1)::uuid)
    else false
  end;
$$;
grant execute on function public.can_use_project_path(text) to authenticated;

-- Storage's tables outlive a reset of ours (migrate.sh --reset), so these
-- may already be there.
drop policy if exists "comment images: see" on storage.objects;
drop policy if exists "comment images: add" on storage.objects;
drop policy if exists "comment images: remove your own" on storage.objects;
create policy "comment images: see" on storage.objects for select to authenticated
  using (bucket_id = 'comment-images' and public.can_use_project_path(name));
create policy "comment images: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'comment-images' and public.can_use_project_path(name));
create policy "comment images: remove your own" on storage.objects for delete to authenticated
  using (bucket_id = 'comment-images' and owner = auth.uid());

alter table public.comments add column images text[] not null default '{}';
alter table public.comments drop constraint comments_body_check;
alter table public.comments add constraint comments_body_or_images
  check (length(trim(body)) > 0 or cardinality(images) > 0);
alter table public.comments add constraint comments_few_images check (cardinality(images) <= 10);

-- A comment's images must be filed under its own Project. (Chat messages
-- use this function too, and have no images.)
create or replace function public.fill_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.author_id := auth.uid();
  select coalesce(
    (select p.display_name from public.people p where p.id = new.author_id),
    (select m.name from public.machines m where m.id = new.author_id),
    ''
  ) into new.author_name;
  if new.session_id is not null and not exists (
    select 1 from public.sessions s
    where s.id = new.session_id and s.project_id = new.project_id and s.machine_id = new.author_id
  ) then
    raise exception 'a comment can only name a session of its own machine in the same Project' using errcode = '23514';
  end if;
  -- Nested, not `and`: plpgsql would still look up new.images on a chat message.
  if tg_table_name = 'comments' then
    if exists (select 1 from unnest(new.images) i where split_part(i, '/', 1) <> new.project_id::text) then
      raise exception 'a comment''s images must be filed under its own Project' using errcode = '23514';
    end if;
  end if;
  new.created_at := now();
  return new;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.can_use_project_path(text) to authenticated;
