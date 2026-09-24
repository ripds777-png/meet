import {PDFParse} from 'pdf-parse';
import mammoth from 'mammoth';
export async function extractFile(bytes,filename){
 if(bytes.length>10000000)return {pages:[],state:'lecture manuelle requise — fichier supérieur à 10 Mo'};
 if(/\.pdf$/i.test(filename)){const parser=new PDFParse({data:new Uint8Array(bytes),isEvalSupported:false,stopAtErrors:true});try{const result=await parser.getText();return {pages:result.pages.map(p=>({page:p.num,text:p.text})),state:result.text.trim()?'texte extrait — à examiner':'PDF sans texte exploitable — OCR ou lecture manuelle requis'};}finally{await parser.destroy();}}
 if(/\.docx$/i.test(filename)){
  // Bound the expanded archive before the parser allocates document contents.
  let expanded=0;for(let i=0;i+46<bytes.length;i++){if(bytes.readUInt32LE(i)===0x02014b50){expanded+=bytes.readUInt32LE(i+24);if(expanded>50000000)throw new Error('Archive DOCX trop volumineuse après décompression.');i+=45+bytes.readUInt16LE(i+28)+bytes.readUInt16LE(i+30)+bytes.readUInt16LE(i+32);}}
  const result=await mammoth.extractRawText({buffer:bytes});return {pages:[{page:null,text:result.value}],state:'texte extrait — paragraphes, pagination non disponible'};
 }
 if(/\.(txt|md|markdown)$/i.test(filename))return {pages:[{page:null,text:bytes.toString('utf8')}],state:'texte extrait — à examiner'};
 return {pages:[],state:'format conservé — lecture manuelle requise'};
}
