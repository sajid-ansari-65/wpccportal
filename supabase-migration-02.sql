-- Migration 02 — WordPress.org profile username
-- Run this ONCE in Supabase SQL Editor (Project → SQL Editor → New query).
--
-- Collected when attendance is marked, so the team can find attendees on
-- WordPress.org after the event. Stored lower-cased and without the '@'.

alter table students
  add column if not exists wp_username text;

-- Case-insensitive lookup, e.g. "who already claimed this handle?".
-- Deliberately NOT unique: two students sharing a typo'd handle should be
-- fixable on the day, not blocked at the door.
create index if not exists idx_students_wp_username
  on students (lower(wp_username))
  where wp_username is not null;
