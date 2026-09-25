-- Supabase PostgreSQL. Execute once as database owner. No browser database access.
begin;
create table public.meet_profiles(id uuid primary key references auth.users(id), name text not null, email text not null unique, roles text[] not null default '{}', societies text[] not null default '{}', active boolean not null default true, can_create boolean not null default false, must_change_password boolean not null default true, session_version integer not null default 1, created_at timestamptz not null default now(), check(roles <@ array['advisor','responsable','admin']),check(societies <@ array['PWM','ADM']));
create table public.meet_sessions(token_hash text primary key, user_id uuid not null references public.meet_profiles,session_version integer not null,expires_at timestamptz not null);
create table public.meet_login_attempts(key text primary key, window_at timestamptz not null default now(), attempts integer not null default 0);
create table public.meet_clients(id uuid primary key default gen_random_uuid(),name text not null,created_by uuid references public.meet_profiles,created_at timestamptz not null default now());
create table public.meet_dossiers(id uuid primary key default gen_random_uuid(), client_id uuid not null references public.meet_clients, name text not null,society text not null check(society in ('PWM','ADM')),data jsonb not null,revision integer not null default 1,created_by uuid references public.meet_profiles,updated_at timestamptz not null default now());
create table public.meet_grants(dossier_id uuid references public.meet_dossiers,user_id uuid references public.meet_profiles,permissions text[] not null,primary key(dossier_id,user_id),check(permissions <@ array['read','write','call','assign','review','approve','transfer']));
create table public.meet_calls(id uuid primary key,dossier_id uuid not null references public.meet_dossiers,advisor_id uuid references public.meet_profiles,historical_author text,config jsonb not null,started_at timestamptz not null default now(),ended_at timestamptz,duration_ms bigint not null default 0,status text not null default 'recording',summary text,source_revision integer, audio_status text not null default 'not_received',transcript_status text not null default 'partial',unique(id,dossier_id));
create table public.meet_segments(id uuid primary key,call_id uuid not null references public.meet_calls,dossier_id uuid not null references public.meet_dossiers,position_ms bigint not null,text text not null,role text not null check(role in('client','advisor','uncertain')),speaker text,created_at timestamptz not null default now(),foreign key(call_id,dossier_id) references public.meet_calls(id,dossier_id));
create table public.meet_documents(id uuid primary key default gen_random_uuid(),dossier_id uuid not null references public.meet_dossiers,model text not null,title text not null,language text not null default 'FR',family text not null default 'qualification',origin text not null default 'generated',confidentiality text not null default 'internal',source_revision integer not null,version integer not null,content text not null,completion jsonb not null,review text not null default 'À relire',technical text not null default 'Réussi',created_by uuid references public.meet_profiles,created_at timestamptz not null default now(),unique(dossier_id,model,source_revision));
create table public.meet_files(id uuid primary key,dossier_id uuid not null references public.meet_dossiers,call_id uuid references public.meet_calls,filename text not null,mime text not null,kind text not null check(kind in('evidence','audio')),family text not null default 'À classer',field_id text,parts integer not null,bytes bigint not null,receipt text not null default 'uploading',exploitability text not null default 'à examiner',freshness text not null default 'à vérifier',verification text not null default 'non vérifié',created_by uuid references public.meet_profiles,created_at timestamptz not null default now(),check(parts>0 and parts<=10000),check(bytes>0));
create table public.meet_file_parts(file_id uuid references public.meet_files,part integer not null,object_key text not null unique,sha256 text not null,bytes integer not null,primary key(file_id,part));
create table public.meet_tasks(id uuid primary key default gen_random_uuid(),dossier_id uuid not null references public.meet_dossiers,title text not null,owner_id uuid references public.meet_profiles,due date,priority text not null default 'normal',status text not null default 'À confirmer',source_id text,created_by uuid references public.meet_profiles,updated_at timestamptz not null default now());
create table public.meet_jobs(id uuid primary key default gen_random_uuid(),dossier_id uuid not null references public.meet_dossiers,call_id uuid references public.meet_calls,kind text not null,payload jsonb not null default '{}',dedupe text not null unique,status text not null default 'pending',attempts integer not null default 0,lease_until timestamptz,lease_token uuid,not_before timestamptz not null default now(),last_error text,created_at timestamptz not null default now());
create table public.meet_audit(id uuid primary key default gen_random_uuid(),dossier_id uuid references public.meet_dossiers,actor_id uuid references public.meet_profiles,event text not null,detail jsonb not null default '{}',created_at timestamptz not null default now());
create table public.meet_notifications(id uuid primary key default gen_random_uuid(),dossier_id uuid not null references public.meet_dossiers,event text not null,read_by uuid[] not null default '{}',created_at timestamptz not null default now());
create index on public.meet_grants(user_id);
create index on public.meet_segments(call_id,position_ms);
create index on public.meet_jobs(status,not_before);
create index on public.meet_documents(dossier_id,created_at desc);
create index on public.meet_calls(dossier_id,started_at desc);
-- RLS intentionally has no end-user policies: every data request passes the authenticated gateway.
do $$ declare t text; begin foreach t in array array['profiles','sessions','login_attempts','clients','dossiers','grants','calls','segments','documents','files','file_parts','tasks','jobs','audit','notifications'] loop execute format('alter table public.meet_%I enable row level security',t);execute format('revoke all on public.meet_%I from anon, authenticated',t);end loop;end $$;
insert into storage.buckets(id,name,public,file_size_limit) values('meet-private','meet-private',false,2097152) on conflict(id) do update set public=false,file_size_limit=2097152;

