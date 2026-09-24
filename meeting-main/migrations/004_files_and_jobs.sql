begin;
create function public.meet_complete_file(p_actor uuid,p_file uuid)returns void language plpgsql security definer set search_path=public as $$declare f meet_files;begin
 select * into f from meet_files where id=p_file for update;if f.created_by<>p_actor then raise insufficient_privilege;end if;
 if (select count(*) from meet_file_parts where file_id=p_file)<>f.parts or (select sum(bytes) from meet_file_parts where file_id=p_file)<>f.bytes then raise exception 'incomplete upload' using errcode='40001';end if;
 update meet_files set receipt='received' where id=p_file;
 if f.kind='evidence' then insert into meet_jobs(dossier_id,kind,payload,dedupe)values(f.dossier_id,'file',jsonb_build_object('fileId',f.id),'file:'||f.id)on conflict(dedupe)do nothing;end if;
 if f.call_id is not null then update meet_calls set audio_status='partial_available' where id=f.call_id;end if;
 if f.receipt<>'received' then insert into meet_audit(dossier_id,actor_id,event,detail)values(f.dossier_id,p_actor,'file.received',jsonb_build_object('fileId',f.id));end if;end $$;
-- Bound both the segment count and text size of each model request.
create or replace function public.meet_claim_job()returns jsonb language plpgsql security definer set search_path=public as $$declare j meet_jobs;k meet_jobs;ids uuid[];total_chars integer:=0;chars integer;token uuid:=gen_random_uuid();begin
 select * into j from meet_jobs where attempts<6 and not_before<=now() and (status='pending' or (status='running' and lease_until<now()))order by created_at,id for update skip locked limit 1;
 if j.id is null then return null;end if;
 ids:=array[j.id];
 if j.kind='extract' then
 ids:=array[]::uuid[];
 for k in select * from meet_jobs where dossier_id=j.dossier_id and kind='extract' and attempts<6 and not_before<=now() and (status='pending' or (status='running' and lease_until<now()))order by created_at,id for update skip locked limit 12 loop
 select coalesce(length(text),0) into chars from meet_segments where id=(k.payload->>'segmentId')::uuid;
 if total_chars+coalesce(chars,0)>24000 and cardinality(ids)>0 then exit;end if;
 ids:=array_append(ids,k.id);total_chars:=total_chars+coalesce(chars,0);
 end loop;end if;
 update meet_jobs set status='running',attempts=attempts+1,lease_until=now()+interval '3 minutes',lease_token=token where id=any(ids);
 select * into j from meet_jobs where id=j.id;
 return to_jsonb(j)||jsonb_build_object('batch',(select jsonb_agg(to_jsonb(x))from meet_jobs x where id=any(ids)));end $$;
revoke all on function public.meet_complete_file(uuid,uuid) from public,anon,authenticated;
grant execute on function public.meet_complete_file(uuid,uuid) to service_role;
commit;

