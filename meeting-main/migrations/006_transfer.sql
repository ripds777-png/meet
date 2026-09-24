begin;
create table public.meet_file_links(dossier_id uuid references public.meet_dossiers,file_id uuid references public.meet_files,source_dossier_id uuid references public.meet_dossiers,created_by uuid references public.meet_profiles,created_at timestamptz not null default now(),primary key(dossier_id,file_id));
alter table public.meet_file_links enable row level security;
revoke all on public.meet_file_links from anon,authenticated;
grant all on public.meet_file_links to service_role;
create function public.meet_transfer(p_actor uuid,p_source uuid,p_source_revision integer,p_target uuid,p_target_revision integer,p_data jsonb,p_documents jsonb,p_files uuid[],p_detail jsonb)returns jsonb language plpgsql security definer set search_path=public as $$declare source_doc meet_dossiers;target_doc meet_dossiers;file_id uuid;result jsonb;begin
 -- Global transfer lock prevents inverse dossier lock ordering under simultaneous handoffs.
 perform pg_advisory_xact_lock(913702);
 select * into source_doc from meet_dossiers where id=p_source for update;select * into target_doc from meet_dossiers where id=p_target for update;
 if source_doc.revision<>p_source_revision or target_doc.revision<>p_target_revision then raise exception 'revision conflict'using errcode='40001';end if;
 if source_doc.society<>'PWM' or target_doc.society<>'ADM' or not exists(select 1 from meet_grants g join meet_profiles p on p.id=g.user_id where g.dossier_id=p_source and g.user_id=p_actor and 'transfer'=any(g.permissions) and 'responsable'=any(p.roles) and p.active and source_doc.society=any(p.societies))then raise insufficient_privilege;end if;
 foreach file_id in array p_files loop
 if not exists(select 1 from meet_files f where f.id=file_id and f.dossier_id=p_source and f.receipt='received')then raise insufficient_privilege;end if;
 insert into meet_file_links(dossier_id,file_id,source_dossier_id,created_by)values(p_target,file_id,p_source,p_actor)on conflict(dossier_id,file_id)do nothing;
 end loop;
 result:=meet_save_dossier(p_target,p_target_revision,p_data,p_actor,'transfer.received',p_documents,p_detail||jsonb_build_object('source',p_source,'sourceRevision',p_source_revision));
 insert into meet_audit(dossier_id,actor_id,event,detail)values(p_source,p_actor,'transfer.sent',p_detail||jsonb_build_object('target',p_target,'revision',p_source_revision));return result;
end $$;
revoke all on function public.meet_transfer(uuid,uuid,integer,uuid,integer,jsonb,jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.meet_transfer(uuid,uuid,integer,uuid,integer,jsonb,jsonb,uuid[],jsonb)to service_role;
commit;
