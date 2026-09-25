begin;
create function public.meet_review_document(p_actor uuid,p_dossier uuid,p_revision integer,p_document uuid,p_status text,p_reason text)returns void language plpgsql security definer set search_path=public as $$declare d meet_dossiers;required_permission text;begin
 select * into d from meet_dossiers where id=p_dossier for update;
 if d.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
 if p_status not in ('À relire','En revue','Validé par une personne habilitée') or length(trim(p_reason))=0 then raise exception 'invalid review';end if;
 required_permission:=case when p_status='Validé par une personne habilitée' then 'approve' else 'review' end;
 if not exists(select 1 from meet_grants g join meet_profiles p on p.id=g.user_id where g.dossier_id=p_dossier and g.user_id=p_actor and required_permission=any(g.permissions) and p.active and d.society=any(p.societies) and p.roles && array['advisor','responsable'])then raise insufficient_privilege;end if;
 update meet_documents set review=p_status where id=p_document and dossier_id=p_dossier;
 if not found then raise exception 'missing document';end if;
 insert into meet_audit(dossier_id,actor_id,event,detail)values(p_dossier,p_actor,'document.reviewed',jsonb_build_object('documentId',p_document,'status',p_status,'reason',p_reason));
end $$;
revoke all on function public.meet_review_document(uuid,uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.meet_review_document(uuid,uuid,integer,uuid,text,text) to service_role;
commit;
