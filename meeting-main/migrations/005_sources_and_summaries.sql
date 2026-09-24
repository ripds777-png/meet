begin;
create table public.meet_document_sources(id uuid primary key,dossier_id uuid not null references public.meet_dossiers,file_id uuid not null references public.meet_files,page integer,part integer,text text not null);
create table public.meet_summary_parts(id uuid primary key default gen_random_uuid(),call_id uuid not null references public.meet_calls,dossier_id uuid not null references public.meet_dossiers,source_hash text not null,part integer not null,input text not null,summary text,unique(call_id,source_hash,part));
alter table public.meet_document_sources enable row level security;
alter table public.meet_summary_parts enable row level security;
revoke all on public.meet_document_sources,public.meet_summary_parts from anon,authenticated;
grant all on public.meet_document_sources,public.meet_summary_parts to service_role;
create function public.meet_queue_document_sources(p_file uuid,p_sources jsonb,p_state text)returns void language plpgsql security definer set search_path=public as $$declare f meet_files;s jsonb;begin
 select * into f from meet_files where id=p_file for update;
 for s in select * from jsonb_array_elements(p_sources)loop
 insert into meet_document_sources(id,dossier_id,file_id,page,part,text)values((s->>'id')::uuid,f.dossier_id,f.id,(s->>'page')::integer,(s->>'part')::integer,s->>'text')on conflict(id)do nothing;
 insert into meet_jobs(dossier_id,kind,payload,dedupe)values(f.dossier_id,'document-extract',jsonb_build_object('sourceId',s->>'id'),'document-source:'||(s->>'id'))on conflict(dedupe)do nothing;
 end loop;update meet_files set exploitability=p_state where id=f.id;end $$;
create function public.meet_queue_summary_parts(p_call uuid,p_hash text,p_parts jsonb)returns void language plpgsql security definer set search_path=public as $$declare c meet_calls;s jsonb;row_id uuid;begin
 select * into c from meet_calls where id=p_call;
 for s in select * from jsonb_array_elements(p_parts)loop
 insert into meet_summary_parts(call_id,dossier_id,source_hash,part,input)values(c.id,c.dossier_id,p_hash,(s->>'part')::integer,s->>'text')on conflict(call_id,source_hash,part)do update set input=excluded.input returning id into row_id;
 insert into meet_jobs(dossier_id,call_id,kind,payload,dedupe)values(c.dossier_id,c.id,'summary-part',jsonb_build_object('partId',row_id),'summary-part:'||row_id)on conflict(dedupe)do nothing;
 end loop;end $$;
revoke all on function public.meet_queue_document_sources(uuid,jsonb,text),public.meet_queue_summary_parts(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.meet_queue_document_sources(uuid,jsonb,text),public.meet_queue_summary_parts(uuid,text,jsonb) to service_role;
commit;
