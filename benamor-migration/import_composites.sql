-- =====================================================================
-- Benamor POS - composite products import (same old-system backup 16-09-2026; the
-- table simply was not part of the first extraction batch).
-- Loads pos_composite_items.csv (690 rows / 344 composite parents) into public.pos_composite_items.
-- Idempotent: skips rows whose id OR (composite_code, component_code) already exists
-- (protects composites created by hand in the new app since go-live).
--   psql ... -v DRY_RUN=1 -f import_composites.sql   (report, rollback)
--   psql ... -v DRY_RUN=0 -f import_composites.sql   (commit)
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\if :{?DRY_RUN}
\else
  \set DRY_RUN 1
\endif
begin;
set local statement_timeout = 0;

create schema if not exists mig_stage;
drop table if exists mig_stage.composites;
create table mig_stage.composites (id uuid, composite_code text, component_code text, component_name text, qty numeric);
\copy mig_stage.composites from 'pos_composite_items.csv' with (format csv, header true)

insert into public.pos_composite_items (id, composite_code, component_code, component_name, qty)
select c.id, c.composite_code, c.component_code, c.component_name, c.qty
from mig_stage.composites c
where not exists (select 1 from public.pos_composite_items x where x.id = c.id)
  and not exists (select 1 from public.pos_composite_items x
                  where x.composite_code = c.composite_code and x.component_code = c.component_code);

\set QUIET off
\echo '=== composite import verification'
select 'staged_rows (expect 690)' t, count(*) from mig_stage.composites
union all select 'distinct_composite_products (expect 344)', count(distinct composite_code) from mig_stage.composites
union all select 'rows_from_this_file_now_present (expect 690)', (select count(*) from public.pos_composite_items x join mig_stage.composites c on c.id = x.id)
union all select 'pairs_already_present_other_id (info)', (select count(*) from mig_stage.composites c where exists (select 1 from public.pos_composite_items x where x.composite_code = c.composite_code and x.component_code = c.component_code and x.id <> c.id))
union all select 'parents_missing_in_pos_products (expect 0)', (select count(*) from mig_stage.composites c where not exists (select 1 from public.pos_products p where p.code = c.composite_code))
union all select 'components_missing_in_pos_products (expect 0)', (select count(*) from mig_stage.composites c where not exists (select 1 from public.pos_products p where p.code = c.component_code));

\echo '=== codes not found in pos_products (informational; empty = perfect)'
(select 'parent' kind, c.composite_code code, c.component_code used_by, c.qty from mig_stage.composites c
 where not exists (select 1 from public.pos_products p where p.code = c.composite_code))
union all
(select 'component', c.component_code, c.composite_code, c.qty from mig_stage.composites c
 where not exists (select 1 from public.pos_products p where p.code = c.component_code))
order by 1, 2;

drop table mig_stage.composites;

\if :DRY_RUN
  \echo '*** DRY RUN - rolling back, nothing was written ***'
  rollback;
\else
  commit;
  \echo '*** COMMITTED ***'
\endif
