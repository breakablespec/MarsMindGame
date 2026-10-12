-- MARS MIND: players, quests and the MARS ledger.
-- Run once in Supabase → SQL Editor (or `supabase db push`).
-- Login is NOT Supabase Auth: players sign in with X on the Netlify functions,
-- and only those functions (service role key) can read or write these tables.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  x_id        text not null unique,                 -- X user id (stable, never changes)
  handle      text not null,                        -- @handle (updated on every login)
  name        text,
  avatar_url  text,
  ref_code    text not null unique,                 -- this player's referral code
  referred_by text,                                 -- ref_code of whoever invited them
  tokens      bigint not null default 0,            -- MARS balance (sum of ledger)
  best        jsonb not null default '{}'::jsonb,   -- best sol / score / stage / colonists
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists players_referred_by on public.players (referred_by);

create table if not exists public.quests (
  player_id    uuid not null references public.players(id) on delete cascade,
  quest        text not null check (quest in ('follow', 'like', 'rt', 'reply')),
  opened_at    timestamptz,                         -- the player opened the quest link
  completed_at timestamptz,                         -- counted (opened_at + delay)
  primary key (player_id, quest)
);

-- Every MARS ever earned. award_key makes each reward happen at most once.
create table if not exists public.ledger (
  id         bigserial primary key,
  player_id  uuid not null references public.players(id) on delete cascade,
  amount     integer not null check (amount > 0),
  reason     text not null,
  award_key  text not null,                         -- e.g. quest:follow, ach:storm, sol:<colony>:7
  created_at timestamptz not null default now(),
  unique (player_id, award_key)
);
create index if not exists ledger_player_time on public.ledger (player_id, created_at desc);

-- Row Level Security on, no policies: the anon / authenticated keys see nothing.
alter table public.players enable row level security;
alter table public.quests  enable row level security;
alter table public.ledger  enable row level security;

