import fs from 'node:fs';
import path from 'node:path';

export function deploymentConfiguration(project,{env=process.env,platform=process.platform,realpath=fs.realpathSync}={}){
  const disabled={enabled:false,platform,root:null,bindHost:'127.0.0.1',publicOrigin:null,publicHost:null,publicPort:8791,python:null,ocrMode:'local',ocrURL:null};
  if(!env.VERIFY_DEPLOY_ROOT)return disabled;
  if(platform!=='linux')throw Error('Explicit server deployment is supported only on Linux.');
  const p=path.posix,root=p.resolve(project);
  if(!p.isAbsolute(env.VERIFY_DEPLOY_ROOT)||p.resolve(env.VERIFY_DEPLOY_ROOT)!==root||p.resolve(project)!==root||p.resolve(realpath(project))!==root)throw Error('The Linux application must run from the configured trusted deployment directory.');
  if(!['127.0.0.1','0.0.0.0'].includes(env.VERIFY_BIND_HOST))throw Error('Configure an explicit local or public bind host.');
  let publicURL;
  try{publicURL=new URL(env.VERIFY_PUBLIC_ORIGIN);}catch{throw Error('Configure VERIFY_PUBLIC_ORIGIN as the server HTTP origin.');}
  if(!['http:','https:'].includes(publicURL.protocol)||publicURL.username||publicURL.password||publicURL.pathname!=='/'||publicURL.search||publicURL.hash||Number(publicURL.port||(publicURL.protocol==='https:'?443:80))<1)throw Error('Configure an HTTP(S) origin without credentials, a path, or a query.');
  const python=env.VERIFY_PYTHON;
  if(typeof python!=='string'||!p.isAbsolute(python))throw Error('Configure an explicit absolute Python executable.');
  if(env.VERIFY_OCR_MODE!=='http')throw Error('The Linux deployment requires VERIFY_OCR_MODE=http; local model loading is disabled.');
  let ocrURL;
  const rawOCRURL=env.VERIFY_OCR_URL;
  if(typeof rawOCRURL!=='string'||!/^https?:\/\//i.test(rawOCRURL)||/[\\\u0000-\u0020\u007f]/.test(rawOCRURL)||/^https?:\/\/[^/?#]*@/i.test(rawOCRURL))throw Error('Configure VERIFY_OCR_URL as an absolute HTTP or HTTPS service URL without credentials or control characters; local model loading is disabled.');
  try{ocrURL=new URL(rawOCRURL);}catch{throw Error('Configure VERIFY_OCR_URL for the shared OCR service; local model loading is disabled.');}
  if(!['http:','https:'].includes(ocrURL.protocol)||ocrURL.username||ocrURL.password||/[?#]/.test(rawOCRURL))throw Error('Configure VERIFY_OCR_URL without credentials, a query, or a fragment.');
  return {enabled:true,platform,root,bindHost:env.VERIFY_BIND_HOST,publicOrigin:publicURL.origin,publicHost:publicURL.host,publicPort:Number(publicURL.port||(publicURL.protocol==='https:'?443:80)),python:p.resolve(python),ocrMode:'http',ocrURL:ocrURL.href.replace(/\/+$/,'')};
}

export function pythonPathAllowed(project,executable,target,deployment){
  const p=deployment.enabled?path.posix:path;
  const inside=value=>{const relative=p.relative(project,p.resolve(value));return relative!==''&&!relative.startsWith('..'+p.sep)&&relative!=='..'&&!p.isAbsolute(relative);};
  if(deployment.enabled&&executable!==deployment.python)return false;
  if(!inside(executable))return false;
  if(inside(target))return true;
  return Boolean(deployment.enabled&&executable===deployment.python&&p.dirname(target)==='/usr/bin'&&/^python(?:\d+(?:\.\d+)*)?$/.test(p.basename(target)));
}

export function requestBoundary(headers,method,port,deployment,wecomTrusted=false,wecomOrigin=null){
  const expected=`127.0.0.1:${port}`,host=headers.host,origin=headers.origin;
  const publicHost=Boolean(deployment.enabled&&host===deployment.publicHost);
  return {hostAllowed:host===expected||host===`localhost:${port}`||publicHost||wecomTrusted,
    originAllowed:method==='GET'||!origin||origin===`http://${expected}`||origin===`http://localhost:${port}`||(publicHost&&origin===deployment.publicOrigin)||(wecomTrusted&&origin===wecomOrigin)};
}
