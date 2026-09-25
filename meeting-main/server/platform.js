import {requestDraft} from '../workflow.js';
import {fields,state,draft,createDossier,ingest,correct,defer} from '../dossier.js';
export class Fault extends Error {constructor(status,message){super(message);this.status=status;}}
export const json=(status,data,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',...headers}});
export const uuid=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Fault(400,'Identifiant invalide.');return value;};
export const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof text==='string'?new TextEncoder().encode(text):text))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function configured(){return !!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.APP_ORIGIN);}
export function origin(req){const expected=process.env.APP_ORIGIN;if(!expected)throw new Fault(503,'APP_ORIGIN non configuré.');if(req.headers.get('origin')!==expected)throw new Fault(403,'Origine de requête refusée.');}
export async function service(path,{method='GET',body,headers={},binary=false}={}){
 if(!configured())throw new Fault(503,'Plateforme non configurée : base, authentification et stockage privé requis.');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const r=await fetch(process.env.SUPABASE_URL+path,{method,headers:{apikey:key,authorization:'Bearer '+key,...(body&&!binary?{'content-type':'application/json'}:{}),...headers},body:body?(binary?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(25000)});
 if(!r.ok){let code;try{code=(await r.json()).code;}catch{}if(['NoSuchKey','not_found'].includes(code))throw new Fault(404,'Objet absent du stockage.');if(code==='40001')throw new Fault(409,'Le dossier a changé. Rechargez avant de réessayer.');if(code==='42501')throw new Fault(403,'Opération interdite.');throw new Fault(r.status===404?404:502,'Service de données indisponible. Réessayez ; les données déjà enregistrées sont conservées.');}
 if(binary)return r;const text=await r.text();return text?JSON.parse(text):null;
}
export const rows=(table,query='')=>service('/rest/v1/'+table+'?'+query);
export async function allRows(table,query=''){
 const params=new URLSearchParams(query);params.delete('limit');const result=[];
 for(let offset=0;offset<100000;offset+=500){params.set('limit','500');params.set('offset',String(offset));const page=await rows(table,params.toString());result.push(...page);if(page.length<500)return result;}
 throw new Fault(413,'Volume trop important : lecture complète non confirmée.');
}
export const insert=(table,data)=>service('/rest/v1/'+table,{method:'POST',body:data,headers:{Prefer:'return=representation'}});
export const rpc=(name,body)=>service('/rest/v1/rpc/'+name,{method:'POST',body});
export async function session(req,{allowPasswordChange=false}={}){
 if(!configured())throw new Fault(503,'Configuration requise : Supabase, migration et premier administrateur.');
 const token=(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-meet=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!token)throw new Fault(401,'Connexion requise.');
 const sessions=await rows('meet_sessions','token_hash=eq.'+await hash(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()));
 const s=sessions?.[0];if(!s)throw new Fault(401,'Session expirée.');
 const p=(await rows('meet_profiles','id=eq.'+s.user_id))[0];
 if(!p?.active||p.session_version!==s.session_version)throw new Fault(401,'Session révoquée.');
 if(p.must_change_password&&!allowPasswordChange)throw new Fault(428,'Changez votre mot de passe avant de continuer.');
 if(!p.last_activity_at||Date.now()-Date.parse(p.last_activity_at)>60000)await rpc('meet_touch_activity',{p_actor:p.id,p_login:false});
 return p;
}
export function hasRole(p,role){if(!p.roles.includes(role))throw new Fault(403,'Cet espace nécessite le rôle '+role+'.');}
export function allowed(p,d,g,permission){return !!(p?.active&&(p.roles.some(r=>['advisor','responsable'].includes(r))||(permission==='read'&&p.roles.includes('admin')&&g?.permissions.includes('supervise')))&&d&&p.societies.includes(d.society)&&g?.user_id===p.id&&g.dossier_id===d.id&&g.permissions.includes(permission));}
export async function access(p,id,permission='read'){
 uuid(id);const d=(await rows('meet_dossiers','id=eq.'+id))[0],g=(await rows('meet_grants','dossier_id=eq.'+id+'&user_id=eq.'+p.id))[0];
 if(!allowed(p,d,g,permission))throw new Fault(403,'Dossier ou opération non autorisé.');return d;
}
export const cookie=(token,age=28800)=>`__Host-meet=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export async function issue(p){const token=await hash(crypto.randomUUID()+crypto.randomUUID());await insert('meet_sessions',{token_hash:await hash(token),user_id:p.id,session_version:p.session_version,expires_at:new Date(Date.now()+28800000).toISOString()});return token;}
export function completion(data,model){const scoped=fields.filter(f=>f.sources.some(s=>s.model===model));const applicable=scoped.filter(f=>!['future','not_applicable'].includes(state(data,f).applicability));const filled=applicable.filter(f=>state(data,f).info==='declared');return {scope:'qualification factuelle — rubriques cartographiées',total:applicable.length,filled:filled.length,status:!applicable.length?'Non applicable':!filled.length&&!applicable.some(f=>data.facts.some(x=>x.fieldId===f.id))?'Non commencé':filled.length===applicable.length?'Complet':'Partiel',fields:scoped.map(f=>({id:f.id,label:f.label,...state(data,f)})),review:'À relire',technical:'Réussi'};}
export function documents(data){return data.targets.map(model=>({model,title:model,language:'FR',origin:'generated',content:draft(data,model).replace(/^Version :.*$/m,'Modèle : corpus FR cartographié — voir référence de version'),...completion(data,model)}));}
export async function saveData(p,d,data,eventName,extra={}){if(eventName==='facts.extracted'||eventName==='document.facts.extracted'){data.requests ||= [];if(!data.requests.length)data.requests.push({...requestDraft(data),autoPrepared:true});else for(const r of data.requests.filter(r=>r.autoPrepared&&r.status==='draft')){const next=requestDraft(data);if(r.message!==next.message){r.message=next.message;r.revision++;}}}const before=documents(d.data),after=documents(data);for(const r of data.requests||[]){if(r.status==='approved'&&r.documents.some(v=>before.find(x=>x.model===v.model)?.content!==after.find(x=>x.model===v.model)?.content)){r.status='draft';r.approval=null;r.history.push({event:'source.changed',at:new Date().toISOString(),actor:p?.id||null});}}return rpc('meet_save_dossier',{p_id:d.id,p_expected:d.revision,p_data:data,p_actor:p.id,p_event:eventName,p_documents:documents(data),p_extra:extra});}
export function applyCommand(d,body){const data=structuredClone(d.data);switch(body.command){
 case 'correct':correct(data,uuid(body.factId));break;
 case 'defer':if(!['deferred','unknown','unavailable','not_applicable'].includes(body.status))throw new Fault(400,'Statut invalide.');defer(data,body.fieldId,body.status,String(body.reason||''),String(body.owner||''),String(body.due||''));break;
 case 'reopen':delete data.actions[body.fieldId];break;
 case 'targets':if(!Array.isArray(body.targets)||body.targets.some(m=>!fields.some(f=>f.sources.some(s=>s.model===m))))throw new Fault(400,'Modèle inconnu.');data.targets=body.targets;break;
 case 'stage':if(!['qualification','documents','approfondir'].includes(body.stage))throw new Fault(400,'Objectif invalide.');data.stage=body.stage;break;
 default:throw new Fault(400,'Commande inconnue.');}return data;}
export {createDossier,ingest};
