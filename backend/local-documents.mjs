import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PROJECT,APIError} from './core.mjs';
import {PRIVATE_DIR,dataPath,runtimePath,configuredPython,configuredModels,configuredProfile,documentOCR,appSettings,networkEnabled} from './resources.mjs';

const inside=(root,value)=>{const relative=path.relative(root,path.resolve(value));return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
export class LocalDocuments {
  constructor(root){this.root=dataPath(root);this.child=null;this.pending=new Map();this.sequence=0;}
  configuration(){
    const executable=configuredPython();
    let pythonReady=false;
    try{pythonReady=Boolean(executable&&path.isAbsolute(executable)&&fs.statSync(executable).isFile());}catch{}
    const sourceReady=['ocr/ocr_engine.py','ocr/native_pdf.py','ocr/word_parser.py','ocr/spreadsheet_parser.py','compare/business_compare.py','compare/app.py'].every(name=>fs.existsSync(path.join(PROJECT,'legacy',name)));
    return {executable,pythonReady,sourceReady};
  }
  status(){const {pythonReady,sourceReady}=this.configuration(),mode=documentOCR().mode;return {python_ready:pythonReady,source_ready:sourceReady,ready:pythonReady&&sourceReady,mode,message:!sourceReady?'Required parser source files are missing.':!pythonReady?'Configure an installed Python executable in private config/app.json.':'Parser source and Python are available. Individual dependencies are checked when used; image OCR mode: '+mode+'.'};}
  start(){
    if(this.child&&!this.child.killed)return;
    const config=this.configuration();
    if(!config.sourceReady)throw new APIError(503,'The original OCR and comparison source exports are not imported.');
    if(!config.pythonReady)throw new APIError(503,'The project-local Python runtime is not installed.');
    const profile=runtimePath('profile'),temp=runtimePath('temp'),cache=runtimePath('cache');
    for(const folder of [profile,temp,cache])fs.mkdirSync(folder,{recursive:true});
    const baseEnvironment=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
    const ocr=documentOCR();
    const env={...baseEnvironment,PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',TEMP:temp,TMP:temp,HOME:profile,USERPROFILE:profile,APPDATA:path.join(profile,'AppData','Roaming'),LOCALAPPDATA:path.join(profile,'AppData','Local'),VERIFY_PRIVATE_DIR:PRIVATE_DIR,VERIFY_DATA_DIR:this.root,VERIFY_RUNTIME_DIR:runtimePath(),VERIFY_MODEL_DIR:configuredModels(),VERIFY_PRIVATE_PROFILE:configuredProfile(),VERIFY_OCR_MODE:ocr.mode,VERIFY_OCR_URL:ocr.url,PADDLEOCR_HOME:path.join(cache,'paddleocr'),PADDLE_HOME:path.join(cache,'paddle'),HF_HOME:path.join(cache,'huggingface'),HF_HUB_OFFLINE:'1',NO_ALBUMENTATIONS_UPDATE:'1',XDG_CACHE_HOME:cache};
    if(ocr.mode==='http'&&networkEnabled()){const settings=appSettings();env.DOCUMENT_OCR_API_TOKEN=typeof settings.ocr_api_token==='string'?settings.ocr_api_token:'';env.DOCUMENT_OCR_TIMEOUT_SECONDS=String(settings.ocr_timeout_seconds||180);}
    this.child=spawn(config.executable,['-B','-u',path.join(PROJECT,'integration','worker.py')],{cwd:PROJECT,windowsHide:true,stdio:['pipe','pipe','pipe'],env});
    const child=this.child;
    let buffer='';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>32*1024*1024){this.fail('Local processing returned too much data.');return;}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.startsWith('@@VERIFY_JSON@@'))continue;try{const response=JSON.parse(line.slice(15)),pending=this.pending.get(response.id);if(!pending)continue;this.pending.delete(response.id);clearTimeout(pending.timer);if(response.ok)pending.resolve(response.result);else pending.reject(new APIError(422,response.error||'Local document processing failed.'));}catch{this.fail('The local processing response is invalid.');}}});
    this.child.stderr.on('data',()=>{});
    this.child.once('error',()=>{if(this.child===child)this.fail('The project-local Python worker could not start.');});
    this.child.once('exit',()=>{if(this.child===child)this.fail('The local document worker stopped.');});
  }
  fail(message){const child=this.child;this.child=null;if(child&&!child.killed)child.kill();for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new APIError(503,message));}this.pending.clear();}
  async call(action,input={},timeout=180000){
    this.start();
    const id=++this.sequence;
    return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail('Local document processing timed out. You may retry the task.'),timeout);timer.unref();this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,action,input})+'\n',error=>{if(error)this.fail('Could not send the document to the local worker.');});});
  }
  async parse(filePath,filename,profile='generic'){if(!inside(this.root,filePath)||!fs.existsSync(filePath)||!inside(this.root,fs.realpathSync(filePath)))throw new APIError(400,'The uploaded file must remain inside the configured private data directory.');return await this.call('parse',{path:path.resolve(filePath),filename,profile});}
  async compare(orderUnits,deliveryUnits){return await this.call('compare',{order_units:orderUnits,delivery_units:deliveryUnits});}
  async export(filePath,filename,units,format){return await this.call('export',{path:filePath,filename,units,format});}
  close(){this.fail('Local document processing stopped.');}
}
