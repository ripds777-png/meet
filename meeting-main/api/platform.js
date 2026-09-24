import {Fault,json,uuid,hash,origin,service,rows,allRows,insert,rpc,session,hasRole,access,cookie,issue,createDossier,saveData,applyCommand,documents} from '../server/platform.js';
import {importDossier,exportMarkdown} from '../dossier.js';
export const config={runtime:'edge'};
const patch=(table,query,body)=>service('/rest/v1/'+table+'?'+query,{method:'PATCH',body,headers:{Prefer:'return=representation'}});
const audit=(p,event,detail,dossier_id=null)=>insert('meet_audit',{actor_id:p.id,event,detail,dossier_id});
async function enqueue(dossier_id,kind,dedupe,payload={},call_id=null){return service('/rest/v1/meet_jobs?on_conflict=dedupe',{method:'POST',body:{dossier_id,kind,dedupe,payload,call_id},headers:{Prefer:'resolution=ignore-duplicates'}});}
const checkText=(v,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Fault(400,'Texte absent ou trop long.');return v.trim();};
export default async function handler(req){try{
 const url=new URL(req.url),action=url.searchParams.get('action')||'me';
 if(!['GET','POST'].includes(req.method))throw new Fault(405,'Méthode refusée.');
 if(req.method==='POST')origin(req);
 if(req.headers.get('content-length')>3500000)throw new Fault(413,'Lot trop volumineux.');
 let body={};if(req.method==='POST'&&action!=='upload-part'){try{body=await req.json();}catch{throw new Fault(400,'JSON invalide.');}}
 const write=()=>{if(req.method!=='POST')throw new Fault(405,'POST requis.');};
 if(action==='login'){
  write();const email=checkText(body.email,254).toLowerCase(),password=checkText(body.password,256);
  const ip=req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-forwarded-for')||'unknown';
  if(!await rpc('meet_login_gate',{p_key:await hash('email:'+email)})||!await rpc('meet_login_gate',{p_key:await hash('ip:'+ip)}))throw new Fault(429,'Trop de tentatives. Réessayez dans 15 minutes.');
  let login;try{login=await service('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});}catch{throw new Fault(401,'Identifiants invalides.');}
  const p=(await rows('meet_profiles','id=eq.'+uuid(login.user.id)))[0];if(!p?.active)throw new Fault(401,'Compte indisponible.');
  return json(200,{profile:p},{'set-cookie':cookie(await issue(p))});
 }
 const p=await session(req,{allowPasswordChange:['me','password','logout'].includes(action)});
 if(action==='me')return json(200,{profile:p});
 if(action==='logout'){write();await service('/rest/v1/meet_sessions?token_hash=eq.'+await hash((req.headers.get('cookie')||'').match(/__Host-meet=([a-f0-9]{64})/)?.[1]||''),{method:'DELETE'});return json(200,{ok:true},{'set-cookie':cookie('',0)});}
 if(action==='password'){write();if(typeof body.password!=='string'||body.password.length<14||body.password.length>128)throw new Fault(400,'Choisissez un mot de passe de 14 à 128 caractères.');await service('/auth/v1/admin/users/'+p.id,{method:'PUT',body:{password:body.password}});const q=(await patch('meet_profiles','id=eq.'+p.id,{must_change_password:false,session_version:p.session_version+1}))[0];await audit(p,'password.changed',{});return json(200,{ok:true},{'set-cookie':cookie(await issue(q))});}
 if(action.startsWith('admin-')){
  hasRole(p,'admin');
  if(action==='admin-users')return json(200,{users:await rows('meet_profiles','order=created_at.desc'),audit:await rows('meet_audit','dossier_id=is.null&order=created_at.desc&limit=100')});
  write();
  if(action==='admin-create'){
   const email=checkText(body.email,254).toLowerCase(),name=checkText(body.name);const password='Tmp!'+await hash(crypto.randomUUID());
   const u=await service('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true}});
   try{await insert('meet_profiles',{id:u.id,email,name,roles:[],societies:[],must_change_password:true});}catch(e){await service('/auth/v1/admin/users/'+u.id,{method:'DELETE'});throw e;}
   await audit(p,'user.created',{target:u.id});return json(201,{id:u.id,temporaryPassword:password});
  }
  const target=uuid(body.userId);if(target===p.id)throw new Fault(403,'Vous ne pouvez pas modifier vos propres droits ni réinitialiser votre propre accès ici.');
  if(action==='admin-access'){if(!Array.isArray(body.roles)||!Array.isArray(body.societies)||body.roles.some(r=>!['admin','advisor','responsable'].includes(r))||body.societies.some(s=>!['PWM','ADM'].includes(s)))throw new Fault(400,'Rôles ou sociétés invalides.');await rpc('meet_change_profile',{p_actor:p.id,p_target:target,p_roles:body.roles,p_societies:body.societies,p_active:body.active===true,p_create:body.canCreate===true});return json(200,{ok:true});}
  if(action==='admin-reset'||action==='admin-revoke'){
   const q=(await rows('meet_profiles','id=eq.'+target))[0];if(!q)throw new Fault(404,'Compte absent.');const password='Tmp!'+await hash(crypto.randomUUID());
   // Revoke BEFORE resetting provider password; failures cannot leave the old session alive.
   await patch('meet_profiles','id=eq.'+target,{session_version:q.session_version+1,...(action==='admin-reset'?{must_change_password:true}:{})});
   if(action==='admin-reset')await service('/auth/v1/admin/users/'+target,{method:'PUT',body:{password}});
   await audit(p,action,{target});return json(200,{ok:true,...(action==='admin-reset'?{temporaryPassword:password}:{})});
  }
  if(action==='admin-grant'){
   const dossierId=uuid(body.dossierId),permissions=body.permissions;if(!Array.isArray(permissions)||permissions.some(v=>!['read','write','call','assign','review','approve','transfer'].includes(v)))throw new Fault(400,'Permissions invalides.');
   if(!(await rows('meet_dossiers','id=eq.'+dossierId)).length)throw new Fault(404,'Dossier absent.');
   await service('/rest/v1/meet_grants?on_conflict=dossier_id,user_id',{method:'POST',body:{dossier_id:dossierId,user_id:target,permissions},headers:{Prefer:'resolution=merge-duplicates'}});await audit(p,'grant.changed',{target,permissions},dossierId);return json(200,{ok:true});
  }
  throw new Fault(404,'Action inconnue.');
 }
 if(action==='list'){
  if(!p.roles.some(r=>['advisor','responsable'].includes(r)))throw new Fault(403,'Un rôle opérationnel est requis pour consulter les dossiers.');
  const grants=await rows('meet_grants','user_id=eq.'+p.id);const ids=grants.filter(g=>g.permissions.includes('read')).map(g=>g.dossier_id);if(!ids.length)return json(200,{dossiers:[],clients:[],notifications:[],calls:[],tasks:[],documents:[],grants:[],members:[]});
  const ds=(await rows('meet_dossiers','id=in.('+ids.join(',')+')&order=updated_at.desc')).filter(d=>p.societies.includes(d.society));
  const clients=ds.length?await rows('meet_clients','id=in.('+[...new Set(ds.map(d=>d.client_id))].join(',')+')'):[];
  const scope='dossier_id=in.('+ds.map(d=>d.id).join(',')+')';const calls=ds.length?await rows('meet_calls',scope+'&order=started_at.desc&limit=500'):[],tasks=ds.length?await rows('meet_tasks',scope+'&order=due.asc&limit=1000'):[],docs=ds.length?await rows('meet_documents',scope+'&order=created_at.desc&limit=2000'):[],allGrants=ds.length?await rows('meet_grants',scope):[];
  const memberIds=[...new Set(allGrants.map(g=>g.user_id))];const members=memberIds.length?(await rows('meet_profiles','id=in.('+memberIds.join(',')+')')).map(u=>({id:u.id,name:u.name,roles:u.roles})):[];
  return json(200,{dossiers:ds.map(d=>({...d,permissions:grants.find(g=>g.dossier_id===d.id).permissions})),clients,calls,tasks,grants:allGrants,members,documents:docs.map(({content,...m})=>m),notifications:ds.length?await rows('meet_notifications',scope+'&order=created_at.desc&limit=100'):[]});
 }
 if(action==='create'){
  write();if(!p.can_create||!p.roles.some(r=>['advisor','responsable'].includes(r)))throw new Fault(403,'Création non autorisée.');
  const name=checkText(body.name);if(!p.societies.includes(body.society))throw new Fault(403,'Société hors périmètre.');
  const data=createDossier(name);const d=await rpc('meet_create_dossier',{p_actor:p.id,p_client:body.clientId?uuid(body.clientId):null,p_name:name,p_society:body.society,p_data:data});data.id=d.id;return json(201,await saveData(p,d,data,'documents.initialized'));
 }
 const id=uuid(body.dossierId||url.searchParams.get('dossierId'));const d=await access(p,id,req.method==='GET'?'read':action==='start-call'||action==='segments'||action==='finish-call'?'call':'write');
 let linked=[];if(['detail','file-part'].includes(action)){const links=await rows('meet_file_links','dossier_id=eq.'+id);if(links.length)linked=await rows('meet_files','id=in.('+links.map(l=>l.file_id).join(',')+')');}
 if(action==='detail')return json(200,{dossier:d,calls:await rows('meet_calls','dossier_id=eq.'+id+'&order=started_at.desc'),documents:await rows('meet_documents','dossier_id=eq.'+id+'&order=created_at.desc'),files:[...await rows('meet_files','dossier_id=eq.'+id+'&order=created_at.desc'),...linked.map(f=>({...f,linked:true}))],tasks:await rows('meet_tasks','dossier_id=eq.'+id+'&order=due.asc'),jobs:await rows('meet_jobs','dossier_id=eq.'+id+'&order=created_at.desc&limit=100'),audit:await rows('meet_audit','dossier_id=eq.'+id+'&order=created_at.desc&limit=200'),grants:await rows('meet_grants','dossier_id=eq.'+id)});
 if(action==='call'){const callId=uuid(url.searchParams.get('callId'));const call=(await rows('meet_calls','id=eq.'+callId+'&dossier_id=eq.'+id))[0];if(!call)throw new Fault(404,'Appel absent.');return json(200,{call,segments:await allRows('meet_segments','call_id=eq.'+callId+'&order=position_ms.asc,id.asc')});}
 if(action==='export')return new Response(exportMarkdown(d.data),{headers:{'content-type':'text/markdown; charset=utf-8','cache-control':'private, no-store','content-disposition':'attachment; filename="dossier.md"'}});
 if(action==='events')return json(200,{events:await allRows('meet_audit','dossier_id=eq.'+id+'&order=created_at.asc,id.asc')});
 if(action==='document'){
  const document=(await rows('meet_documents','id=eq.'+uuid(url.searchParams.get('documentId'))+'&dossier_id=eq.'+id))[0];
  if(!document)throw new Fault(404,'Document absent.');return json(200,{document});
 }
 if(action==='file-part'){
  const file=(await rows('meet_files','id=eq.'+uuid(url.searchParams.get('fileId'))+'&dossier_id=eq.'+id))[0]||linked.find(f=>f.id===url.searchParams.get('fileId'));if(!file||file.receipt!=='received')throw new Fault(404,'Pièce non disponible.');
  const part=(await rows('meet_file_parts','file_id=eq.'+file.id+'&part=eq.'+Number(url.searchParams.get('part'))))[0];if(!part)throw new Fault(404,'Fragment absent.');const r=await service('/storage/v1/object/authenticated/meet-private/'+part.object_key,{binary:true});return new Response(r.body,{headers:{'content-type':'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
 }
 write();
 if(action==='command'){if(body.revision!==d.revision)throw new Fault(409,'Le dossier a changé. Rechargez.');return json(200,await saveData(p,d,applyCommand(d,body),'dossier.'+body.command,{fieldId:body.fieldId||null}));}
 if(action==='import'){
  const data=importDossier(JSON.stringify(body.data));data.id=d.id;data.name=d.name;
  if(d.data.facts.length||d.data.sources.length)throw new Fault(409,'Import uniquement dans un dossier vide choisi explicitement.');
  // Preserve attribution as historical, never rewrite it to the importing advisor.
  const original=body.data;data.evidence=data.evidence.map(e=>({...e,status:'legacy_metadata_only'}));const result=await saveData(p,d,data,'legacy.imported',{originalId:original.id,attribution:'à confirmer'});
  if(original.call){const c=original.call,callId=crypto.randomUUID();await insert('meet_calls',{id:callId,dossier_id:id,advisor_id:null,historical_author:String(c.cfg?.advisor||'À confirmer'),config:{legacy:true},status:'legacy_import',summary:c.reportText||'',duration_ms:c.elapsedMs||0,audio_status:'not_available',transcript_status:'imported'});for(const s of (c.segments||[]).slice(0,10000))await insert('meet_segments',{id:crypto.randomUUID(),call_id:callId,dossier_id:id,position_ms:Number(s.t)||0,text:String(s.text||''),role:'uncertain',speaker:String(s.sp??'unknown')});}
  return json(200,result);
 }
 if(action==='start-call'){
  hasRole(p,'advisor');const cfg=body.config;if(!cfg||cfg.consent!==true||![20,30,45,60,90,120].includes(cfg.duree)||cfg.societe!==d.society)throw new Fault(400,'Consentement, société et durée requis.');
  const callId=uuid(body.callId);const old=(await rows('meet_calls','id=eq.'+callId))[0];if(old){if(old.dossier_id!==id||old.advisor_id!==p.id)throw new Fault(403,'Appel non autorisé.');return json(200,old);}
  return json(201,(await insert('meet_calls',{id:callId,dossier_id:id,advisor_id:p.id,config:{...cfg,advisor:p.name},status:'recording'}))[0]);
 }
 if(['segments','finish-call'].includes(action)){
  hasRole(p,'advisor');const callId=uuid(body.callId),call=(await rows('meet_calls','id=eq.'+callId+'&dossier_id=eq.'+id))[0];if(!call||call.advisor_id!==p.id)throw new Fault(403,'Appel non autorisé.');
  if(action==='segments'){
   if(!Array.isArray(body.segments)||body.segments.length>50)throw new Fault(400,'Lot invalide.');const segments=body.segments.map(s=>({id:uuid(s.id),call_id:callId,dossier_id:id,text:checkText(s.text,8000),position_ms:Number.isFinite(s.t)?Math.max(0,s.t):0,role:['advisor','client'].includes(s.role)?s.role:'uncertain',speaker:String(s.sp??'unknown')}));
   await rpc('meet_append_segments',{p_actor:p.id,p_call:callId,p_segments:segments});return json(200,{saved:segments.map(s=>s.id)});
  }
  await rpc('meet_finish_call',{p_actor:p.id,p_call:callId,p_duration:Math.max(0,Math.min(Number(body.duration)||0,86400000)),p_incomplete:body.incomplete===true});return json(200,{status:'processing'});
 }
 if(action==='file-init'){
  const fileId=uuid(body.fileId),old=(await rows('meet_files','id=eq.'+fileId))[0];if(old){if(old.dossier_id!==id||old.created_by!==p.id)throw new Fault(403,'Fichier non autorisé.');return json(200,old);}
  const bytes=Number(body.bytes),parts=Number(body.parts);if(!Number.isInteger(parts)||parts<1||parts>10000||!Number.isInteger(bytes)||bytes<1||bytes>(body.kind==='audio'?250000000:50000000))throw new Fault(400,'Taille ou nombre de fragments invalide (pièces : 50 Mo ; audio : 250 Mo).');
  if(!['evidence','audio'].includes(body.kind))throw new Fault(400,'Type de fichier invalide.');
  if(body.callId){const call=(await rows('meet_calls','id=eq.'+uuid(body.callId)+'&dossier_id=eq.'+id))[0];if(!call||call.advisor_id!==p.id)throw new Fault(403,'Appel non autorisé.');}
  const f=(await insert('meet_files',{id:fileId,dossier_id:id,filename:checkText(body.filename),mime:checkText(body.mime||'application/octet-stream'),kind:body.kind,parts,bytes,call_id:body.callId||null,field_id:body.fieldId||null,created_by:p.id,audio_group:body.kind==='audio'?String(body.audioGroup||'initial').slice(0,80):null,audio_offset_ms:body.kind==='audio'?Math.max(0,Math.min(Number(body.audioOffset)||0,86400000)):0}))[0];return json(201,f);
 }
 if(action==='upload-part'){
  const fileId=uuid(url.searchParams.get('fileId')),part=Number(url.searchParams.get('part')),file=(await rows('meet_files','id=eq.'+fileId+'&dossier_id=eq.'+id))[0];if(!file||file.created_by!==p.id||file.receipt!=='uploading'||!Number.isInteger(part)||part<0||part>=file.parts)throw new Fault(403,'Fragment non autorisé.');
  const bytes=await req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>2097152)throw new Fault(413,'Fragment limité à 2 Mo.');const sha256=await hash(bytes),object_key=id+'/'+fileId+'/'+part+'-'+sha256;
  const old=(await rows('meet_file_parts','file_id=eq.'+fileId+'&part=eq.'+part))[0];if(old){if(old.sha256!==sha256)throw new Fault(409,'Fragment différent déjà sauvegardé.');return json(200,{ok:true});}
  // Immutable content address: the same retry can upload the same bytes, never replace another version.
  await service('/storage/v1/object/meet-private/'+object_key,{method:'POST',body:bytes,binary:true,headers:{'content-type':'application/octet-stream','x-upsert':'true'}});
  await insert('meet_file_parts',{file_id:fileId,part,sha256,bytes:bytes.byteLength,object_key});return json(200,{ok:true});
 }
 if(action==='file-complete'){
  const file=(await rows('meet_files','id=eq.'+uuid(body.fileId)+'&dossier_id=eq.'+id))[0];if(!file||file.created_by!==p.id)throw new Fault(403,'Fichier non autorisé.');
  const parts=await allRows('meet_file_parts','file_id=eq.'+file.id+'&order=part.asc');if(parts.length!==file.parts||parts.reduce((a,b)=>a+b.bytes,0)!==file.bytes)throw new Fault(409,'Des fragments sont encore absents.');
  await rpc('meet_complete_file',{p_actor:p.id,p_file:file.id});
  return json(200,{receipt:'received',verification:'non vérifié'});
 }
 if(action==='task'){
  const owner=body.ownerId?uuid(body.ownerId):null;if(owner&&owner!==p.id){hasRole(p,'responsable');await access(p,id,'assign');if(!(await rows('meet_grants','dossier_id=eq.'+id+'&user_id=eq.'+owner)).length)throw new Fault(403,'Responsable hors périmètre.');}
  if(body.taskId){const task=(await rows('meet_tasks','id=eq.'+uuid(body.taskId)+'&dossier_id=eq.'+id))[0];if(!task)throw new Fault(404,'Action absente.');if(task.owner_id!==p.id){hasRole(p,'responsable');await access(p,id,'assign');}if(!['À confirmer','Ouverte','En cours','Terminée'].includes(body.status))throw new Fault(400,'Statut invalide.');await patch('meet_tasks','id=eq.'+task.id,{status:body.status,updated_at:new Date().toISOString()});}
  else await insert('meet_tasks',{dossier_id:id,title:checkText(body.title,1000),owner_id:owner,due:body.due||null,priority:['normal','haute'].includes(body.priority)?body.priority:'normal',source_id:body.sourceId||null,created_by:p.id});await audit(p,'task.updated',{},id);return json(200,{ok:true});
 }
 if(action==='review'){
  const permission=body.status==='Validé par une personne habilitée'?'approve':'review';await access(p,id,permission);
  if(!['En revue','À relire','Validé par une personne habilitée'].includes(body.status))throw new Fault(400,'État de revue invalide.');
  const doc=(await rows('meet_documents','id=eq.'+uuid(body.documentId)+'&dossier_id=eq.'+id))[0];if(!doc)throw new Fault(404,'Document absent.');
  if(doc.content!==documents(d.data).find(x=>x.model===doc.model)?.content)throw new Fault(409,'Cette version repose sur un ancien état des faits.');
  await rpc('meet_review_document',{p_actor:p.id,p_dossier:id,p_revision:d.revision,p_document:doc.id,p_status:body.status,p_reason:checkText(body.reason,1000)});return json(200,{ok:true});
 }
 if(action==='transfer'){
  hasRole(p,'responsable');await access(p,id,'transfer');const target=await access(p,uuid(body.targetId),'write');if(d.society!=='PWM'||target.society!=='ADM')throw new Fault(400,'Transfert limité à PWM vers Admiralty, dossiers explicitement sélectionnés.');
  const data=structuredClone(target.data),factIds=Array.isArray(body.factIds)?body.factIds:[],fileIds=Array.isArray(body.fileIds)?body.fileIds.map(uuid):[],documentIds=Array.isArray(body.documentIds)?body.documentIds:[];
  if(!factIds.length&&!fileIds.length&&!documentIds.length)throw new Fault(400,'Sélectionnez un pack explicite.');
  for(const factId of factIds){const f=d.data.facts.find(f=>f.id===factId);if(!f)throw new Fault(400,'Fait absent du dossier source.');if(!data.facts.some(x=>x.id===f.id))data.facts.push({...f,originDossierId:d.id});const src=d.data.sources.find(s=>s.id===f.sourceId);if(src&&!data.sources.some(x=>x.id===src.id))data.sources.push({...src,originDossierId:d.id});}
  for(const docId of documentIds){const doc=(await rows('meet_documents','id=eq.'+uuid(docId)+'&dossier_id=eq.'+d.id))[0];if(!doc)throw new Fault(403,'Document hors pack.');if(!data.snapshots.some(s=>s.sourceDocumentId===doc.id))data.snapshots.push({id:crypto.randomUUID(),sourceDocumentId:doc.id,sourceDossierId:d.id,sourceVersion:doc.version,origin:'transfer',status:'draft',text:doc.content});}
  const result=await rpc('meet_transfer',{p_actor:p.id,p_source:d.id,p_source_revision:d.revision,p_target:target.id,p_target_revision:target.revision,p_data:data,p_documents:documents(data),p_files:fileIds,p_detail:{factIds,fileIds,documentIds,reason:checkText(body.reason,1000)}});return json(200,result);
 }
 if(action==='retry'){hasRole(p,'responsable');const job=(await rows('meet_jobs','id=eq.'+uuid(body.jobId)+'&dossier_id=eq.'+id))[0];if(!job||job.status==='running'||job.status==='done')throw new Fault(409,'Traitement non relançable.');await patch('meet_jobs','id=eq.'+job.id,{status:'pending',attempts:0,not_before:new Date().toISOString()});return json(200,{ok:true});}
 throw new Fault(404,'Action inconnue.');
 }catch(e){return json(e.status||500,{error:e.status?e.message:'Erreur récupérable. Aucune réussite n’a été confirmée.'});}}

