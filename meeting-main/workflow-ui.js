import {api,esc,form} from './platform-client.js';
import {constraintCatalogue,constraintLevels} from './workflow.js';
export function renderRequests(data,details){return '<section><h2>Demandes et diffusion</h2><p>Messagerie et relances : intégration à configurer. Aucun envoi automatique. Une autorisation concerne exclusivement le message, les destinataires et les versions présentés.</p><button data-action="request-create">Préparer une demande ciblée</button>'+(data.requests||[]).map(r=>'<article class="card"><h3>Demande v'+r.revision+'</h3><p>'+esc(r.status==='approved'?'Autorisé à envoyer — non envoyé':r.status==='stopped'?'Arrêté':'Brouillon — non envoyé')+'</p><p>Destinataires : '+esc(r.recipients.join(', ')||'À confirmer')+'</p><pre>'+esc(r.message)+'</pre><p>Versions : '+r.documents.map(v=>esc(v.model)+' v'+v.version+' ('+esc(v.id)+')').join(', ')+'</p><p>Pièces : '+r.files.map(id=>esc(details.files.find(f=>f.id===id)?.filename||id)).join(', ')+'</p><button data-request-edit="'+r.id+'">Composer / corriger</button><button data-request-approve="'+r.id+'">Autoriser ce pack exact</button><button data-request-stop="'+r.id+'">Arrêter / refus reçu</button></article>').join('')+'</section>';}
export async function handleWorkflow(t,current,details,refresh){
 const action=t.dataset.action,send=async body=>{await api('workflow',{dossierId:current.id,revision:current.revision,...body});await refresh();};
 if(action==='request-create'){await send({command:action});return true;}
 if(t.dataset.requestEdit){const r=current.data.requests.find(r=>r.id===t.dataset.requestEdit);const v=await form('Composer le pack — toute modification annule son autorisation',[
  {name:'recipients',label:'Emails vérifiés, séparés par virgules',value:r.recipients.join(', ')},
  {name:'recipientVerified',label:'Identité et adresse vérifiées humainement',value:r.recipientVerified?'oui':'non',options:[{value:'non',label:'À vérifier'},{value:'oui',label:'Vérifiées'}]},
  {name:'message',label:'Message exact',type:'textarea',value:r.message,required:true},
  {name:'documents',label:'Versions exactes (sélection multiple)',multiple:true,value:r.documents.map(d=>d.id),options:details.documents.map(d=>({value:d.id,label:d.model+' v'+d.version+' — '+d.review}))},
  {name:'files',label:'Pièces reçues (sélection multiple)',multiple:true,value:r.files,options:details.files.filter(f=>f.kind==='evidence'&&f.receipt==='received').map(f=>({value:f.id,label:f.filename}))}]);
  if(v)await send({...v,recipientVerified:v.recipientVerified==='oui',requestId:r.id,command:'request-edit'});return true;
 }
 if(t.dataset.requestApprove){await send({requestId:t.dataset.requestApprove,command:'request-approve'});return true;}
 if(t.dataset.requestStop){const v=await form('Arrêter les relances et annuler la diffusion',[{name:'reason',label:'Réponse, refus ou motif',required:true}]);if(v)await send({...v,requestId:t.dataset.requestStop,command:'request-stop'});return true;}
 if(action==='constraint'){
  const v=await form('Contrainte rattachée à une source',[
   {name:'sourceId',label:'Source du fait déclencheur',search:true,required:true,options:current.data.sources.map(x=>({value:x.id,label:(x.text||x.id).slice(0,160)}))},
   {name:'categories',label:'Catégories',multiple:true,required:true,options:constraintCatalogue.map(c=>({value:c.id,label:c.label}))},
   {name:'cause',label:'Fait déclencheur et cause',required:true},{name:'consequence',label:'Conséquence établie',required:true},
   {name:'context',label:'Secteur / contexte'},{name:'flexibility',label:'Marge de manœuvre / inconnues'},{name:'pieces',label:'Pièces concernées'},
   {name:'action',label:'Action et validation nécessaires'},{name:'due',label:'Échéance',type:'date'},
   {name:'ownerId',label:'Responsable',options:[{value:'',label:'À affecter'},...details.members.filter(m=>m.active).map(m=>({value:m.id,label:m.name+' — '+m.email}))]},
   {name:'level',label:'Priorité',value:'unevaluated',options:Object.entries(current.data.constraintRules||constraintLevels).map(([value,label])=>({value,label}))}]);
  if(v)await send({command:'constraint',constraint:v});return true;
 }
 if(action==='constraint-rules'){const v=await form('Règles applicables à ce dossier',Object.entries(current.data.constraintRules||constraintLevels).map(([name,value])=>({name,value,label:name,required:true})));if(v)await send({command:'constraint-rules',rules:v});return true;}
 return false;
}
