import fs from 'node:fs';
import path from 'node:path';
import {cleanFields,verify,now,SYSTEM,random,json} from './core.mjs';
import {readPrivateJSON,networkEnabled,networkFetch} from './resources.mjs';

export class OCRFailure extends Error{}
export class OCR{
  constructor(manifest,config,{fetcher=networkFetch}={}){
    this.manifest=manifest;this.config={...(config===undefined?readPrivateJSON('ocr',{enabled:false}):config)};
    this.fetcher=fetcher===globalThis.fetch?networkFetch:fetcher;this.live=this.fetcher===networkFetch;
    this.mode=String(this.config.OCR_MODE||'demo').toLowerCase();if(!['demo','http'].includes(this.mode))throw Error('OCR_MODE must be demo or http.');
    if(this.mode==='http'&&!this.enabled)this.mode='demo';
  }
  get enabled(){return this.live?this.config.enabled===true&&networkEnabled():this.config.enabled!==false;}
  async extract(doc,filePath,stopSignal){
    if(this.mode==='http')return this.httpExtract(doc,filePath,stopSignal);
    await new Promise(resolve=>setTimeout(resolve,100));
    const sample=this.manifest[doc.sha256];
    if(sample?.scenario==='timeout')throw new OCRFailure('Demo OCR timeout. This sample intentionally fails. Upload another sample to complete the workflow.');
    if(!sample)return {fields:cleanFields({}),confidence:0,needs_confirmation:true,source:'DEMO - manual entry',raw:{demo:true,recognized_sample:false},note:'Live OCR is not configured. This file was saved privately. Enter and confirm the delivery fields to continue.'};
    const uncertain=sample.scenario==='uncertain',fields=cleanFields({purchase_order:sample.purchase_order,supplier:'Meridian Parts Ltd.',part_number:'P-1008',delivered_quantity:uncertain?null:sample.quantity});
    return {fields,confidence:uncertain?.52:.99,needs_confirmation:uncertain,source:'DEMO - predefined sample fixture',raw:{demo:true,sample:sample.filename,fields},note:'Extraction is reproduced from a predefined demo fixture. No live OCR provider was called.'};
  }
  async httpExtract(doc,filePath,stopSignal){
    const c=this.config;
    if(!this.enabled)throw new OCRFailure('HTTP OCR is disabled. Enable the private network and OCR configuration first.');
    if(!/^https?:\/\//.test(c.OCR_URL||'')||!c.OCR_FIELD_MAP)throw new OCRFailure('Live OCR configuration is incomplete. Configure the verified service URL and response field mapping.');
    try{const mapping=JSON.parse(c.OCR_FIELD_MAP);if(!mapping||['purchase_order','supplier','part_number','delivered_quantity'].some(k=>typeof mapping[k]!=='string'))throw Error('mapping');const seconds=Math.max(1,Math.min(120,Number(c.OCR_TIMEOUT_SECONDS||30)));if(!Number.isFinite(seconds))throw Error('timeout');const headers={'Content-Type':doc.mime,'Accept':'application/json','X-Document-ID':doc.id};if(c.OCR_AUTH_VALUE)headers[c.OCR_AUTH_HEADER||'Authorization']=c.OCR_AUTH_VALUE;const signals=[AbortSignal.timeout(seconds*1000)];if(stopSignal)signals.push(stopSignal);const response=await this.fetcher(c.OCR_URL,{method:'POST',headers,body:fs.readFileSync(filePath),signal:AbortSignal.any(signals),redirect:'error'});if(!response.ok)throw new OCRFailure(`The OCR service returned HTTP ${response.status}. Contact the service administrator.`);const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw new OCRFailure('OCR response exceeded the supported size.');chunks.push(chunk);}const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));const select=p=>String(p).split('.').reduce((v,k)=>{if(v===null||typeof v!=='object'||!Object.hasOwn(v,k))throw Error('field contract');return v[k];},raw);const fields=cleanFields(Object.fromEntries(['purchase_order','supplier','part_number','delivered_quantity'].map(k=>[k,select(mapping[k])])));const confidence=mapping.confidence?Number(select(mapping.confidence)):0;if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw Error('confidence');return {fields,raw,confidence,needs_confirmation:confidence<.85,source:'Configured HTTP OCR service',note:'Extracted using the configured server-side OCR connector.'};}
    catch(error){if(error instanceof OCRFailure)throw error;if(error.name==='TimeoutError')throw new OCRFailure('The OCR service timed out. You may retry the failed task.');if(error.message==='fetch failed'||error.name==='AbortError')throw new OCRFailure('The OCR service is unavailable. Existing documents remain available.');throw new OCRFailure('The OCR response does not match the configured field contract. No fields were inferred.');}
  }
}
export class Worker{
  constructor(store,ocr){this.store=store;this.ocr=ocr;this.stopped=true;this.processing=null;this.stopController=new AbortController();}
  start(){this.stopped=false;const s=this.store;s.transaction(()=>{const docs=s.all("SELECT d.* FROM documents d JOIN jobs j ON d.id=j.document_id WHERE j.status='running'");for(const d of docs){s.transition(d,'UPLOADED',SYSTEM,{reason:'Recover interrupted OCR task after restart'});s.event(d,'TASK_RECOVERED',SYSTEM);}s.run("UPDATE jobs SET status='pending' WHERE status='running'");});this.timer=setInterval(()=>this.trigger(),250);this.trigger();}
  trigger(){if(this.stopped||this.processing)return;this.processing=this.process().catch(()=>{}).finally(()=>{this.processing=null;});}
  async close(){this.stopped=true;clearInterval(this.timer);this.stopController.abort();await this.processing;}
  async process(){const s=this.store;while(!this.stopped){let job,doc;s.transaction(()=>{job=s.get("SELECT * FROM jobs WHERE status='pending' ORDER BY created_at,id LIMIT 1");if(!job)return;doc=s.get('SELECT * FROM documents WHERE id=?',job.document_id);s.run("UPDATE jobs SET status='running' WHERE id=?",job.id);doc=s.transition(doc,'OCR_PROCESSING',SYSTEM,{attempt:job.attempt});});if(!job)return;let extraction;try{extraction=await this.ocr.extract(doc,path.join(s.root,doc.file_path),this.stopController.signal);}catch(error){const message=error instanceof OCRFailure?error.message:'OCR processing failed. Contact the administrator or retry.';s.transaction(()=>{doc=s.get('SELECT * FROM documents WHERE id=?',doc.id);s.run("UPDATE jobs SET status='failed',error=? WHERE id=?",message,job.id);s.run('UPDATE documents SET error=? WHERE id=?',message,doc.id);doc=s.transition(doc,'OCR_FAILED',SYSTEM);s.event(doc,'OCR_FAILED',SYSTEM,{reason:message,attempt:job.attempt});});continue;}
      s.transaction(()=>{doc=s.get('SELECT * FROM documents WHERE id=?',doc.id);s.run('UPDATE documents SET fields=?,extraction=?,error=NULL WHERE id=?',json(extraction.fields),json(extraction),doc.id);doc=s.transition(doc,'OCR_COMPLETED',SYSTEM);s.event(doc,'OCR_COMPLETED',SYSTEM,{source:extraction.source,confidence:extraction.confidence,fields:extraction.fields});const verification=verify(s,doc.tenant_id,extraction.fields,extraction.needs_confirmation);s.run('UPDATE documents SET verification=? WHERE id=?',json(verification),doc.id);doc=s.transition(doc,'VERIFIED',SYSTEM);s.event(doc,'RULES_VERIFIED',SYSTEM,verification);s.run("UPDATE jobs SET status='done' WHERE id=?",job.id);});}
  }
}
