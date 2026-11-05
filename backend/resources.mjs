import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const within=(root,target)=>{const r=path.relative(root,target);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function realTarget(value){let current=path.resolve(value),tail=[];while(!fs.existsSync(current)){const next=path.dirname(current);if(next===current)throw Error('Cannot resolve private resource parent.');tail.unshift(path.basename(current));current=next;}return path.resolve(fs.realpathSync(current),...tail);}
export const PRIVATE_DIR=path.resolve(process.env.VERIFY_PRIVATE_DIR||path.join(PROJECT,'..','02_私有资料_禁止上传'));
const privateReal=realTarget(PRIVATE_DIR),projectReal=fs.realpathSync(PROJECT);
if(within(projectReal,privateReal)||within(privateReal,projectReal))throw Error('Private storage must be separate from the public source directory.');
export function privatePath(...parts){const target=path.resolve(PRIVATE_DIR,...parts);if(!within(PRIVATE_DIR,target)||!within(privateReal,realTarget(target)))throw Error('Resource path must remain inside private storage.');return target;}
export function readPrivateJSON(name,fallback={}){if(!/^[a-z][a-z0-9-]*$/.test(name))throw Error('Invalid private configuration name.');const file=privatePath('config',name+'.json');if(!fs.existsSync(file))return structuredClone(fallback);try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw Error('Invalid private configuration: '+name+'.json. No values were logged.');}}
let cached;
export function appSettings(){return cached??=readPrivateJSON('app',{});}
export function networkEnabled(){return appSettings().allow_network===true;}
export async function networkFetch(...args){if(!networkEnabled())throw Error('External connections are disabled. Explicit private configuration is required.');return globalThis.fetch(...args);}
export function dataPath(value){const selected=value||appSettings().data_dir||'data';return privatePath(selected);}
export function runtimePath(...parts){return privatePath(appSettings().runtime_dir||'runtime',...parts);}
export function samplePath(...parts){return privatePath('generated-samples',...parts);}
export function integrationSamplePath(name){if(path.basename(name)!==name)throw Error('Invalid demonstration filename.');return path.join(PROJECT,'integration_samples',name);}
export function configuredPython(){const value=appSettings().python_executable;if(typeof value!=='string'||!value.trim())return '';return path.isAbsolute(value)?path.normalize(value):privatePath(value);}
export function configuredModels(){const value=appSettings().model_dir;return typeof value==='string'&&value.trim()?privatePath(value):'';}
export function configuredProfile(){const value=appSettings().business_profile_module;return typeof value==='string'&&value.trim()?privatePath(value):'';}
export function documentOCR(){const mode=appSettings().ocr_mode||'disabled';if(!['disabled','local','http'].includes(mode))throw Error('ocr_mode must be disabled, local or http.');const url=appSettings().ocr_url||'';if(mode==='http'&&!networkEnabled())return {mode:'disabled',url:''};if(mode==='http'){let u;try{u=new URL(url);}catch{throw Error('Configure a private OCR URL.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Configure an HTTP(S) OCR URL without credentials, query or fragment.');}return {mode,url:mode==='http'?url:''};}
export function deploymentEnvironment(){const d=appSettings().deployment;if(!networkEnabled()||!d||d.enabled!==true)return {};return {VERIFY_DEPLOY_ROOT:PROJECT,VERIFY_BIND_HOST:d.bind_host||'127.0.0.1',VERIFY_PUBLIC_ORIGIN:d.public_origin||'',VERIFY_PYTHON:configuredPython(),VERIFY_OCR_MODE:documentOCR().mode,VERIFY_OCR_URL:documentOCR().url};}
