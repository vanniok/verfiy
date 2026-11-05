import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
if(args.length){if(args.length!==2||args[0]!=='--private-dir'||!path.isAbsolute(args[1]))throw Error('Usage: node tools/init-private.mjs [--private-dir ABSOLUTE_DIRECTORY]');process.env.VERIFY_PRIVATE_DIR=args[1];}
const {PROJECT,PRIVATE_DIR,privatePath}=await import('../backend/resources.mjs');
const created=[],skipped=[];
for(const dir of ['config','data','runtime','专属规则'])fs.mkdirSync(privatePath(dir),{recursive:true});
for(const name of ['app','wecom','wechat-demo','ocr']){
  const data=fs.readFileSync(path.join(PROJECT,'config',name+'.example.json'));
  const target=privatePath('config',name+'.json');
  try{fs.writeFileSync(target,data,{flag:'wx',mode:0o600});created.push(name+'.json');}
  catch(error){if(error.code!=='EEXIST')throw error;skipped.push(name+'.json');}
}
console.log(JSON.stringify({private_directory:PRIVATE_DIR,created,skipped,overwritten:0,network_default:false}));
