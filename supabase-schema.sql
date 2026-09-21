-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query)

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  college text,
  qr_token text unique not null default encode(gen_random_bytes(12), 'hex'),
  attended boolean not null default false,
  attended_at timestamptz,
  marked_via text, -- 'manual' | 'qr'
  attributes jsonb not null default '{}'::jsonb, -- every extra column from the sheet
  wp_username text, -- WordPress.org profile handle, collected at check-in
  created_at timestamptz default now()
);

create index if not exists idx_students_event on students(event_id);
create index if not exists idx_students_qr on students(qr_token);
create index if not exists idx_students_name on students using gin (to_tsvector('simple', name));

-- One row per email, case-insensitive. Rows without an email are exempt.
create unique index if not exists uniq_students_email_ci
  on students (lower(email)) where email is not null;
create index if not exists idx_students_email_lower on students (lower(email));
create index if not exists idx_students_wp_username
  on students (lower(wp_username)) where wp_username is not null;

-- Row Level Security: locked down. All access goes through the server
-- using the service_role key (never exposed to the browser), so no
-- public policies are needed.
alter table students enable row level security;
alter table events enable row level security;
