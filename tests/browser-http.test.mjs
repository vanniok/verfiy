import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
const start=source.indexOf('function requestId(){');
const end=source.indexOf('function openModal(',start);
assert.ok(start>=0&&end>start,'Load the actual browser request functions.');
const requestSource=source.slice(start,end);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function browser({crypto={getRandomValues:array=>webcrypto.getRandomValues(array)},fetch}={}){
  const calls=[];
  const context=vm.createContext({
    crypto,FormData,S:{csrf:'csrf-test',user:{id:'operator'}},t:text=>text,
    renderLogin:()=>assert.fail('Successful requests must retain the session.'),
    fetch:async(path,options)=>{
      calls.push({path,...options,headers:{...options.headers}});
      return fetch?fetch(path,options,calls.length):{ok:true,json:async()=>({ok:true})};
    }
  });
  vm.runInContext(requestSource,context);
  return {api:context.api,requestId:context.requestId,calls};
}

test('public HTTP uploads reach fetch for PNG, Word and PDF without randomUUID',async()=>{
  const page=browser();
  for(const [filename,type] of [['delivery.png','image/png'],['order.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['delivery.pdf','application/pdf']]){
    const body=new FormData();
    body.append('file',new Blob(['test upload'],{type}),filename);
    assert.equal((await page.api('/api/conversions',{method:'POST',body})).ok,true);
    const call=page.calls.at(-1);
    assert.equal(call.body,body);
    assert.equal(call.headers['Content-Type'],undefined,'The browser supplies the multipart boundary.');
    assert.equal(call.headers['X-CSRF-Token'],'csrf-test');
    assert.match(call.headers['Idempotency-Key'],uuid);
    assert.equal(call.credentials,'same-origin');
  }
  assert.equal(new Set(page.calls.map(call=>call.headers['Idempotency-Key'])).size,3);
});

test('public HTTP JSON mutations preserve CSRF and JSON encoding',async()=>{
  const page=browser();
  await page.api('/api/conversions/example',{method:'PATCH',body:{version:3,text:'confirmed'}});
  assert.equal(page.calls[0].headers['Content-Type'],'application/json');
  assert.equal(page.calls[0].headers['X-CSRF-Token'],'csrf-test');
  assert.equal(page.calls[0].body,'{"version":3,"text":"confirmed"}');
  assert.match(page.calls[0].headers['Idempotency-Key'],uuid);
});

test('network retry reuses the request ID and body',async()=>{
  const page=browser({fetch:async(_path,_options,attempt)=>{
    if(attempt===1)throw new TypeError('Network interrupted');
    return {ok:true,json:async()=>({ok:true})};
  }});
  await page.api('/api/conversions',{method:'POST',body:{text:'one operation'}});
  assert.equal(page.calls.length,2);
  assert.match(page.calls[0].headers['Idempotency-Key'],uuid);
  assert.equal(page.calls[0].headers['Idempotency-Key'],page.calls[1].headers['Idempotency-Key']);
  assert.equal(page.calls[0].body,page.calls[1].body);
});

test('a supplied request ID is retained without requesting randomness',async()=>{
  const page=browser({crypto:{getRandomValues:()=>assert.fail('Do not replace a supplied key.')}});
  await page.api('/api/conversions',{method:'POST',key:'existing-request-key',body:{}});
  assert.equal(page.calls[0].headers['Idempotency-Key'],'existing-request-key');
});

test('HTTPS browsers retain their native UUID implementation',async()=>{
  const expected='7f9af138-7da8-46f0-aacc-e094e791d221';
  const page=browser({crypto:{randomUUID:()=>expected,getRandomValues:()=>assert.fail('Use native randomUUID when available.')}});
  await page.api('/api/conversions',{method:'POST',body:{}});
  assert.equal(page.calls[0].headers['Idempotency-Key'],expected);
});

test('GET and login/logout work without a random generator',async()=>{
  const page=browser({crypto:{}});
  await page.api('/api/demo');
  await page.api('/api/auth/login',{method:'POST',body:{email:'operator'}});
  await page.api('/api/auth/logout',{method:'POST'});
  for(const call of page.calls)assert.equal(call.headers['Idempotency-Key'],undefined);
});

test('browsers with no secure random generator fail before sending a mutation',async()=>{
  const page=browser({crypto:{}});
  await assert.rejects(page.api('/api/conversions',{method:'POST',body:{}}),/current browser/);
  assert.equal(page.calls.length,0);
});
