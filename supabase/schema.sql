create table if not exists public.veritas_context_records (
  watermark_id text primary key check (watermark_id ~ '^[a-f0-9]{32}$'),
  source_id text not null default '',
  source_name text not null default '',
  registered_by text not null default '',
  transaction_signature text not null default '',
  content_fingerprint text not null default '',
  context_hash text not null default '',
  context_memo_signature text not null default '',
  original_file_name text not null default '',
  claim jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.veritas_context_records
  add column if not exists context_hash text not null default '';

alter table public.veritas_context_records
  add column if not exists context_memo_signature text not null default '';

create table if not exists public.veritas_context_flags (
  id uuid primary key,
  watermark_id text not null references public.veritas_context_records(watermark_id) on delete cascade,
  reason text not null check (reason in ('location', 'date', 'subject', 'description', 'other')),
  details text not null,
  created_at timestamptz not null default now()
);

create index if not exists veritas_context_flags_watermark_id_idx
  on public.veritas_context_flags(watermark_id);

create table if not exists public.veritas_context_citations (
  id uuid primary key,
  watermark_id text not null references public.veritas_context_records(watermark_id) on delete cascade,
  cited_by text not null,
  cited_by_source_name text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists veritas_context_citations_watermark_id_idx
  on public.veritas_context_citations(watermark_id);

alter table public.veritas_context_records enable row level security;
alter table public.veritas_context_flags enable row level security;
alter table public.veritas_context_citations enable row level security;

drop policy if exists "veritas context records are readable" on public.veritas_context_records;
create policy "veritas context records are readable"
  on public.veritas_context_records
  for select
  to anon, authenticated
  using (true);

drop policy if exists "veritas context records are insertable" on public.veritas_context_records;
create policy "veritas context records are insertable"
  on public.veritas_context_records
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "veritas context records are updatable" on public.veritas_context_records;
create policy "veritas context records are updatable"
  on public.veritas_context_records
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "veritas context flags are readable" on public.veritas_context_flags;
create policy "veritas context flags are readable"
  on public.veritas_context_flags
  for select
  to anon, authenticated
  using (true);

drop policy if exists "veritas context flags are insertable" on public.veritas_context_flags;
create policy "veritas context flags are insertable"
  on public.veritas_context_flags
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "veritas context citations are readable" on public.veritas_context_citations;
create policy "veritas context citations are readable"
  on public.veritas_context_citations
  for select
  to anon, authenticated
  using (true);

drop policy if exists "veritas context citations are insertable" on public.veritas_context_citations;
create policy "veritas context citations are insertable"
  on public.veritas_context_citations
  for insert
  to anon, authenticated
  with check (true);
