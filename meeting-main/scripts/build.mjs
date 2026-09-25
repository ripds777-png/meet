import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
await mkdir('public',{recursive:true});await mkdir('server',{recursive:true});
for(const name of ['platform.css','platform-client.js','portal.js','advisor-cloud.js','upload-queue.js','workflow.js','workflow-ui.js','dossier.js'])await copyFile(name,'public/'+name);
await mkdir('public/docs',{recursive:true});for(const name of ['catalogue-modeles.json','matrice-champs.json','COUVERTURE-DOCUMENTS.md'])await copyFile('docs/'+name,'public/docs/'+name);
const advisor=await readFile('index.html','utf8'),portal=await readFile('portal.html','utf8');
await writeFile('server/pages.js','export const advisor='+JSON.stringify(advisor)+';\nexport const portal='+JSON.stringify(portal)+';\n');
console.log('Built protected page templates and public code assets. No client data or secrets included.');
