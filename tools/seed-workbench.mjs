import fs from 'node:fs';
import path from 'node:path';
import {PROJECT,random} from '../backend/core.mjs';
export async function seedWorkbench(base){
  const u=new URL(base);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('Demo initialization is restricted to a local test instance.');
  let cookie='',csrf='';
  async function request(route,method='GET',body){const headers={Cookie:cookie};if(method!=='GET'){headers['X-CSRF-Token']=csrf;headers['Idempotency-Key']=random();}let data=body;if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';data=JSON.stringify(body);}const response=await fetch(base+route,{method,headers,body:data});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
  try{
    csrf=(await request('/api/auth/login','POST',{email:'operator@atlas.demo',password:'Demo2026!'})).csrf;
    if((await request('/api/comparisons')).comparisons.length)return;
    const files=[];
    for(const name of ['sample-order.docx','sample-delivery.xlsx']){const form=new FormData();form.append('file',new Blob([fs.readFileSync(path.join(PROJECT,'integration_samples',name))]),name);let file=(await request('/api/conversions','POST',form)).file;for(let i=0;i<200;i++){file=(await request('/api/conversions/'+file.id)).file;if(['READY','FAILED'].includes(file.state))break;await new Promise(r=>setTimeout(r,100));}if(file.state!=='READY')throw Error(file.error||'Sample conversion did not finish.');files.push(file);}
    let c=(await request('/api/comparisons','POST',{title:'Local sample — original order vs delivery'})).comparison;
    c=(await request('/api/comparisons/'+c.id,'PATCH',{version:c.version,order_id:files[0].id,delivery_id:files[1].id})).comparison;
    await request('/api/comparisons/'+c.id+'/compare','POST',{version:c.version,order_version:files[0].version,delivery_version:files[1].version});
    console.log('Local workbench sample ready: PN-A excess 60, PN-B remaining 300, PN-C extra 3.5. Operator confirmation and review are available.');
  }finally{if(csrf)await request('/api/auth/logout','POST').catch(()=>{});}
}
