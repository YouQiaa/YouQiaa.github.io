-- Wait For UR · Supabase 初始化脚本
-- 在 Supabase Dashboard → SQL Editor 里整段粘贴执行一次即可。

-- ============ 表结构 ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nickname text not null,
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.pets (
  id text primary key,
  source text not null default 'user',
  owner_id uuid references auth.users(id) on delete cascade,
  owner_email text not null default '',
  owner_name text,
  name text not null,
  species text,
  age text,
  sex text,
  neuter text,
  vaccine text,
  city text,
  quote text,
  contact text,
  tags text[] not null default '{}',
  photo_keys text[] not null default '{}',
  status text not null default 'pending',
  stage text not null default 'waiting',
  reject_reason text,
  coords jsonb,
  label jsonb,
  flag text,
  created_at bigint not null,
  adopted_at bigint
);
create index if not exists pets_status_idx on public.pets (status);
create index if not exists pets_owner_idx on public.pets (owner_id);

create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  pet_id text not null references public.pets(id) on delete cascade,
  created_at bigint not null,
  primary key (user_id, pet_id)
);

create table if not exists public.comments (
  id text primary key,
  pet_id text not null references public.pets(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_email text not null,
  author_name text not null,
  text text not null default '',
  photo_keys text[] not null default '{}',
  created_at bigint not null
);
create index if not exists comments_pet_idx on public.comments (pet_id);

create table if not exists public.comment_likes (
  comment_id text not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (comment_id, user_id)
);

create table if not exists public.replies (
  id text primary key,
  comment_id text not null references public.comments(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_email text not null,
  author_name text not null,
  text text not null,
  created_at bigint not null
);
create index if not exists replies_comment_idx on public.replies (comment_id);

create table if not exists public.applications (
  id text primary key,
  pet_id text not null references public.pets(id) on delete cascade,
  pet_name text,
  to_email text not null,
  from_id uuid not null references auth.users(id) on delete cascade,
  from_email text not null,
  from_name text not null,
  intro text not null,
  housing text,
  contact text not null,
  status text not null default 'pending',
  created_at bigint not null,
  updated_at bigint
);
create index if not exists applications_pet_idx on public.applications (pet_id);
create index if not exists applications_from_idx on public.applications (from_id);

create table if not exists public.posts (
  id text primary key,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_email text not null,
  author_name text not null,
  text text not null default '',
  photo_keys text[] not null default '{}',
  created_at bigint not null
);

-- ============ 管理员判定（security definer 绕过 RLS） ============
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    join public.profiles p on p.email = a.email
    where p.id = auth.uid()
  );
$$;

-- 注册时自动建资料；第一个注册的账号自动成为管理员（方便审核）
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare nick text;
begin
  nick := coalesce(nullif(trim(new.raw_user_meta_data->>'nickname'), ''), split_part(new.email, '@', 1));
  insert into public.profiles (id, email, nickname)
    values (new.id, lower(new.email), left(nick, 12))
    on conflict (id) do nothing;

  insert into public.admins (email)
    select lower(new.email)
    where not exists (select 1 from public.admins);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.pets enable row level security;
alter table public.favorites enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.replies enable row level security;
alter table public.applications enable row level security;
alter table public.posts enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- admins：只能看到自己那一条
drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins for select
  using (email = (select email from public.profiles where id = auth.uid()));

-- pets
drop policy if exists pets_select on public.pets;
create policy pets_select on public.pets for select
  using (status in ('approved', 'adopted') or owner_id = auth.uid() or public.is_admin());
drop policy if exists pets_insert on public.pets;
create policy pets_insert on public.pets for insert
  with check (owner_id = auth.uid());
drop policy if exists pets_update on public.pets;
create policy pets_update on public.pets for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists pets_delete on public.pets;
create policy pets_delete on public.pets for delete
  using (owner_id = auth.uid() or public.is_admin());

-- favorites
drop policy if exists favorites_all on public.favorites;
create policy favorites_all on public.favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- comments
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select using (true);
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert
  with check (author_id = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete
  using (author_id = auth.uid() or public.is_admin());

-- comment_likes
drop policy if exists likes_select on public.comment_likes;
create policy likes_select on public.comment_likes for select using (true);
drop policy if exists likes_all on public.comment_likes;
create policy likes_all on public.comment_likes for insert
  with check (user_id = auth.uid());
drop policy if exists likes_delete on public.comment_likes;
create policy likes_delete on public.comment_likes for delete
  using (user_id = auth.uid());

-- replies
drop policy if exists replies_select on public.replies;
create policy replies_select on public.replies for select using (true);
drop policy if exists replies_insert on public.replies;
create policy replies_insert on public.replies for insert
  with check (author_id = auth.uid());

-- applications
drop policy if exists apps_select on public.applications;
create policy apps_select on public.applications for select
  using (from_id = auth.uid() or public.is_admin()
    or to_email = (select email from public.profiles where id = auth.uid()));
drop policy if exists apps_insert on public.applications;
create policy apps_insert on public.applications for insert
  with check (from_id = auth.uid());
drop policy if exists apps_update on public.applications;
create policy apps_update on public.applications for update
  using (public.is_admin()
    or to_email = (select email from public.profiles where id = auth.uid())
    or exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = auth.uid()))
  with check (true);

-- posts
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select using (true);
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert
  with check (author_id = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete
  using (author_id = auth.uid() or public.is_admin());

-- ============ Storage ============
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do update set public = true;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select
  using (bucket_id = 'photos');
drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects for insert
  with check (bucket_id = 'photos' and auth.uid() is not null);
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete
  using (bucket_id = 'photos' and auth.uid() is not null);
