-- ============================================================================
-- What is on production right now? Read-only; changes nothing.
-- Paste into the Supabase SQL Editor and run. One row comes back.
--
--   base_schema   false → run 01-schema.sql (whole thing)
--   invitations … false → run 03-upgrade.sql
--   everything    true  → schema is current; nothing to run
-- ============================================================================
select
  to_regclass('portal.organizations') is not null                         as base_schema,
  exists (select 1 from information_schema.columns
           where table_schema = 'portal' and table_name = 'invitations'
             and column_name = 'email')                                    as invitations,
  to_regprocedure('portal.org_open_invites(uuid)') is not null             as open_invites,
  to_regprocedure('portal.org_is_empty(uuid)') is not null                 as edit_delete,
  exists (select 1 from pg_policy where polname = 'invitation_insert')     as security_fixes,
  (select count(*) from public.students)                                   as legacy_students;
