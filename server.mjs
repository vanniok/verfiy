import {Application} from './backend/server.mjs';
import {PROJECT,DEPLOYMENT} from './backend/core.mjs';
import {appSettings} from './backend/resources.mjs';
import {seedIfEmpty} from './tools/seed-demo.mjs';
import {seedWorkbench} from './tools/seed-workbench.mjs';
process.chdir(PROJECT);
const args=process.argv.slice(2);let port=DEPLOYMENT.enabled?DEPLOYMENT.publicPort:Number(appSettings().port||8791),root;
for(let i=0;i<args.length;i++){if(args[i]==='--port')port=Number(args[++i]);else if(args[i]==='--data-dir')root=args[++i];else throw Error('Unknown argument: '+args[i]);}
const app=new Application({root});
try{await app.listen(port);}catch(error){console.error('Could not start Verify. '+error.message);console.error(`If already running, open http://127.0.0.1:${port}`);process.exit(1);}
console.log(`VERIFY is running at ${app.base}`);
if(DEPLOYMENT.enabled)console.log(`Public application address: ${app.publicBase}`);
console.log(`OCR mode: ${app.ocr.mode}. All application data: ${app.store.root}`);
if(appSettings().seed_demo===true&&app.ocr.mode==='demo')seedIfEmpty(app.base).catch(()=>console.log('Demo initialization was incomplete. Samples remain available from New document.'));
if(appSettings().seed_demo===true&&app.local.status().ready)seedWorkbench(app.base).catch(error=>console.log('Local workbench sample: '+error.message));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await app.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
