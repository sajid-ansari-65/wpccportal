-- Migration 01 — extra CSV columns + duplicate prevention
-- Run this ONCE in Supabase SQL Editor (Project → SQL Editor → New query).
--
-- IMPORTANT: step 2 fails if duplicate emails already exist in the table.
-- Step 1 shows them; clear them before running step 2.

-- ── 1. Every column from the sheet that isn't name/email/phone/college
--       gets preserved here instead of being thrown away on import.
alter table students
  add column if not exists attributes jsonb not null default '{}'::jsonb;

-- ── 2. Find any existing duplicate emails (should return 0 rows)
--       select lower(email) as email, count(*), array_agg(name)
--       from students where email is not null
--       group by lower(email) having count(*) > 1;

-- ── 3. One row per email, case-insensitive. Rows with no email are
--       exempt (partial index), since we can't dedupe those on email.
create unique index if not exists uniq_students_email_ci
  on students (lower(email))
  where email is not null;

-- ── 4. Helps the import's "which of these emails already exist?" lookup.
create index if not exists idx_students_email_lower
  on students (lower(email));
