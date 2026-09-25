begin;
alter table public.meet_profiles add column last_login_at timestamptz, add column last_activity_at timestamptz;
alter table public.meet_grants drop constraint meet_grants_permissions_check;
alter table public.meet_grants add constraint meet_grants_permissions_check check(permissions <@ array['read','write','call','assign','review','approve','transfer','supervise']);
create function public.meet_touch_activity(p_actor uuid,p_login boolean default false) returns void language sql security definer set search_path=public as $$
 update meet_profiles set last_activity_at=now(),last_login_at=case when p_login then now() else last_login_at end where id=p_actor and active and (p_login or last_activity_at is null or last_activity_at<now()-interval '1 minute');
$$;
create function public.meet_set_grant(p_actor uuid,p_target uuid,p_dossier uuid,p_permissions text[]) returns void language plpgsql security definer set search_path=public as $$
declare target meet_profiles; dossier meet_dossiers;
begin
 if p_actor=p_target or not exists(select 1 from meet_profiles where id=p_actor and active and 'admin'=any(roles)) then raise insufficient_privilege;end if;
 select * into target from meet_profiles where id=p_target for update;
 select * into dossier from meet_dossiers where id=p_dossier for update;
 if target.id is null or dossier.id is null then raise insufficient_privilege;end if;
 if cardinality(p_permissions)>0 then
  if not target.active or not dossier.society=any(target.societies) or not 'read'=any(p_permissions) then raise insufficient_privilege;end if;
  if 'supervise'=any(p_permissions) then
   if not 'admin'=any(target.roles) or not p_permissions <@ array['read','supervise'] then raise insufficient_privilege;end if;
  elsif not target.roles && array['advisor','responsable'] then raise insufficient_privilege;end if;
  if 'call'=any(p_permissions) and not 'advisor'=any(target.roles) then raise insufficient_privilege;end if;
  if p_permissions && array['assign','approve','transfer'] and not 'responsable'=any(target.roles) then raise insufficient_privilege;end if;
 end if;
 insert into meet_grants(dossier_id,user_id,permissions) values(p_dossier,p_target,p_permissions) on conflict(dossier_id,user_id) do update set permissions=excluded.permissions;
 insert into meet_audit(dossier_id,actor_id,event,detail)values(p_dossier,p_actor,'grant.changed',jsonb_build_object('target',p_target,'permissions',p_permissions));
 insert into meet_notifications(dossier_id,event)values(p_dossier,'grant.changed');
end $$;
revoke all on function public.meet_touch_activity(uuid,boolean),public.meet_set_grant(uuid,uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.meet_touch_activity(uuid,boolean),public.meet_set_grant(uuid,uuid,uuid,text[]) to service_role;
commit;
