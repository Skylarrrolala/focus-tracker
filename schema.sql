-- Focus Tracker — Supabase schema
-- Run this in your Supabase project's SQL Editor (Project → SQL Editor → New query)

create extension if not exists "pgcrypto";

-- ---------- tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  name text not null,
  category text not null default 'Other',
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  estimate int not null default 25,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- sessions (completed focus sessions) ----------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  task_id uuid references public.tasks on delete set null,
  task_name text,
  category text,
  duration int not null,
  distractions int not null default 0,
  completed_full boolean not null default true,
  session_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------- settings (one row per user) ----------
create table if not exists public.settings (
  user_id uuid primary key references auth.users not null default auth.uid(),
  daily_goal int not null default 4,
  theme text not null default 'light',
  updated_at timestamptz not null default now()
);

-- ---------- row level security: every user only sees their own rows ----------
alter table public.tasks enable row level security;
alter table public.sessions enable row level security;
alter table public.settings enable row level security;

create policy "select own tasks" on public.tasks for select using (auth.uid() = user_id);
create policy "insert own tasks" on public.tasks for insert with check (auth.uid() = user_id);
create policy "update own tasks" on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own tasks" on public.tasks for delete using (auth.uid() = user_id);

create policy "select own sessions" on public.sessions for select using (auth.uid() = user_id);
create policy "insert own sessions" on public.sessions for insert with check (auth.uid() = user_id);
create policy "delete own sessions" on public.sessions for delete using (auth.uid() = user_id);

create policy "select own settings" on public.settings for select using (auth.uid() = user_id);
create policy "insert own settings" on public.settings for insert with check (auth.uid() = user_id);
create policy "update own settings" on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Helpful indexes
create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists sessions_user_id_date_idx on public.sessions(user_id, session_date);