create function public.meet_login_gate(p_key text) returns boolean language plpgsql security definer set search_path=public as $$declare n integer;begin
 insert into meet_login_attempts(key,attempts) values(p_key,1) on conflict(key) do update set attempts=case when meet_login_attempts.window_at<now()-interval '15 minutes' then 1 else meet_login_attempts.attempts+1 end,window_at=case when meet_login_attempts.window_at<now()-interval '15 minutes' then now() else meet_login_attempts.window_at end returning attempts into n;return n<=10;end $$;

create function public.meet_create_dossier(p_actor uuid,p_client uuid,p_name text,p_society text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare d meet_dossiers;begin
 if not exists(select 1 from meet_profiles where id=p_actor and active and can_create and p_society=any(societies) and roles && array['advisor','responsable']) then raise insufficient_privilege;end if;
 if p_client is not null and not exists(select 1 from meet_dossiers existing join meet_grants g on g.dossier_id=existing.id where existing.client_id=p_client and g.user_id=p_actor and 'read'=any(g.permissions))then raise insufficient_privilege;end if;
 if p_client is null then insert into meet_clients(name,created_by) values(p_name,p_actor) returning id into p_client;end if;
 insert into meet_dossiers(client_id,name,society,data,created_by) values(p_client,p_name,p_society,p_data,p_actor) returning * into d;
 insert into meet_grants values(d.id,p_actor,array['read','write','call']);
 insert into meet_audit(dossier_id,actor_id,event)values(d.id,p_actor,'dossier.created');return to_jsonb(d);end $$;

create function public.meet_save_dossier(p_id uuid,p_expected integer,p_data jsonb,p_actor uuid,p_event text,p_documents jsonb,p_extra jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$declare d meet_dossiers;doc jsonb;prev meet_documents;action jsonb;begin
 select * into d from meet_dossiers where id=p_id for update;if d.revision<>p_expected then raise exception 'revision conflict' using errcode='40001';end if;
 if p_actor is not null and not exists(select 1 from meet_grants g join meet_profiles p on p.id=g.user_id where g.dossier_id=p_id and g.user_id=p_actor and 'write'=any(g.permissions) and p.active and d.society=any(p.societies))then raise insufficient_privilege;end if;
 update meet_dossiers set data=p_data,revision=revision+1,updated_at=now() where id=p_id returning * into d;
 for doc in select * from jsonb_array_elements(p_documents) loop
 select * into prev from meet_documents where dossier_id=p_id and model=doc->>'model' order by version desc limit 1;
 if prev.id is null or prev.content<>doc->>'content' or prev.completion<>(doc-'content') then
 insert into meet_documents(dossier_id,model,title,source_revision,version,content,completion,created_by)values(p_id,doc->>'model',doc->>'title',d.revision,coalesce(prev.version,0)+1,doc->>'content',doc-'content',p_actor);end if;end loop;
 for action in select * from jsonb_array_elements(coalesce(p_extra->'actions','[]'::jsonb))loop
 if not exists(select 1 from meet_tasks where dossier_id=p_id and source_id=action->>'sourceId' and title=action->>'title')then insert into meet_tasks(dossier_id,title,source_id,due,status)values(p_id,action->>'title',action->>'sourceId',(action->>'due')::date,'À confirmer');end if;end loop;
 insert into meet_audit(dossier_id,actor_id,event,detail) values(p_id,p_actor,p_event,p_extra-'actions');
 insert into meet_notifications(dossier_id,event)values(p_id,p_event);return to_jsonb(d);end $$;

create function public.meet_change_profile(p_actor uuid,p_target uuid,p_roles text[],p_societies text[],p_active boolean,p_create boolean) returns void language plpgsql security definer set search_path=public as $$begin
 perform pg_advisory_xact_lock(913701);
 if p_actor=p_target or not exists(select 1 from meet_profiles where id=p_actor and active and 'admin'=any(roles)) then raise insufficient_privilege;end if;
 if exists(select 1 from meet_profiles where id=p_target and active and 'admin'=any(roles)) and (not p_active or not 'admin'=any(p_roles)) and (select count(*) from meet_profiles where active and 'admin'=any(roles))<=1 then raise insufficient_privilege;end if;
 update meet_profiles set roles=p_roles,societies=p_societies,active=p_active,can_create=p_create,session_version=session_version+1 where id=p_target;
 insert into meet_audit(actor_id,event,detail)values(p_actor,'access.changed',jsonb_build_object('target',p_target,'roles',p_roles,'societies',p_societies,'active',p_active));end $$;

create function public.meet_claim_job() returns jsonb language plpgsql security definer set search_path=public as $$declare j meet_jobs;begin
 select * into j from meet_jobs where attempts<6 and not_before<=now() and (status='pending' or (status='running' and lease_until<now())) order by created_at for update skip locked limit 1;
 if j.id is null then return null;end if;
 update meet_jobs set status='running',attempts=attempts+1,lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid() where id=j.id returning * into j;return to_jsonb(j);end $$;
-- All security-definer functions are exclusively callable with the server service role.
revoke all on function public.meet_login_gate(text),public.meet_create_dossier(uuid,uuid,text,text,jsonb),public.meet_save_dossier(uuid,integer,jsonb,uuid,text,jsonb,jsonb),public.meet_change_profile(uuid,uuid,text[],text[],boolean,boolean),public.meet_claim_job() from public,anon,authenticated;
grant execute on function public.meet_login_gate(text),public.meet_create_dossier(uuid,uuid,text,text,jsonb),public.meet_save_dossier(uuid,integer,jsonb,uuid,text,jsonb,jsonb),public.meet_change_profile(uuid,uuid,text[],text[],boolean,boolean),public.meet_claim_job() to service_role;
commit;
