-- Auto Stock Manager on Supabase, step 1 of option C: who may see and change what.
--
-- Run AFTER the asm_* tables exist (copy_mysql_to_supabase.py schema). Safe to run again; it also picks up
-- asm_* tables added since.
--
-- The same rules Auto Stock Manager's backend enforces today (server.py ROLE_PERMISSIONS), moved into the
-- database, so the app can later talk to Supabase directly (the way Jageer and Finance do):
--   * every row belongs to one company (company_id); a signed-in member sees and changes their own company's
--     rows only;
--   * Admin may do everything; Front desk, Parts and Social media only what their role lists below;
--   * the platform owner may read every company's rows, and change none.
-- A few finer rules (Social media's limited vehicle fields, Parts' limited status changes) are not row rules;
-- they move into database functions with the screens that use them.
begin;

-- ── Who is who ───────────────────────────────────────────────────────────
-- One row per login: the Supabase Auth user, the Auto Stock Manager account it came from, its company and role.
create table if not exists public.asm_members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  asm_user_id text unique,
  company_id  text,
  username    text not null,
  name        text,
  role        text not null check (role in ('admin', 'stock_supervisor', 'parts_supervisor', 'social_media', 'platform_owner')),
  created_at  timestamptz not null default now()
);
create index if not exists asm_members_company_idx on public.asm_members (company_id);
alter table public.asm_members enable row level security;

-- What each role other than Admin may do (server.py ROLE_PERMISSIONS). Admin is allowed everything.
create table if not exists public.asm_role_permissions (
  role     text not null,
  resource text not null,
  action   text not null,
  primary key (role, resource, action)
);
alter table public.asm_role_permissions enable row level security;
delete from public.asm_role_permissions;
insert into public.asm_role_permissions (role, resource, action) values
  ('stock_supervisor', 'vehicles', 'view'),
  ('stock_supervisor', 'vehicle_media', 'view'),
  ('stock_supervisor', 'vehicle_photos', 'view'),
  ('stock_supervisor', 'expenses', 'view'),
  ('stock_supervisor', 'team', 'view'), ('stock_supervisor', 'team', 'create'),
  ('stock_supervisor', 'team', 'edit'), ('stock_supervisor', 'team', 'delete'),
  ('stock_supervisor', 'vendor_lookup', 'view'), ('stock_supervisor', 'vendor_lookup', 'create'),
  ('stock_supervisor', 'warranty', 'view'), ('stock_supervisor', 'warranty', 'edit'),
  ('stock_supervisor', 'sale_statuses', 'edit'),
  ('parts_supervisor', 'spare_parts', 'view'), ('parts_supervisor', 'spare_parts', 'create'),
  ('parts_supervisor', 'spare_parts', 'edit'), ('parts_supervisor', 'spare_parts', 'delete'),
  ('parts_supervisor', 'jobs', 'view'), ('parts_supervisor', 'jobs', 'create'),
  ('parts_supervisor', 'jobs', 'edit'), ('parts_supervisor', 'jobs', 'delete'),
  ('parts_supervisor', 'vehicles', 'view'), ('parts_supervisor', 'vehicles', 'edit_status'),
  ('parts_supervisor', 'vehicle_media', 'view'),
  ('parts_supervisor', 'vehicle_photos', 'view'),
  ('parts_supervisor', 'vendor_lookup', 'view'), ('parts_supervisor', 'vendor_lookup', 'create'),
  ('parts_supervisor', 'vendors', 'view'), ('parts_supervisor', 'vendors', 'edit'),
  ('parts_supervisor', 'vendors', 'delete'), ('parts_supervisor', 'vendors', 'manage_payments'),
  ('parts_supervisor', 'team', 'view'), ('parts_supervisor', 'team', 'create'),
  ('parts_supervisor', 'team', 'edit'), ('parts_supervisor', 'team', 'delete'),
  ('social_media', 'vehicles', 'view'), ('social_media', 'vehicles', 'create_basic'),
  ('social_media', 'vehicle_photos', 'view'), ('social_media', 'vehicle_photos', 'create'),
  ('social_media', 'vehicle_photos', 'delete'),
  ('social_media', 'vehicle_media', 'view');

