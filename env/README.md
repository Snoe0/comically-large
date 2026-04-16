# Supabase configuration

`config.js` is loaded by both games (for uploading drawings) and by the gallery
(for listing drawings). It is **gitignored** so your keys stay local.

## 1. Fill in `config.js`

Copy `config.example.js` if `config.js` doesn't exist, then set:

- `url` — your project URL, e.g. `https://abcxyz.supabase.co`
- `anonKey` — anon (legacy) or publishable key from Supabase dashboard → API keys
- `bucket` — storage bucket name (default: `drawings`)
- `table` — metadata table name (default: `drawings`, optional)

## 2. Create the storage bucket

In Supabase dashboard → Storage:

1. Create a **public** bucket named `drawings` (or whatever you set in config).
2. Bucket policies needed:
   - `INSERT` allowed for the `anon` role (so the game can upload).
   - `SELECT` allowed for `anon` / public (so the gallery can list + fetch).

Quick SQL to allow anon insert + public read on the bucket:

```sql
-- allow anyone to upload into the drawings bucket
create policy "anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'drawings');

-- allow anyone to read/list the drawings bucket
create policy "public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'drawings');
```

## 3. (Optional) Metadata table

The game also writes a row per drawing so the gallery can show the caption.
If you don't want this, set `table: null` in `config.js`.

```sql
create table public.drawings (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  object_path  text not null,       -- path in the storage bucket
  caption      text,
  prompt       text
);

alter table public.drawings enable row level security;

create policy "anon insert drawings"
  on public.drawings for insert
  to anon, authenticated
  with check (true);

create policy "public read drawings"
  on public.drawings for select
  to anon, authenticated
  using (true);
```
