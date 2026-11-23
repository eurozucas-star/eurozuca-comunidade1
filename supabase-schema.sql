-- Eurozuca Comunidade: esquema da base de dados (Postgres / Supabase)
-- Pode correr este ficheiro no SQL Editor do Supabase. O servidor também o aplica sozinho no primeiro pedido.

create table if not exists ez_accounts (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('person','company')),
  name          text not null check (char_length(name) between 2 and 90),
  email         text not null unique check (char_length(email) <= 200),
  password_hash text not null,
  plan          text not null default 'free' check (plan in ('free','empresa','premium')),
  status        text not null default 'active' check (status in ('active','blocked')),
  created_at    timestamptz not null default now()
);

create table if not exists ez_sessions (
  token_hash  text primary key,
  account_id  bigint not null references ez_accounts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists ez_sessions_account_idx on ez_sessions(account_id);

create table if not exists ez_listings (
  id          bigint generated always as identity primary key,
  account_id  bigint not null references ez_accounts(id) on delete cascade,
  kind        text not null check (kind in ('offer','request')),
  title       text not null check (char_length(title) between 4 and 100),
  category    text not null,
  city        text not null check (char_length(city) between 2 and 80),
  description text not null check (char_length(description) between 15 and 1000),
  whatsapp    text not null check (whatsapp ~ '^[0-9]{8,15}$'),
  status      text not null default 'active' check (status in ('active','closed','removed')),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists ez_listings_dir_idx on ez_listings(status, kind, created_at desc);
create index if not exists ez_listings_account_idx on ez_listings(account_id);

create table if not exists ez_login_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  email      text not null,
  created_at timestamptz not null default now()
);
create index if not exists ez_login_attempts_idx on ez_login_attempts(created_at);

-- O acesso é feito só pelo servidor (ligação direta ao Postgres).
-- Ativar RLS sem políticas bloqueia o acesso público pela API REST do Supabase (chave anon).
alter table ez_accounts       enable row level security;
alter table ez_sessions       enable row level security;
alter table ez_listings       enable row level security;
alter table ez_login_attempts enable row level security;
