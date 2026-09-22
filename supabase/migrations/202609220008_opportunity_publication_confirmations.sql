create or replace function public.hard_rule_confirmations_are_complete(
  rules_snapshot jsonb,
  confirmed_rule_ids jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select
    jsonb_typeof(rules_snapshot) = 'array'
    and jsonb_typeof(confirmed_rule_ids) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(confirmed_rule_ids) as confirmation(value)
      where jsonb_typeof(confirmation.value) <> 'string'
    )
    and (
      select coalesce(
        array_agg(confirmation.value #>> '{}' order by confirmation.value #>> '{}'),
        array[]::text[]
      )
      from jsonb_array_elements(confirmed_rule_ids) as confirmation(value)
    ) = (
      select coalesce(
        array_agg(rule.value ->> 'id' order by rule.value ->> 'id'),
        array[]::text[]
      )
      from jsonb_array_elements(rules_snapshot) as rule(value)
      where rule.value ->> 'effect' = 'hard_fail'
    );
$$;

alter table public.opportunities
add column confirmed_hard_rule_ids jsonb not null default '[]'::jsonb,
add constraint opportunities_hard_rule_confirmations_complete
check (
  public.hard_rule_confirmations_are_complete(
    rules_snapshot,
    confirmed_hard_rule_ids
  )
);

revoke all on function public.hard_rule_confirmations_are_complete(jsonb, jsonb)
from public;

grant execute on function public.hard_rule_confirmations_are_complete(jsonb, jsonb)
to anon, authenticated, service_role;
