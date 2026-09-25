import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDraft,editRequest,approveRequest,addConstraint} from '../workflow.js';
test('diffusion approval binds exact recipients, message and versions; editing invalidates it',()=>{
 let r=requestDraft({name:'Fictif',actions:{F22:{status:'unavailable',reason:'Pièce attendue'}}});assert.equal(r.delivery,'not_configured');assert.throws(()=>approveRequest(r,'manager'),/destinataires/);
 r=editRequest(r,{recipients:['test@example.invalid'],recipientVerified:true,message:'Demande de test',documents:[{id:'version-1',version:1}],files:[]},'advisor');
 r=approveRequest(r,'manager');assert.equal(r.approval.documents[0].id,'version-1');assert.equal(r.delivery,'not_configured');assert.equal(r.status,'approved');
 r=editRequest(r,{message:'Autre message'},'advisor');assert.equal(r.approval,null);assert.equal(r.status,'draft');
});
test('sent or uncertain delivery is immutable, never blindly retried',()=>{
 for(const status of ['sent','signed','delivery_unknown'])assert.throws(()=>editRequest({...requestDraft({name:'Test'}),status},{message:'replacement'},'user'),/figée/);
});
test('constraint cannot invent provenance or an automatic risk severity',()=>{
 const d={sources:[{id:'source',text:'Permis en attente.'}]};const x={sourceId:'missing',categories:['legal'],level:'unevaluated',cause:'Permis en attente',consequence:'Date à clarifier'};
 assert.throws(()=>addConstraint(d,x,'user'),/source/);const c=addConstraint(d,{...x,sourceId:'source'},'user');assert.equal(c.level,'unevaluated');assert.equal(c.status,'À confirmer');assert.equal(c.sourceId,'source');
});
