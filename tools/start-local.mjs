import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {PROJECT,runtimePath} from '../backend/resources.mjs';

const root=runtimePath('process');fs.mkdirSync(root,{recursive:true});
const pidFile=runtimePath('process','server.pid');
if(fs.existsSync(pidFile))throw Error('A process record already exists in private storage. Verify that process before starting again.');
const output=fs.openSync(runtimePath('process','server.log'),'a',0o600),errors=fs.openSync(runtimePath('process','server-error.log'),'a',0o600);
const child=spawn(process.execPath,[path.join(PROJECT,'server.mjs'),...process.argv.slice(2)],{cwd:PROJECT,windowsHide:true,stdio:['inherit',output,errors],env:{...process.env}});
if(Number.isInteger(child.pid)){try{fs.writeFileSync(pidFile,String(child.pid),{flag:'wx',mode:0o600});}catch(error){child.kill();throw error;}}
let stopping=false,cleaned=false;
const cleanup=()=>{if(cleaned)return;cleaned=true;fs.closeSync(output);fs.closeSync(errors);if(fs.existsSync(pidFile)&&fs.readFileSync(pidFile,'utf8').trim()===String(child.pid))fs.unlinkSync(pidFile);};
function stopInstance(){if(stopping||!Number.isInteger(child.pid))return;stopping=true;if(process.platform==='win32'){spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}else child.kill('SIGTERM');}
for(const event of ['SIGINT','SIGTERM'])process.on(event,stopInstance);
child.once('error',error=>{cleanup();console.error('Could not launch the application: '+error.message);process.exitCode=1;});
child.once('exit',code=>{cleanup();process.exitCode=code??0;});
console.log('Application output is stored in the configured private runtime/process directory. Use Ctrl+C to stop this instance.');
