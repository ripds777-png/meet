begin;
create function public.meet_append_segments(p_actor uuid,p_call uuid,p_segments jsonb) returns void language plpgsql security definer set search_path=public as $$declare c meet_calls;s jsonb;added uuid;begin
 select * into c from meet_calls where id=p_call for update;
 if c.advisor_id<>p_actor or not exists(select 1 from meet_grants g join meet_profiles p on p.id=g.user_id join meet_dossiers d on d.id=g.dossier_id where g.user_id=p_actor and g.dossier_id=c.dossier_id and 'call'=any(g.permissions) and 'advisor'=any(p.roles) and d.society=any(p.societies) and p.active)then raise insufficient_privilege;end if;
 for s in select * from jsonb_array_elements(p_segments)loop
 if exists(select 1 from meet_segments where id=(s->>'id')::uuid and (call_id<>p_call or text<>s->>'text'))then raise insufficient_privilege;end if;
 insert into meet_segments(id,call_id,dossier_id,position_ms,text,role,speaker)values((s->>'id')::uuid,p_call,c.dossier_id,(s->>'position_ms')::bigint,s->>'text',s->>'role',s->>'speaker')on conflict(id)do nothing returning id into added;
 if added is not null and c.ended_at is not null then
 insert into meet_jobs(dossier_id,call_id,kind,dedupe)values(c.dossier_id,p_call,'summary','late-summary:'||added)on conflict(dedupe)do nothing;
 update meet_calls set status='processing' where id=p_call;
 end if;
 insert into meet_jobs(dossier_id,call_id,kind,payload,dedupe)values(c.dossier_id,p_call,'extract',jsonb_build_object('segmentId',s->>'id'),'segment:'||(s->>'id'))on conflict(dedupe)do nothing;
 end loop;end $$;
create function public.meet_finish_call(p_actor uuid,p_call uuid,p_duration bigint,p_incomplete boolean)returns void language plpgsql security definer set search_path=public as $$declare c meet_calls;begin
 select * into c from meet_calls where id=p_call for update;if c.advisor_id<>p_actor then raise insufficient_privilege;end if;
 update meet_calls set ended_at=coalesce(ended_at,now()),duration_ms=p_duration,status='processing',transcript_status=case when p_incomplete then 'partial' else 'stable_segments_saved' end where id=p_call and ended_at is null;
 insert into meet_jobs(dossier_id,call_id,kind,dedupe)values(c.dossier_id,p_call,'summary','summary:'||p_call)on conflict(dedupe)do nothing;
 insert into meet_notifications(dossier_id,event)select c.dossier_id,'call.ended' where c.ended_at is null;end $$;
revoke all on function public.meet_append_segments(uuid,uuid,jsonb),public.meet_finish_call(uuid,uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.meet_append_segments(uuid,uuid,jsonb),public.meet_finish_call(uuid,uuid,bigint,boolean) to service_role;
grant all on public.meet_profiles,public.meet_sessions,public.meet_login_attempts,public.meet_clients,public.meet_dossiers,public.meet_grants,public.meet_calls,public.meet_segments,public.meet_documents,public.meet_files,public.meet_file_parts,public.meet_tasks,public.meet_jobs,public.meet_audit,public.meet_notifications to service_role;
commit;

