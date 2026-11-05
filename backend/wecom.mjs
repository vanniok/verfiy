import crypto from 'node:crypto';
import {APIError,requireValue as need,hash,safeEqual} from './core.mjs';
import {readPrivateJSON,networkEnabled,networkFetch} from './resources.mjs';

const signInReasons=new Set(['disabled','unconfigured','https_required','invalid_state','unbound','service_unavailable','signin_failed']);
function identityNeed(condition,status,message,reason){if(!condition)throw Object.assign(new APIError(status,message),{employeeSignInReason:reason});}

// Internal applications only. A WeCom identity never supplies a tenant or role.
export class WeCom {
  constructor(app,helpers,{config,fetcher=networkFetch}={}){
    this.app=app;this.h=helpers;this.fetcher=fetcher===globalThis.fetch?networkFetch:fetcher;this.live=this.fetcher===networkFetch;this.tokens=new Map();this.inflight=new Map();
    this.invalid=false;
    if(config===undefined)config=readPrivateJSON('wecom',{enabled:false});
    this.config=config||{};
    try{const u=new URL(this.config.public_origin);need(u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash,400,'Use an HTTPS origin.');this.origin=u.origin;}catch{this.origin=null;}
    this.applications=Array.isArray(this.config.applications)?this.config.applications:[];
    app.store.db.exec('CREATE TABLE IF NOT EXISTS wecom_states(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,tenant_id TEXT NOT NULL,expires INTEGER NOT NULL);');
    app.store.db.exec(`CREATE TABLE IF NOT EXISTS wecom_auth_events(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,at TEXT NOT NULL,mode TEXT NOT NULL,configuration_hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS wecom_auth_no_update BEFORE UPDATE ON wecom_auth_events BEGIN SELECT RAISE(ABORT,'WeCom login events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS wecom_auth_no_delete BEFORE DELETE ON wecom_auth_events BEGIN SELECT RAISE(ABORT,'WeCom login events are append-only'); END;`);
  }
  get enabled(){return this.config.enabled===true&&(!this.live||networkEnabled());}
  company(tenant){return this.applications.find(a=>a?.tenant_id===tenant);}
  boundAccounts(company){return new Set((Array.isArray(company?.members)?company.members:[]).map(m=>this.member(company,m?.userid)?.id).filter(Boolean));}
  missing(company){
    const fields=[];
    if(!this.enabled)fields.push('disabled');
    if(!this.origin)fields.push('public_origin');
    if(!company||typeof company.corp_id!=='string'||!/^ww[\w-]{3,100}$/.test(company.corp_id))fields.push('corp_id');
    if(!company||!/^\d{1,20}$/.test(String(company.agent_id||'')))fields.push('agent_id');
    if(!company||typeof company.secret!=='string'||company.secret.length<8||company.secret.length>200)fields.push('secret');
    if(!this.boundAccounts(company).size)fields.push('members');
    if(this.invalid)fields.push('invalid_config');
    return fields;
  }
  member(company,userid){
    if(typeof userid!=='string'||!userid)return null;
    const binding=Array.isArray(company.members)?company.members.find(m=>m?.userid===userid):null;
    if(!binding)return null;
    return this.app.store.get('SELECT u.*,t.name AS tenant_name FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=? AND u.tenant_id=?',binding.user_id,company.tenant_id)||null;
  }
  fingerprint(company){return hash(JSON.stringify({origin:this.origin,company}));}
  status(){const applications=this.app.store.all('SELECT id,name FROM tenants ORDER BY id').map(t=>{const company=this.company(t.id),missing=this.missing(company),last=this.app.store.get("SELECT at FROM wecom_auth_events WHERE tenant_id=? AND mode='wecom' AND configuration_hash=? ORDER BY id DESC LIMIT 1",t.id,this.fingerprint(company));return {tenant_id:t.id,name:t.name,configured:missing.length===0,missing,bound_account_count:this.boundAccounts(company).size,last_successful_sign_in:missing.length===0?last?.at||null:null};});return {provider:'wecom-internal',enabled:this.enabled,public_origin:this.origin,live_verified:applications.some(a=>a.last_successful_sign_in),applications};}
  account(actor){
    const company=this.company(actor.tenant_id),configured=this.missing(company).length===0,account_bound=this.boundAccounts(company).has(actor.id);
    const last=configured&&account_bound?this.app.store.get("SELECT at FROM wecom_auth_events WHERE tenant_id=? AND user_id=? AND mode='wecom' AND configuration_hash=? ORDER BY id DESC LIMIT 1",actor.tenant_id,actor.id,this.fingerprint(company)):null;
    return {tenant_id:actor.tenant_id,configured,account_bound,last_successful_sign_in:last?.at||null};
  }
  trusted(req){return Boolean(this.origin&&req.headers.host===new URL(this.origin).host&&req.headers['x-forwarded-proto']==='https'&&['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress));}
  cookie(value,age=300){return `verify_wecom_state=${value}; Path=/api/wecom; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
  async api(route,params){
    need(this.enabled,503,'WeCom employee sign-in is disabled.');
    const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/'+route);
    for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
    let data;
    try{const response=await this.fetcher(url,{signal:AbortSignal.timeout(8000),redirect:'error'});need(response.ok,502,'The WeCom identity service is unavailable.');data=await response.json();}catch(error){if(error instanceof APIError)throw error;throw new APIError(502,'The WeCom identity service could not be reached.');}
    need(data&&typeof data==='object'&&!Array.isArray(data),502,'The WeCom identity response was invalid.');
    need(!data.errcode,502,'WeCom rejected the identity request. Check the application configuration.');
    return data;
  }
  async accessToken(company){
    const cached=this.tokens.get(company.tenant_id);
    if(cached&&cached.expires>Date.now())return cached.token;
    if(this.inflight.has(company.tenant_id))return this.inflight.get(company.tenant_id);
    const request=(async()=>{const data=await this.api('gettoken',{corpid:company.corp_id,corpsecret:company.secret});need(typeof data.access_token==='string'&&data.access_token.length>0,502,'WeCom did not return an application token.');this.tokens.set(company.tenant_id,{token:data.access_token,expires:Date.now()+Math.max(0,Math.min(Number(data.expires_in)||7200,7200)-120)*1000});return data.access_token;})();
    this.inflight.set(company.tenant_id,request);
    try{return await request;}finally{this.inflight.delete(company.tenant_id);}
  }
  async handle(req,res,route){
    if(!route.startsWith('/api/wecom/'))return false;
    try{return await this.identityRoute(req,res,route);}catch(error){
      if(error instanceof APIError&&['/api/wecom/login','/api/wecom/callback'].includes(route)&&String(req.headers.accept||'').includes('text/html')){
        const reason=signInReasons.has(error.employeeSignInReason)?error.employeeSignInReason:error.status===502?'service_unavailable':'signin_failed';
        this.h.send(res,303,Buffer.alloc(0),'text/plain',{'Location':'/?employee_signin='+reason,'Set-Cookie':this.cookie('',0)});return true;
      }
      throw error;
    }
  }
  async identityRoute(req,res,route){
    need(req.method==='GET',405,'This method is not allowed.');
    const {send}=this.h,params=new URL(req.url,'http://local').searchParams;
    if(route==='/api/wecom/status'){send(res,200,this.status());return true;}
    if(route==='/api/wecom/account'){send(res,200,this.account(this.app.actor(req)));return true;}
    identityNeed(this.enabled,503,'WeCom employee sign-in is disabled.','disabled');
    identityNeed(this.trusted(req),503,'WeCom sign-in requires the configured HTTPS address and a local reverse proxy.','https_required');
    if(route==='/api/wecom/login'){
      const company=this.company(params.get('tenant'));
      identityNeed(company&&this.missing(company).length===0,503,'This organization has no complete WeCom application configuration.','unconfigured');
      const state=crypto.randomBytes(32).toString('hex'),browser=crypto.randomBytes(32).toString('hex');
      this.app.store.transaction(()=>{
        this.app.store.run('DELETE FROM wecom_states WHERE expires<=?',Date.now());
        need(this.app.store.get('SELECT COUNT(*) AS n FROM wecom_states').n<500,429,'Too many pending WeCom sign-in requests. Try again later.');
        this.app.store.run('INSERT INTO wecom_states VALUES (?,?,?,?)',hash(state),hash(browser),company.tenant_id,Date.now()+300000);
      });
      const url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
      for(const [key,value]of Object.entries({appid:company.corp_id,redirect_uri:this.origin+'/api/wecom/callback',response_type:'code',scope:'snsapi_base',state,agentid:String(company.agent_id)}))url.searchParams.set(key,value);
      url.hash='wechat_redirect';
      send(res,302,Buffer.alloc(0),'text/plain',{'Location':url.href,'Set-Cookie':this.cookie(browser)});return true;
    }
    if(route==='/api/wecom/callback'){
      const state=params.get('state'),code=params.get('code'),browser=/(?:^|;\s*)verify_wecom_state=([^;]+)/.exec(req.headers.cookie||'')?.[1];
      identityNeed(typeof state==='string'&&/^[a-f0-9]{64}$/.test(state)&&typeof code==='string'&&code.length>0&&code.length<=512,400,'The WeCom sign-in response is incomplete.','invalid_state');
      const entry=this.app.store.transaction(()=>{
        const row=this.app.store.get('SELECT * FROM wecom_states WHERE state_hash=?',hash(state));
        identityNeed(row&&row.expires>Date.now()&&browser&&safeEqual(row.browser_hash,hash(browser)),403,'The WeCom sign-in state expired or belongs to another browser.','invalid_state');
        this.app.store.run('DELETE FROM wecom_states WHERE state_hash=?',hash(state));return row;
      });
      const company=this.company(entry.tenant_id);identityNeed(company&&this.missing(company).length===0,503,'The WeCom application configuration is incomplete.','unconfigured');
      const token=await this.accessToken(company),identity=await this.api('auth/getuserinfo',{access_token:token,code});
      // OpenId/external_userid are not accepted as employees of this application.
      const user=this.member(company,identity.userid||identity.UserId);
      identityNeed(user,403,'This WeCom member has no assigned local account. Contact your application administrator.','unbound');
      const session=this.app.createSession(user);
      this.app.store.run('INSERT INTO wecom_auth_events(tenant_id,user_id,at,mode,configuration_hash) VALUES (?,?,?,?,?)',user.tenant_id,user.id,new Date().toISOString(),this.live?'wecom':'mock',this.fingerprint(company));
      send(res,303,Buffer.alloc(0),'text/plain',{'Location':'/','Set-Cookie':[this.cookie('',0),this.app.sessionCookie(session.token,true)]});return true;
    }
    throw new APIError(404,'Endpoint not found.');
  }
}
