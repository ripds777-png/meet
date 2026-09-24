// Shared, deterministic dossier rules. No authority or verification is inferred by AI.
export const fields = [
 ['F01','Identité de l’entité','strategique','Quelle est la dénomination exacte et le numéro d’immatriculation du porteur ?','K09:1:1 K13:1:1 K11:L01:2'],
 ['F02','Implantation et activité','strategique','Dans quel pays l’entité est-elle établie et quelle activité exerce-t-elle ?','K09:1:1 K13:1:1'],
 ['F03','Rôle et pouvoir de représentation','juridique','Quel est votre rôle et qui peut engager l’entité ?','K13:1:1 K11:L03:2'],
 ['F04','Projet et avancement','strategique','Quel est le projet et son stade actuel ?','K09:2:2 K13:4:4'],
 ['F05','Localisation et périmètre','strategique','Quels actifs et sites sont concernés ?','K09:2:2 K17:1:1'],
 ['F06','Maîtrise foncière','juridique','Êtes-vous propriétaire ou bénéficiaire d’une promesse, et sous quelles conditions ?','K09:2:2 K11:L04-L05:2'],
 ['F07','Financement demandé','financier','Quel montant demandez-vous, dans quelle devise et pour quel emploi ?','K09:1-3:1 K13:4:4'],
 ['F08','Date du besoin et cause','financier','À quelle date précise les fonds sont-ils nécessaires et pourquoi ?','K09:1-2:1 K17:6:6'],
 ['F09','Jalons et dépendances','strategique','Quels jalons conditionnent le calendrier ?','K09:2:2 K17:6:6'],
 ['F10','Coûts détaillés','financier','Quel est le coût total, par poste et devise, déjà payé et restant à payer ?','K09:3:3 K11:F03:3 A06:3:4'],
 ['F11','Ressources et disponibilité','financier','Quels apports sont reçus, engagés ou simplement envisagés, par entité et devise ?','K09:3:3 K11:F04:3 A06:2:3'],
 ['F12','Dettes existantes','financier','Quelles dettes existent, avec leurs montants, devises et échéances ?','K09:3:3 K11:F05:3'],
 ['F13','Revenus historiques et prévisionnels','financier','Quels revenus sont réalisés ou prévus, pour quelle période et devise ?','K13:4:4 K11:F01-F02-F06:3'],
 ['F14','Équipe et expérience','strategique','Qui porte le projet et quelle expérience comparable a l’équipe ?','K09:2:2 K13:1:1'],
 ['F15','Actionnariat et contrôle','juridique','Comment sont répartis le capital, les votes et le contrôle ?','K13:2:2 K11:L02:2'],
 ['F16','Autorisations','juridique','Quelles autorisations sont obtenues, en cours ou contestées ?','K09:2:2 K11:T02:4'],
 ['F17','Contrats et contraintes','juridique','Quels contrats clés sont signés et quelles conditions restent ouvertes ?','K09:2:2 K11:L07:2'],
 ['F18','Assurances','juridique','Quelles assurances couvrent actuellement le projet ?','K11:T09:4 K17:T08:4'],
 ['F19','Origine économique des fonds','financier','Quelle est l’origine économique documentée des fonds ?','K13:4:4 K11:C02:5'],
 ['F20','Résidences fiscales','juridique','Quelles résidences fiscales sont déclarées dans le formulaire habilité ?','K16:2:2 K11:C04:5'],
 ['F21','Fonctions publiques','juridique','Une déclaration doit-elle être recueillie par la conformité habilitée ?','K13:3:3 K15:4:4'],
 ['F22','Pièces disponibles','strategique','Quelles pièces pouvez-vous fournir et lesquelles sont indisponibles, pour quelle raison ?','K11:6:6 K13:5:5'],
 ['F23','Responsables et échéances','strategique','Qui transmettra chaque pièce, et à quelle date ?','K11:6:6 K13:5:5'],
 ['F24','Origine de la relation','strategique','Qui vous a mis en relation et à quel titre ?','K09:1:1 K15:5:5']
].map(([id,label,category,question,refs])=>({id,label,category,question,type:['F10','F11','F12','F13'].includes(id)?'rows':'text',restricted:['F19','F20','F21'].includes(id),sources:refs.split(' ').map(r=>{const [model,section,page]=r.split(':');return {model,section,page:Number(page),language:'FR'};})}));
for(const [ids,model,section,page] of [['F01 F02 F04 F05 F08','A07','1.1',3],['F07 F10 F11','A07','2.1',3],['F22 F23','A07','5.1',5],['F01 F08 F09','A02','1',3],['F13','A02','2',3],['F04 F05','A10','1',3]])for(const id of ids.split(' '))fields.find(f=>f.id===id).sources.push({model,section,page,language:'FR'});
export const uid=()=>globalThis.crypto.randomUUID();
export function createDossier(name){return {schema:1,id:uid(),name,createdAt:new Date().toISOString(),stage:'qualification',targets:['K09','K11','A06','A07','A02','A10'],facts:[],sources:[],actions:{},evidence:[],constraints:[],events:[],snapshots:[],processed:[],metrics:{batches:0,input:0,output:0}};}
export function event(d,type,data){d.events.push({id:uid(),dossierId:d.id,type,at:new Date().toISOString(),data});}
export function validateExtraction(result,sources){
 if(!result || !Array.isArray(result.facts)) throw new Error('Extraction invalide');
 const facts=[];
 for(const f of result.facts.slice(0,60)){
  const field=fields.find(x=>x.id===f.fieldId && !x.restricted),source=sources.find(s=>s.id===f.sourceId);
  if(!field || !source || source.role==='advisor' || typeof f.quote!=='string' || f.quote.trim().length<4 || !source.text.includes(f.quote) || typeof f.raw!=='string' || !f.raw.trim() || !f.quote.includes(f.raw)) continue;
  facts.push({fieldId:field.id,sourceId:source.id,quote:f.quote.slice(0,1500),raw:f.raw.slice(0,1000),entity:typeof f.entity==='string'&&f.quote.includes(f.entity)?f.entity.slice(0,150):'',currency:/^[A-Z]{3}$/.test(f.currency||'')&&f.quote.includes(f.currency)?f.currency:'',period:typeof f.period==='string'&&f.quote.includes(f.period)?f.period.slice(0,100):'',role:source.role,rows:Array.isArray(f.rows)?f.rows.slice(0,30).filter(r=>r && typeof r==='object' && !Array.isArray(r)).map(r=>Object.fromEntries(Object.entries(r).filter(([k,v])=>['label','amount','currency','period','entity','status'].includes(k)&&typeof v==='string'&&f.quote.includes(v)))):[]});
 }
 const actions=(Array.isArray(result.actions)?result.actions:[]).slice(0,20).flatMap(a=>{const source=sources.find(s=>s.id===a.sourceId);if(!source||typeof a.title!=='string'||a.title.length<4||!source.text.includes(a.title))return [];return [{title:a.title.slice(0,1000),sourceId:source.id,due:typeof a.due==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(a.due)&&source.text.includes(a.due)&&Number.isFinite(Date.parse(a.due))&&new Date(a.due).toISOString().slice(0,10)===a.due?a.due:null}];});
 const constraints=(Array.isArray(result.constraints)?result.constraints:[]).slice(0,20).flatMap(c=>{const source=sources.find(s=>s.id===c.sourceId);if(!source||typeof c.cause!=='string'||c.cause.length<5||!source.text.includes(c.cause)||!['financier','calendrier','contractuel','juridique','stratégique'].includes(c.type))return [];return [{sourceId:source.id,cause:c.cause.slice(0,1000),type:c.type,consequence:typeof c.consequence==='string'&&source.text.includes(c.consequence)?c.consequence:'À préciser',status:'À confirmer'}];});
 return {facts,actions,constraints};
}
export function ingest(d,result,sources){
 const validated=validateExtraction(result,sources);
 for(const s of sources) if(!d.sources.some(x=>x.id===s.id)) d.sources.push({...s});
 for(const f of validated.facts){
  if(d.facts.some(x=>x.fieldId===f.fieldId&&x.sourceId===f.sourceId&&x.raw===f.raw))continue;
  const fact={...f,id:uid(),at:new Date().toISOString(),superseded:false};d.facts.push(fact);event(d,'fact.proposed',{factId:fact.id});
 }
 for(const c of validated.constraints)if(!d.constraints.some(x=>x.sourceId===c.sourceId&&x.cause===c.cause))d.constraints.push({...c,id:uid(),at:new Date().toISOString()});
 for(const s of sources)if(!d.processed.includes(s.id))d.processed.push(s.id);
 d.metrics.batches++;return d;
}
export function state(d,f){
 const action=d.actions[f.id];
 if(f.restricted)return {applicability:'future',info:'unknown',evidence:'expected',analysis:'unstarted'};
 const facts=d.facts.filter(x=>x.fieldId===f.id&&!x.superseded);
 const values=new Set(facts.map(x=>x.raw));
 let info=values.size>1?'conflict':facts.length?'declared':'unknown';
 if(facts.some(x=>x.role!=='client'||(['F07','F10','F11','F12','F13'].includes(f.id)&&(!x.currency||!x.entity))||(['F08','F09','F13'].includes(f.id)&&! /\b20\d{2}\b/.test(x.period+' '+x.raw))))info=values.size>1?'conflict':'clarify';
 return {applicability:action?.status==='not_applicable'?'not_applicable':'now',info,evidence:d.evidence.some(e=>e.fieldId===f.id)?'received':'expected',analysis:'unstarted'};
}
export function needs(d,category){return fields.filter(f=>!f.restricted&&(!category||f.category===category)&&!d.actions[f.id]&&f.sources.some(s=>d.targets.includes(s.model))&&state(d,f).info!=='declared').sort((a,b)=>Number(state(d,b).info==='conflict')-Number(state(d,a).info==='conflict')||b.sources.length-a.sources.length);}
export function defer(d,id,status,reason,owner='',due=''){if(!fields.some(f=>f.id===id)||!reason.trim())throw new Error('Motif obligatoire');d.actions[id]={status,reason,owner,due,at:new Date().toISOString()};event(d,'followup.created',{fieldId:id,...d.actions[id]});}
export function correct(d,id){const fact=d.facts.find(f=>f.id===id);if(!fact)throw new Error('Fait absent');for(const f of d.facts)if(f.fieldId===fact.fieldId&&f.id!==id)f.superseded=true;fact.superseded=false;event(d,'correction.confirmed',{factId:id});}
export function progress(d){const fs=fields.filter(f=>state(d,f).applicability==='now'&&f.sources.some(s=>d.targets.includes(s.model)));return {known:fs.filter(f=>state(d,f).info==='declared').length,total:fs.length,received:d.evidence.filter(e=>e.status==='received').length,verified:0,validations:0};}
export function draft(d,model){const fs=fields.filter(f=>f.sources.some(s=>s.model===model));return '# '+model+' — BROUILLON À REVOIR\n\nDossier : '+d.name+'\nVersion : '+new Date().toISOString()+'\nAucune validation, émission ou signature.\n\n'+fs.map(f=>'## '+f.label+'\n'+(d.facts.filter(x=>x.fieldId===f.id&&!x.superseded).map(x=>'- '+x.raw+' ['+state(d,f).info+']\n  Source '+x.sourceId+' : « '+x.quote+' »'+(x.rows.length?'\n  Lignes structurées : '+JSON.stringify(x.rows):'')).join('\n')||'Inconnu — à recueillir.')+'\nRéférentiel : '+f.sources.filter(s=>s.model===model).map(s=>s.language+' §'+s.section+' p.'+s.page).join(', ')).join('\n\n');}
export function exportMarkdown(d){return '---\ndossier_id: '+d.id+'\nstatut: brouillon\n---\n\n# '+d.name+'\n\n'+d.targets.map(m=>draft(d,m)).join('\n\n---\n\n')+'\n\n## Pièces et relances\n'+fields.filter(f=>!f.restricted&&!d.evidence.some(e=>e.fieldId===f.id)).map(f=>'- '+f.label+': '+(d.actions[f.id]?JSON.stringify(d.actions[f.id]):'justificatif à demander si applicable')).join('\n')+'\n\n## Sources\n'+d.sources.map(s=>'- '+s.id+' — '+s.role+' — '+(s.filename||'appel')+' — '+(s.t??'')+' ms : '+s.text).join('\n')+'\n\n## Contraintes\n'+JSON.stringify(d.constraints,null,2)+'\n\n## Historique et motifs\n'+JSON.stringify(d.events,null,2);}
export function importDossier(raw){
 const d=JSON.parse(raw);if(d.schema!==1||typeof d.name!=='string'||!Array.isArray(d.facts)||!Array.isArray(d.sources)||!Array.isArray(d.evidence)||!Array.isArray(d.events)||!Array.isArray(d.targets)||!Array.isArray(d.processed)||!Array.isArray(d.snapshots)||!d.actions||!d.metrics||!Array.isArray(d.constraints))throw new Error('Format dossier invalide');
 const clean=createDossier(d.name);for(const s of d.sources)if(!s||typeof s.id!=='string'||typeof s.text!=='string'||!['advisor','client','uncertain','document'].includes(s.role))throw new Error('Source invalide');
 ingest(clean,{facts:d.facts},d.sources);
 for(const f of clean.facts){const old=d.facts.find(x=>x.fieldId===f.fieldId&&x.sourceId===f.sourceId&&x.raw===f.raw);f.superseded=old?.superseded===true;}
 clean.targets=d.targets.filter(m=>fields.some(f=>f.sources.some(s=>s.model===m)));clean.stage=['qualification','documents','approfondir'].includes(d.stage)?d.stage:'qualification';
 for(const [id,a] of Object.entries(d.actions))if(fields.some(f=>f.id===id)&&a&&typeof a.reason==='string'&&['deferred','unknown','unavailable','not_applicable'].includes(a.status))clean.actions[id]={status:a.status,reason:a.reason,owner:String(a.owner||''),due:String(a.due||'')};
 clean.evidence=d.evidence.filter(e=>e&&typeof e.filename==='string'&&typeof e.hash==='string'&&fields.some(f=>f.id===e.fieldId)).map(e=>({...e,status:'received'}));
 clean.snapshots=d.snapshots.filter(s=>s&&typeof s.text==='string').map(s=>({...s,status:'draft'}));
 clean.constraints=d.constraints.filter(c=>c&&clean.sources.some(s=>s.id===c.sourceId));
 clean.events=d.events.filter(e=>e&&typeof e.id==='string'&&typeof e.type==='string');event(clean,'dossier.imported',{originalId:d.id,note:'Copie isolée ; aucune validation reprise'});return clean;
}
