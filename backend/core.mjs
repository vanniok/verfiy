import path from 'node:path';
import crypto from 'node:crypto';
import {deploymentConfiguration} from './deployment.mjs';
import {PROJECT, dataPath, deploymentEnvironment} from './resources.mjs';

export {PROJECT};
export const DEPLOYMENT=deploymentConfiguration(PROJECT,{env:deploymentEnvironment()});
export const MAX_UPLOAD=10*1024*1024, DEMO_PASSWORD='Demo2026!', SESSION_SECONDS=8*3600;
export const ACCOUNTS=[
  ['op-a','operator@atlas.demo','Alex Morgan','atlas','Operator'],
  ['rev-a','reviewer@atlas.demo','Jordan Lee','atlas','Reviewer'],
  ['op-b','operator@northstar.demo','Sam Taylor','northstar','Operator'],
  ['rev-b','reviewer@northstar.demo','Casey Park','northstar','Reviewer']
];
export const SYSTEM={id:'system',name:'Document processing service'};
export const now=()=>new Date().toISOString();
export const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export const random=()=>crypto.randomUUID().replaceAll('-','');
export function json(value){return JSON.stringify(value);}
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export class APIError extends Error{constructor(status,message){super(message);this.status=status;}}
export function requireValue(condition,status,message){if(!condition)throw new APIError(status,message);}
export function resolveData(value){try{return dataPath(value);}catch{throw new APIError(400,'Application data must remain inside the configured private directory.');}}
export function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')){return `pbkdf2_sha256$${salt}$${crypto.pbkdf2Sync(password,Buffer.from(salt,'hex'),180000,32,'sha256').toString('hex')}`;}
export function safeEqual(a,b){const left=Buffer.from(String(a)),right=Buffer.from(String(b));return left.length===right.length&&crypto.timingSafeEqual(left,right);}
export function passwordMatches(password,stored){const [,salt]=stored.split('$');return safeEqual(passwordHash(password,salt),stored);}
const special=new Set([0x20ac,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,0x2c6,0x2030,0x160,0x2039,0x152,0x17d,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x2dc,0x2122,0x161,0x203a,0x153,0x17e,0x178]);
export function reportText(text){return [...text].every(c=>{const n=c.codePointAt(0);return n===10||n===9||(n>=32&&n<=126)||(n>=160&&n<=255)||special.has(n);});}
export function reasonText(payload){const text=payload.reason;requireValue(typeof text==='string',400,'A reason or review comment is required.');const result=text.trim();requireValue(result.length>=5&&result.length<=2000,400,'Enter a reason of 5 to 2,000 characters.');requireValue(reportText(result),400,'Use English or Western European characters for report comments in this local version.');return result;}
export const FIELD_NAMES=['purchase_order','supplier','part_number','delivered_quantity'];
export function cleanFields(value){const result={};for(const key of FIELD_NAMES){const item=value[key];if(key==='delivered_quantity'){if(item===null||item===undefined||item===''){result[key]=null;continue;}requireValue((typeof item==='number'||typeof item==='string')&&Number.isSafeInteger(Number(item))&&Math.abs(Number(item))<=1000000000,400,'Delivered quantity must be a whole number within the supported range.');result[key]=Number(item);}else{requireValue(item==null||typeof item==='string',400,key.replaceAll('_',' ')+' must be text.');result[key]=(item||'').trim();requireValue(result[key].length<=180&&!/[\x00-\x1f]/.test(result[key]),400,'Text fields must contain up to 180 printable characters.');}}return result;}
export function verify(store,tenant,fields,needsConfirmation=false){
  const issues=[];
  const issue=(code,title,detail,blocking=false,evidence={})=>issues.push({code,title,detail,blocking,evidence});
  const missing=FIELD_NAMES.filter(k=>fields[k]==null||fields[k]==='');
  if(missing.length)issue('MISSING_FIELDS','Required fields missing','Confirm: '+missing.map(k=>k.replaceAll('_',' ')).join(', ')+'.',true,{fields:missing});
  if(needsConfirmation)issue('LOW_CONFIDENCE','Extraction needs confirmation','An operator must confirm the extracted fields before submitting this document.',true);
  const order=store.get('SELECT * FROM orders WHERE tenant_id=? AND po=?',tenant,fields.purchase_order||'');
  if(!order&&fields.purchase_order)issue('ORDER_NOT_FOUND','Purchase order not found','No purchase order matches this reference in your organization.',false,{purchase_order:fields.purchase_order});
  const qty=fields.delivered_quantity;
  if(qty!=null&&qty<=0)issue('INVALID_QUANTITY','Invalid delivered quantity','Delivered quantity must be greater than zero.',true,{delivered:qty});
  if(order){order.remaining=order.ordered-order.received;if(fields.part_number&&fields.part_number!==order.part)issue('PART_MISMATCH','Part number mismatch',`The purchase order expects ${order.part}; the delivery note specifies ${fields.part_number}.`,false,{expected:order.part,actual:fields.part_number});if(qty!=null&&qty>order.remaining){const excess=qty-order.remaining;issue('QUANTITY_EXCEEDED','Quantity Discrepancy Detected',`The delivered quantity exceeds the remaining purchase order quantity by ${excess.toLocaleString('en-US')} units.`,false,{ordered:order.ordered,previously_received:order.received,remaining:order.remaining,delivered:qty,excess});}}
  const result=issues.some(i=>i.blocking)?'NEEDS_CONFIRMATION':issues.length?'EXCEPTION':'MATCHED';
  return {result,issues,order:order||null,can_submit:!issues.some(i=>i.blocking),summary:issues.length?issues[0].detail:'All required fields match the purchase order.'};
}