-- The signed-in member's company and role. security definer: they read asm_members past its own rules.
create or replace function public.asm_company() returns text
language sql stable security definer set search_path = public as $$
  select company_id from asm_members where user_id = auth.uid()
$$;

create or replace function public.asm_role() returns text
language sql stable security definer set search_path = public as $$
  select role from asm_members where user_id = auth.uid()
$$;

-- May the signed-in member do any of these actions on this resource?
create or replace function public.asm_can(resource text, actions text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce(asm_role(), '')
    when 'admin' then true
    when '' then false  -- not a member of any company
    else exists (select 1 from asm_role_permissions p
                  where p.role = asm_role() and p.resource = asm_can.resource and p.action = any (asm_can.actions))
  end
$$;

-- Members: everyone sees their own row; an Admin sees and manages their company's logins.
drop policy if exists asm_members_read on public.asm_members;
create policy asm_members_read on public.asm_members for select
  using (user_id = auth.uid() or (company_id = asm_company() and asm_can('team', array['view'])) or asm_role() = 'platform_owner');
drop policy if exists asm_members_admin on public.asm_members;
create policy asm_members_admin on public.asm_members for all
  using (company_id = asm_company() and asm_role() = 'admin')
  with check (company_id = asm_company() and asm_role() = 'admin' and role <> 'platform_owner');

-- ── The rules for each table ────────────────────────────────────────────
-- table -> the permission each kind of access needs: (view, create, edit, delete), each a list of actions on
-- one resource. A table not listed here is Admin-only (its resource is a name no role has).
create table if not exists public.asm_table_rules (
  table_name text primary key,
  resource   text not null,
  view_as    text[] not null,
  create_as  text[] not null,
  edit_as    text[] not null,
  delete_as  text[] not null,
  -- a second resource that also opens view/create (the vendor picker: vendor_lookup)
  also_resource text,
  also_view     text[],
  also_create   text[]
);
alter table public.asm_table_rules enable row level security;
delete from public.asm_table_rules;
insert into public.asm_table_rules values
  ('vehicles',          'vehicles',       '{view}', '{create,create_basic}', '{edit,edit_status,sale_statuses}', '{delete}', 'warranty', '{view}', null),
  ('vehicle_photos',    'vehicle_photos', '{view}', '{create}', '{create}', '{delete}', null, null, null),
  ('legal_documents',   'vehicle_media',  '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('expenses',          'expenses',       '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('spare_parts',       'spare_parts',    '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('kit_components',    'spare_parts',    '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('part_transactions', 'spare_parts',    '{view}', '{create,edit}', '{edit}', '{delete}', null, null, null),
  ('job_cards',         'jobs',           '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('vendors',           'vendors',        '{view}', '{create}', '{edit}',   '{delete}', 'vendor_lookup', '{view}', '{create}'),
  ('vendor_payments',   'vendors',        '{view}', '{manage_payments}', '{manage_payments}', '{manage_payments}', null, null, null),
  ('customers',         'customers',      '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('sales',             'sales',          '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('bookings',          'sales',          '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('team_members',      'team',           '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('emi_records',       'emi',            '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('emi_payments',      'emi',            '{view}', '{create}', '{edit}',   '{delete}', null, null, null),
  ('leads',             'leads',          '{view}', '{create}', '{edit}',   '{delete}', null, null, null);

-- Drops this file's old policies on a table and writes them again.
create or replace function public.asm_apply_rules(t text) returns void
language plpgsql as $$
declare
  r public.asm_table_rules;
  tbl text := 'asm_' || t;
  view_check text;
  create_check text;
begin
  select * into r from public.asm_table_rules where table_name = t;
  if r.table_name is null then  -- not listed: Admin only
    r := row(t, 'admin_only:' || t, '{view}', '{create}', '{edit}', '{delete}', null, null, null);
  end if;
  view_check := format('asm_can(%L, %L)', r.resource, r.view_as);
  create_check := format('asm_can(%L, %L)', r.resource, r.create_as);
  if r.also_resource is not null then
    if r.also_view is not null then view_check := view_check || format(' or asm_can(%L, %L)', r.also_resource, r.also_view); end if;
    if r.also_create is not null then create_check := create_check || format(' or asm_can(%L, %L)', r.also_resource, r.also_create); end if;
  end if;

  execute format('alter table public.%I enable row level security', tbl);
  execute format('drop policy if exists asm_read on public.%I', tbl);
  execute format('drop policy if exists asm_insert on public.%I', tbl);
  execute format('drop policy if exists asm_update on public.%I', tbl);
  execute format('drop policy if exists asm_delete on public.%I', tbl);
  execute format('create policy asm_read on public.%I for select using ((company_id = asm_company() and (%s)) or asm_role() = %L)',
                 tbl, view_check, 'platform_owner');
  execute format('create policy asm_insert on public.%I for insert with check (company_id = asm_company() and (%s))', tbl, create_check);
  execute format('create policy asm_update on public.%I for update using (company_id = asm_company() and asm_can(%L, %L)) with check (company_id = asm_company())',
                 tbl, r.resource, r.edit_as);
  execute format('create policy asm_delete on public.%I for delete using (company_id = asm_company() and asm_can(%L, %L))',
                 tbl, r.resource, r.delete_as);
end $$;

-- Every asm_* table with a company: company-scoped rules. Settings and the company row itself are readable by
-- every member (the business name and address show on every page); the copied login table, which holds
-- password hashes, gets no rules at all - nobody but the service role key can read it.
do $$
declare t text;
begin
  for t in
    select substring(c.table_name from 5) from information_schema.columns c
     where c.table_schema = 'public' and c.table_name like 'asm\_%' and c.column_name = 'company_id'
       and c.table_name not in ('asm_members', 'asm_users')
  loop
    perform public.asm_apply_rules(t);
  end loop;

  if to_regclass('public.asm_settings') is not null then
    execute 'drop policy if exists asm_read on public.asm_settings';
    execute 'create policy asm_read on public.asm_settings for select using (company_id = asm_company() or asm_role() = ''platform_owner'')';
  end if;
  if to_regclass('public.asm_companies') is not null then
    execute 'alter table public.asm_companies enable row level security';
    execute 'drop policy if exists asm_read on public.asm_companies';
    execute 'create policy asm_read on public.asm_companies for select using (id = asm_company() or asm_role() = ''platform_owner'')';
  end if;
  -- A set's components carry no company of their own: they follow their part.
  if to_regclass('public.asm_spare_parts_set_components') is not null then
    execute 'alter table public.asm_spare_parts_set_components enable row level security';
    execute 'drop policy if exists asm_read on public.asm_spare_parts_set_components';
    execute 'drop policy if exists asm_write on public.asm_spare_parts_set_components';
    execute 'create policy asm_read on public.asm_spare_parts_set_components for select using (exists (select 1 from public.asm_spare_parts p where p.id = part_id))';
    execute 'create policy asm_write on public.asm_spare_parts_set_components for all using (exists (select 1 from public.asm_spare_parts p where p.id = part_id and asm_can(''spare_parts'', ''{edit}''))) with check (exists (select 1 from public.asm_spare_parts p where p.id = part_id and asm_can(''spare_parts'', ''{edit}'')))';
  end if;
end $$;

-- ── Logins made for Auto Stock Manager are not Finance accounts ─────────────────
-- Finance gives every new login a profile (0002 / 0010). One created by the Auto Stock Manager login import
-- (user metadata app = 'asm') is skipped, so a showroom staff login does not turn up as an empty Finance book.
-- An owner who already has a Finance account keeps it and simply gets an asm_members row as well.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data ->> 'app' = 'asm' then
    return new;
  end if;
  insert into public.profiles (id, full_name, business_name, business_address)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'business_address'), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

commit;

notify pgrst, 'reload schema';
