-- ============================================================
-- 窮鬼地圖・200有找  Supabase 資料庫初始化腳本
-- ============================================================
-- 使用方式：
-- 1. 打開你的 Supabase 專案 → 左側選單「SQL Editor」
-- 2. 點「New query」
-- 3. 把這整份檔案的內容貼進去
-- 4. 按右下角「Run」執行
-- 這份腳本可以重複執行不會出錯（用了 IF NOT EXISTS / OR REPLACE）
-- ============================================================

-- 需要 uuid 產生函式
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 資料表：restaurants（品項回報，一列＝一間店的一道菜／一個套餐）
-- ------------------------------------------------------------
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  dish_name text not null,
  category text not null check (category in ('早餐','正餐','小吃','飲料','宵夜')),
  price int not null check (price >= 1 and price <= 200),
  rating numeric not null check (rating >= 1 and rating <= 5),
  comment text,
  lat double precision not null,
  lng double precision not null,
  nickname text,
  reporter_id uuid not null,
  photo_url text,
  likes int not null default 0,
  confirm_count int not null default 0,
  last_confirmed_at timestamptz,
  status text not null default 'approved' check (status in ('approved','pending','rejected')),
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 資料表：likes（防止重複按讚）
-- ------------------------------------------------------------
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reporter_id uuid not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, reporter_id)
);

-- ------------------------------------------------------------
-- 資料表：confirmations（「這個價格我最近也吃過，還準」）
-- ------------------------------------------------------------
create table if not exists public.confirmations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reporter_id uuid not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, reporter_id)
);

-- ------------------------------------------------------------
-- 資料表：reports_flag（檢舉錯誤資訊）
-- ------------------------------------------------------------
create table if not exists public.reports_flag (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Trigger：confirmations 新增一筆 → 自動更新 restaurants 的
-- confirm_count 與 last_confirmed_at（不交給前端手動算）
-- ------------------------------------------------------------
create or replace function public.handle_new_confirmation()
returns trigger as $$
begin
  update public.restaurants
  set confirm_count = confirm_count + 1,
      last_confirmed_at = now()
  where id = new.restaurant_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_confirmation_created on public.confirmations;
create trigger on_confirmation_created
  after insert on public.confirmations
  for each row execute function public.handle_new_confirmation();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.restaurants enable row level security;
alter table public.likes enable row level security;
alter table public.confirmations enable row level security;
alter table public.reports_flag enable row level security;

-- restaurants：所有人可讀
drop policy if exists "restaurants_select_all" on public.restaurants;
create policy "restaurants_select_all"
  on public.restaurants for select
  using (true);

-- restaurants：已登入（含匿名登入）使用者可新增，且限定寫入自己的 reporter_id，價格再檢查一次
drop policy if exists "restaurants_insert_authenticated" on public.restaurants;
create policy "restaurants_insert_authenticated"
  on public.restaurants for insert
  to authenticated
  with check (
    auth.uid() = reporter_id
    and price > 0 and price <= 200
  );

-- restaurants：使用者可以刪除「自己回報」的品項（用 reporter_id 判斷，別人的資料仍不能刪／改）
drop policy if exists "restaurants_delete_own" on public.restaurants;
create policy "restaurants_delete_own"
  on public.restaurants for delete
  to authenticated
  using (auth.uid() = reporter_id);

-- 一般使用者仍不可 UPDATE restaurants，也不能刪除別人回報的資料（避免亂改／亂刪別人回報）

-- likes：所有人可讀
drop policy if exists "likes_select_all" on public.likes;
create policy "likes_select_all"
  on public.likes for select
  using (true);

-- likes：已登入使用者可新增自己的讚
drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own"
  on public.likes for insert
  to authenticated
  with check (auth.uid() = reporter_id);

-- confirmations：所有人可讀（前端要算 N 人確認需要讀取）
drop policy if exists "confirmations_select_all" on public.confirmations;
create policy "confirmations_select_all"
  on public.confirmations for select
  using (true);

-- confirmations：已登入使用者可新增自己的確認
drop policy if exists "confirmations_insert_own" on public.confirmations;
create policy "confirmations_insert_own"
  on public.confirmations for insert
  to authenticated
  with check (auth.uid() = reporter_id);

-- reports_flag：已登入使用者可新增檢舉，先不開放讀取（僅後台看，之後再處理）
drop policy if exists "reports_flag_insert_authenticated" on public.reports_flag;
create policy "reports_flag_insert_authenticated"
  on public.reports_flag for insert
  to authenticated
  with check (true);

-- ------------------------------------------------------------
-- 資料表：profiles（登入使用者的公開資料，例如暱稱）
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ------------------------------------------------------------
-- 資料表：posts（討論區文章）
-- ------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  nickname text,
  title text not null,
  content text not null,
  likes int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.posts enable row level security;

drop policy if exists "posts_select_all" on public.posts;
create policy "posts_select_all"
  on public.posts for select
  using (true);

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own"
  on public.posts for delete
  to authenticated
  using (auth.uid() = author_id);

-- ------------------------------------------------------------
-- 資料表：comments（文章留言）
-- ------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null,
  nickname text,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

drop policy if exists "comments_select_all" on public.comments;
create policy "comments_select_all"
  on public.comments for select
  using (true);

drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own"
  on public.comments for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own"
  on public.comments for delete
  to authenticated
  using (auth.uid() = author_id);

-- ------------------------------------------------------------
-- 資料表：post_likes（文章按讚，防止重複按讚，同步更新 posts.likes）
-- ------------------------------------------------------------
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  liker_id uuid not null,
  created_at timestamptz not null default now(),
  unique (post_id, liker_id)
);

alter table public.post_likes enable row level security;

drop policy if exists "post_likes_select_all" on public.post_likes;
create policy "post_likes_select_all"
  on public.post_likes for select
  using (true);

drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own"
  on public.post_likes for insert
  to authenticated
  with check (auth.uid() = liker_id);

drop policy if exists "post_likes_delete_own" on public.post_likes;
create policy "post_likes_delete_own"
  on public.post_likes for delete
  to authenticated
  using (auth.uid() = liker_id);

create or replace function public.handle_post_like_change()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    update public.posts set likes = likes + 1 where id = new.post_id;
    return new;
  elsif (TG_OP = 'DELETE') then
    update public.posts set likes = greatest(0, likes - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_post_like_change on public.post_likes;
create trigger on_post_like_change
  after insert or delete on public.post_likes
  for each row execute function public.handle_post_like_change();

-- ------------------------------------------------------------
-- Storage：建立 photos bucket（存回報者上傳的菜單／收據照片）
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "photos_public_read" on storage.objects;
create policy "photos_public_read"
  on storage.objects for select
  using (bucket_id = 'photos');

drop policy if exists "photos_authenticated_upload" on storage.objects;
create policy "photos_authenticated_upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'photos');

-- ============================================================
-- 完成！可以到左側「Table Editor」確認四張表都建立好了。
-- ============================================================