-- ---------------------------------------------------------------- functions
-- Award MARS once per (player, key). Returns {awarded, amount, reason, tokens}.
create or replace function public.mm_award(p_player uuid, p_amount int, p_reason text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tokens bigint; v_new boolean;
begin
  insert into ledger (player_id, amount, reason, award_key) values (p_player, p_amount, p_reason, p_key)
  on conflict (player_id, award_key) do nothing;
  v_new := found;
  if v_new then
    update players set tokens = tokens + p_amount where id = p_player returning tokens into v_tokens;
  else
    select tokens into v_tokens from players where id = p_player;
  end if;
  return jsonb_build_object('awarded', v_new, 'amount', case when v_new then p_amount else 0 end, 'reason', p_reason, 'tokens', v_tokens);
end $$;

-- Repeatable in-game reward with a rolling 24h cap per event type.
create or replace function public.mm_earn(p_player uuid, p_event text, p_key text, p_amount int, p_reason text, p_cap int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  select count(*) into v_count from ledger
   where player_id = p_player and award_key like p_event || ':%' and created_at > now() - interval '1 day';
  if v_count >= p_cap then
    return jsonb_build_object('awarded', false, 'amount', 0, 'capped', true, 'tokens', (select tokens from players where id = p_player));
  end if;
  return mm_award(p_player, p_amount, p_reason, p_event || ':' || p_key);
end $$;

-- Create the player on first X login, refresh handle/avatar on later logins.
create or replace function public.mm_upsert_player(p_x_id text, p_handle text, p_name text, p_avatar text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v players%rowtype; v_code text; v_ref text;
begin
  select * into v from players where x_id = p_x_id;
  if found then
    update players set handle = p_handle, name = p_name, avatar_url = p_avatar, last_seen = now()
     where id = v.id returning * into v;
    return jsonb_build_object('id', v.id, 'handle', v.handle, 'created', false);
  end if;
  v_code := upper(left(regexp_replace(p_handle, '[^A-Za-z0-9]', '', 'g'), 8));
  if v_code = '' then v_code := 'CMDR'; end if;
  v_code := v_code || '-' || upper(substr(md5(p_x_id || clock_timestamp()::text), 1, 4));
  select ref_code into v_ref from players where ref_code = upper(coalesce(p_ref, ''));
  insert into players (x_id, handle, name, avatar_url, ref_code, referred_by)
  values (p_x_id, p_handle, p_name, p_avatar, v_code, v_ref)
  returning * into v;
  return jsonb_build_object('id', v.id, 'handle', v.handle, 'created', true);
end $$;

-- The player opened a quest link (first time only).
create or replace function public.mm_quest_open(p_player uuid, p_quest text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q quests%rowtype;
begin
  insert into quests (player_id, quest, opened_at) values (p_player, p_quest, now())
  on conflict (player_id, quest) do update set opened_at = coalesce(quests.opened_at, excluded.opened_at)
  returning * into q;
  return jsonb_build_object('quest', q.quest, 'opened_at', q.opened_at, 'completed_at', q.completed_at, 'now', now());
end $$;

-- Count a quest once p_delay seconds have passed since it was opened. Pays the referrer
-- (p_ref_reward, 0 = off) when the invitee finishes all four quests.
create or replace function public.mm_quest_claim(p_player uuid, p_quest text, p_delay int, p_reward int, p_label text, p_ref_reward int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q quests%rowtype; v_award jsonb; v_done int; v_referrer uuid;
begin
  select * into q from quests where player_id = p_player and quest = p_quest for update;
  if not found or q.opened_at is null then
    return jsonb_build_object('ok', false, 'error', 'not_opened');
  end if;
  if q.completed_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'completed_at', q.completed_at, 'tokens', (select tokens from players where id = p_player));
  end if;
  if now() - q.opened_at < make_interval(secs => p_delay) then
    return jsonb_build_object('ok', false, 'error', 'too_early', 'wait', extract(epoch from (q.opened_at + make_interval(secs => p_delay) - now())));
  end if;
  update quests set completed_at = now() where player_id = p_player and quest = p_quest;
  v_award := mm_award(p_player, p_reward, 'Quest: ' || p_label, 'quest:' || p_quest);
  select count(*) into v_done from quests where player_id = p_player and completed_at is not null;
  if v_done >= 4 and p_ref_reward > 0 then
    select r.id into v_referrer from players p join players r on r.ref_code = p.referred_by where p.id = p_player;
    if v_referrer is not null then
      perform mm_award(v_referrer, p_ref_reward, 'Referral', 'ref:' || p_player::text);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'completed_at', now()) || v_award;
end $$;

-- Keep the best sol / score / stage / colonists the player has reached.
create or replace function public.mm_best(p_player uuid, p_best jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare stages text[] := array['outpost', 'base', 'colony', 'settlement', 'city']; b jsonb;
begin
  select best into b from players where id = p_player;
  update players set last_seen = now(), best = jsonb_build_object(
    'bestSol',   greatest(coalesce((b ->> 'bestSol')::int, 0),   least(coalesce((p_best ->> 'bestSol')::int, 0), 100000)),
    'bestScore', greatest(coalesce((b ->> 'bestScore')::int, 0), least(coalesce((p_best ->> 'bestScore')::int, 0), 100)),
    'colonists', greatest(coalesce((b ->> 'colonists')::int, 0), least(coalesce((p_best ->> 'colonists')::int, 0), 1000)),
    'bestStage', case when coalesce(array_position(stages, p_best ->> 'bestStage'), 0) > coalesce(array_position(stages, b ->> 'bestStage'), 1)
                      then p_best ->> 'bestStage' else coalesce(b ->> 'bestStage', 'outpost') end)
  where id = p_player returning best into b;
  return b;
end $$;

-- Everything the game needs about one player, in one call.
create or replace function public.mm_summary(p_player uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'player', jsonb_build_object('id', p.id, 'handle', p.handle, 'name', p.name, 'avatar', p.avatar_url, 'tokens', p.tokens,
                                'ref', p.ref_code, 'referred_by', p.referred_by, 'created_at', p.created_at, 'best', p.best),
    'quests', coalesce((select jsonb_object_agg(quest, jsonb_build_object('opened_at', opened_at, 'completed_at', completed_at))
                          from quests where player_id = p.id), '{}'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'reason', reason, 'at', created_at) order by created_at desc)
                          from (select * from ledger where player_id = p.id order by created_at desc limit 12) l), '[]'::jsonb),
    'achievements', coalesce((select jsonb_object_agg(substr(award_key, 5), created_at)
                                from ledger where player_id = p.id and award_key like 'ach:%'), '{}'::jsonb),
    'counts', (select jsonb_build_object(
                 'sols',     count(*) filter (where award_key like 'sol:%'),
                 'modules',  count(*) filter (where award_key like 'module:%'),
                 'robots',   count(*) filter (where award_key like 'robot:%'),
                 'research', count(*) filter (where award_key like 'research:%'),
                 'storms',   count(*) filter (where award_key like 'storm:%'),
                 'earned',   coalesce(sum(amount), 0))
               from ledger where player_id = p.id),
    'invites', (select count(*) from players i where i.referred_by = p.ref_code),
    'now', now())
  from players p where p.id = p_player;
$$;

-- Only the server may call these (Supabase exposes public functions over the API by default).
revoke execute on function public.mm_award(uuid, int, text, text)                     from public, anon, authenticated;
revoke execute on function public.mm_earn(uuid, text, text, int, text, int)           from public, anon, authenticated;
revoke execute on function public.mm_upsert_player(text, text, text, text, text)      from public, anon, authenticated;
revoke execute on function public.mm_quest_open(uuid, text)                           from public, anon, authenticated;
revoke execute on function public.mm_quest_claim(uuid, text, int, int, text, int)     from public, anon, authenticated;
revoke execute on function public.mm_best(uuid, jsonb)                                from public, anon, authenticated;
revoke execute on function public.mm_summary(uuid)                                    from public, anon, authenticated;
grant execute on function public.mm_award(uuid, int, text, text)                      to service_role;
grant execute on function public.mm_earn(uuid, text, text, int, text, int)            to service_role;
grant execute on function public.mm_upsert_player(text, text, text, text, text)       to service_role;
grant execute on function public.mm_quest_open(uuid, text)                            to service_role;
grant execute on function public.mm_quest_claim(uuid, text, int, int, text, int)      to service_role;
grant execute on function public.mm_best(uuid, jsonb)                                 to service_role;
grant execute on function public.mm_summary(uuid)                                     to service_role;
