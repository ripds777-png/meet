import {needs} from './dossier.js';
export const constraintCatalogue=[
 {id:'financial',label:'Financière'},{id:'time',label:'Temporelle'},{id:'contract',label:'Contractuelle'},
 {id:'legal',label:'Juridique / réglementaire'},{id:'strategy',label:'Stratégique'}
];
export const constraintLevels={unevaluated:'À évaluer — informations insuffisantes',yellow:'Jaune — clarification ou action à planifier',orange:'Orange — impact significatif à traiter',red:'Rouge — obstacle identifié nécessitant une décision'};
export function requestDraft(data){return {
 id:crypto.randomUUID(),revision:1,status:'draft',recipients:[],documents:[],files:[],recipientVerified:false,
 message:'Bonjour,\n\nPour poursuivre le dossier '+data.name+', pourriez-vous préciser ou transmettre :\n'+Object.entries(data.actions||{}).filter(([,a])=>!['not_applicable'].includes(a.status)).map(([id,a])=>'- '+id+' : '+a.reason).join('\n')+(Array.isArray(data.facts)?'\n'+needs(data).slice(0,6).map(f=>'- '+f.question).join('\n'):'')+'\n\nMerci.',
 delivery:'not_configured',reminders:{enabled:false,max:2,spacingDays:7,stopped:false},history:[]
};}
export function editRequest(previous,change,actor){
 if(['sent','signed','delivery_unknown'].includes(previous.status))throw new Error('Cette version de diffusion est figée. Préparez une nouvelle demande.');
 const next={...previous,...change,id:previous.id,revision:previous.revision+1,status:'draft',autoPrepared:false,approval:null,delivery:'not_configured'};
 next.history=[...previous.history,{at:new Date().toISOString(),actor,event:'edited',revision:next.revision}];return next;
}
export function approveRequest(request,actor){
 if(!request.recipientVerified||!request.recipients.length||!request.message.trim())throw new Error('Confirmez les destinataires et le message exact avant autorisation.');
 return {...request,status:'approved',approval:{actor,at:new Date().toISOString(),revision:request.revision,recipients:[...request.recipients],message:request.message,documents:structuredClone(request.documents),files:[...request.files]},history:[...request.history,{actor,at:new Date().toISOString(),event:'approved',revision:request.revision}]};
}
export function addConstraint(data,input,actor){
 const source=data.sources.find(s=>s.id===input.sourceId);if(!source)throw new Error('Choisissez une source existante du dossier.');
 if(!input.cause?.trim()||!input.consequence?.trim()||!Array.isArray(input.categories)||!input.categories.length||input.categories.some(c=>!constraintCatalogue.some(x=>x.id===c)))throw new Error('Catégorie, cause et conséquence requises.');
 if(!Object.hasOwn(constraintLevels,input.level))throw new Error('Niveau inconnu.');
 return {...input,id:crypto.randomUUID(),actor,at:new Date().toISOString(),type:input.categories.join(', '),status:'À confirmer',sourceId:source.id};
}
