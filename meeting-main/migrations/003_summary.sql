begin;
create function public.meet_commit_summary(p_job uuid,p_lease uuid,p_dossier uuid,p_revision integer,p_call uuid,p_text text)returns void language plpgsql security definer set search_path=public as $$declare d meet_dossiers;begin
 select * into d from meet_dossiers where id=p_dossier for update;
 if d.revision<>p_revision or not exists(select 1 from meet_jobs where id=p_job and lease_token=p_lease and lease_until>now())then raise exception 'stale result' using errcode='40001';end if;
 update meet_calls set summary=p_text,source_revision=p_revision,status='À revoir' where id=p_call and dossier_id=p_dossier;
 insert into meet_audit(dossier_id,event,detail)values(p_dossier,'call.summary.ready',jsonb_build_object('callId',p_call,'revision',p_revision));
 insert into meet_notifications(dossier_id,event)values(p_dossier,'call.summary.ready');end $$;
revoke all on function public.meet_commit_summary(uuid,uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.meet_commit_summary(uuid,uuid,uuid,integer,uuid,text) to service_role;
commit;
