import {requireValue as need,hash,canonical,now,json,random} from './core.mjs';
import {readPrivateJSON,networkEnabled,networkFetch} from './resources.mjs';

const CHANNELS=[
  {id:'kf',name:'微信客服',callback_url:'',cloud_port:5000},
  {id:'bot',name:'企业微信智能机器人',callback_url:'',cloud_port:6000}
];
// Flask may escape each non-BMP character as two JSON Unicode sequences.
// 100 messages * 12,000 characters can therefore require 14.4 MB on the wire.
const MAX_RELAY_BYTES=16000000;
const SQL=`
CREATE TABLE IF NOT EXISTS wechat_demo_messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL CHECK(channel IN ('kf','bot')),
 source TEXT NOT NULL CHECK(source IN ('wecom','simulation')),transport TEXT NOT NULL,
 message_key TEXT NOT NULL,tenant_id TEXT NOT NULL,owner_id TEXT NOT NULL,reviewer_id TEXT NOT NULL,
 sender_label TEXT NOT NULL,message_type TEXT NOT NULL,text TEXT NOT NULL,
 received_at TEXT NOT NULL,remote_at TEXT,metadata TEXT NOT NULL DEFAULT '{}',
 UNIQUE(channel,source,message_key));
CREATE INDEX IF NOT EXISTS wechat_demo_person ON wechat_demo_messages(tenant_id,owner_id,reviewer_id,channel,id);
CREATE TABLE IF NOT EXISTS wechat_demo_cursors(relay_id TEXT PRIMARY KEY,cursor INTEGER NOT NULL);
`;
const channelValid=c=>CHANNELS.some(v=>v.id===c);
const short=(v,max=180)=>typeof v==='string'?[...v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'')].slice(0,max).join(''):'';
const sameTime=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const safeMetadata=value=>Object.fromEntries(['bot_id','chat_id','chattype','open_kfid','media_id'].filter(k=>typeof value?.[k]==='string').map(k=>[k,hash(value[k]).slice(0,12)]));

export class WechatDemo {
  constructor(app,helpers,{config,fetcher=networkFetch}={}){
    this.app=app;this.s=app.store;this.h=helpers;this.fetcher=fetcher===globalThis.fetch?networkFetch:fetcher;this.live=this.fetcher===networkFetch;this.s.db.exec(SQL);
    if(config===undefined)config=readPrivateJSON('wechat-demo',{enabled:false});
    this.config=config||{};this.ownerId=this.config.demo_owner_id||'op-a';
    this.relayURL=null;this.configError=null;
    if(this.config.enabled===true){
      try{
        const u=new URL(this.config.relay_url);
        if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||typeof this.config.relay_secret!=='string'||this.config.relay_secret.length<32)throw Error();
        this.relayURL=u.href.replace(/\/$/,'');
      }catch{this.configError='Invalid private relay configuration.';}
    }
    this.relayId=this.relayURL?hash(this.relayURL+'\n'+this.config.relay_secret):'disabled';
    this.pollMs=Math.max(1000,Math.min(30000,Number(this.config.poll_ms)||2000));
    this.reachable=false;this.error=null;this.lastPollAt=null;this.timer=null;this.pending=null;this.stopped=false;this.abort=null;
  }
  get enabled(){return this.config.enabled===true&&(!this.live||networkEnabled());}
  channelConfig(id){const value=Array.isArray(this.config.channels)?this.config.channels.find(c=>c?.id===id):null;return {callback_url:typeof value?.callback_url==='string'?value.callback_url:''};}
  start(){this.stopped=false;if(this.enabled&&this.relayURL&&!this.timer)this.timer=setTimeout(()=>this.loop(),50);}
  async loop(){this.timer=null;if(this.stopped||!this.enabled)return;await this.poll();if(!this.stopped&&this.enabled)this.timer=setTimeout(()=>this.loop(),this.error?Math.max(15000,this.pollMs):this.pollMs);}
  async close(){this.stopped=true;clearTimeout(this.timer);this.timer=null;this.abort?.abort();if(this.pending)await this.pending;}
  visible(actor){return {sql:`tenant_id=? AND ${actor.role==='Operator'?'owner_id':'reviewer_id'}=?`,args:[actor.tenant_id,actor.id]};}
  channelAccess(actor,channel){
    const bindings=Array.isArray(this.config.bindings)?this.config.bindings:[];
    const ids=new Set([this.ownerId,...bindings.filter(b=>b?.channel===channel&&typeof b.sender_id==='string'&&b.sender_id.trim()&&typeof b.user_id==='string').map(b=>b.user_id)]);
    const enabled=[...ids].some(id=>{
      const owner=this.s.get("SELECT * FROM users WHERE id=? AND tenant_id=? AND role='Operator'",id,actor.tenant_id);
      if(!owner)return false;
      if(actor.role==='Operator')return owner.id===actor.id;
      if(actor.role!=='Reviewer')return false;
      try{return this.app.access.reviewer(owner).id===actor.id;}catch{return false;}
    });
    return {enabled,reason:enabled?'ready':'identity_not_bound',can_simulate:enabled&&actor.role==='Operator',can_clear:enabled&&actor.role==='Operator'};
  }
  messages(actor,channel){
    const v=this.visible(actor);
    return this.s.all(`SELECT id,channel,source,transport,message_key,sender_label,message_type,text,received_at,remote_at FROM wechat_demo_messages WHERE ${v.sql} AND channel=? ORDER BY id DESC LIMIT 100`,...v.args,channel).reverse();
  }
  status(actor){
    const v=this.visible(actor),at=Date.now(),recent=this.lastPollAt&&at-Date.parse(this.lastPollAt)<45000;
    return {
      channels:CHANNELS.map(c=>{
        const n=this.s.get(`SELECT SUM(source='wecom') AS real_messages,SUM(source='simulation') AS simulated_messages,MAX(received_at) AS last_received_at,MAX(CASE WHEN source='wecom' THEN received_at END) AS last_real_at FROM wechat_demo_messages WHERE ${v.sql} AND channel=?`,...v.args,c.id);
        const access=this.channelAccess(actor,c.id);
        const state=!access.enabled?'identity_not_bound':!this.enabled||!this.relayURL?'not_configured':this.error?'error':this.reachable&&recent&&n.real_messages>0?'online':'waiting';
        return {...c,...this.channelConfig(c.id),access,relay_state:state,real_messages:n.real_messages||0,simulated_messages:n.simulated_messages||0,last_received_at:n.last_received_at,last_real_at:n.last_real_at,last_real_received_at:n.last_real_at,last_poll_at:this.lastPollAt,error:this.error||this.configError};
      }),
      relay:{configured:Boolean(this.enabled&&this.relayURL),reachable:Boolean(this.enabled&&this.reachable&&recent),error:this.error||this.configError,last_poll_at:this.lastPollAt},
      inbox:{demo:true,is_demo_owner:actor.id===this.ownerId,unknown_senders:'isolated_demo_inbox',can_simulate:actor.role==='Operator'&&CHANNELS.some(c=>this.channelAccess(actor,c.id).enabled)},
      agent_enabled:false
    };
  }
  owner(event){
    const bindings=Array.isArray(this.config.bindings)?this.config.bindings:[];
    const binding=event.sender_id&&bindings.find(b=>b?.channel===event.channel&&typeof b.sender_id==='string'&&b.sender_id.trim()&&b.sender_id===event.sender_id&&(!b.open_kfid||b.open_kfid===event.metadata?.open_kfid));
    const owner=this.s.get("SELECT * FROM users WHERE id=? AND role='Operator'",binding?.user_id||this.ownerId);
    need(owner,503,'Configure an operator account for the isolated demo inbox.');
    return owner;
  }
  normalize(event){
    need(event&&channelValid(event.channel)&&Number.isSafeInteger(event.sequence)&&event.sequence>0,502,'The relay returned an invalid message batch.');
    const key=short(event.message_key,256),sender=short(event.sender_id,256),text=short(event.text,12000);
    need(key&&typeof event.sender_id==='string'&&typeof event.text==='string'&&[...event.text].length<=12000,502,'The relay returned an invalid message batch.');
    const owner=this.owner(event),reviewer=this.app.access.reviewer(owner);
    const label=event.channel==='kf'?'微信客户':'企业微信成员';
    return {channel:event.channel,key,owner,reviewer,text,sender_label:sender?label+' · '+hash(sender).slice(0,8):'未提供发送者',message_type:short(event.message_type,40)||'unknown',remote_at:sameTime(event.remote_at),metadata:safeMetadata(event.metadata)};
  }
  importPage(data,after){
    need(data&&Array.isArray(data.events)&&data.events.length<=100&&Number.isSafeInteger(data.cursor)&&data.cursor>=after,502,'The relay returned an invalid message batch.');
    let previous=after;
    const records=data.events.map(e=>{need(e.sequence>previous&&e.sequence<=data.cursor,502,'The relay returned an invalid message batch.');previous=e.sequence;return this.normalize(e);});
    need(data.cursor===(data.events.length?previous:after),502,'The relay cursor does not match its messages.');
    return this.s.transaction(()=>{
      let inserted=0;
      for(const r of records){
        inserted+=Number(this.s.run('INSERT OR IGNORE INTO wechat_demo_messages(channel,source,transport,message_key,tenant_id,owner_id,reviewer_id,sender_label,message_type,text,received_at,remote_at,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',r.channel,'wecom','cloud_relay',r.key,r.owner.tenant_id,r.owner.id,r.reviewer.id,r.sender_label,r.message_type,r.text,now(),r.remote_at,json(r.metadata)).changes);
      }
      this.s.run('INSERT INTO wechat_demo_cursors VALUES (?,?) ON CONFLICT(relay_id) DO UPDATE SET cursor=excluded.cursor',this.relayId,data.cursor);
      return inserted;
    });
  }
  poll(){
    if(this.pending)return this.pending;
    if(!this.enabled||!this.relayURL)return Promise.resolve({configured:false});
    this.pending=this.receive().finally(()=>{this.pending=null;this.abort=null;});return this.pending;
  }
  async receive(){
    if(!this.enabled||!this.relayURL)return {configured:false};
    const after=this.s.get('SELECT cursor FROM wechat_demo_cursors WHERE relay_id=?',this.relayId)?.cursor||0;
    this.lastPollAt=now();this.abort=new AbortController();
    const timeout=setTimeout(()=>this.abort?.abort(),8000);
    try{
      const url=new URL(this.relayURL+'/events');url.searchParams.set('after',String(after));url.searchParams.set('limit','100');
      const response=await this.fetcher(url,{headers:{Authorization:'Bearer '+this.config.relay_secret,Accept:'application/json'},redirect:'manual',signal:this.abort.signal});
      if(!response.ok){const errors={401:'The cloud relay key does not match.',403:'The cloud relay key does not match.',404:'Install the cloud relay and its Nginx route first.'};this.error=errors[response.status]||'The cloud relay is temporarily unavailable.';this.reachable=false;return {ok:false};}
      need((response.headers?.get('content-type')||'').includes('application/json'),502,'The relay returned an invalid message batch.');
      const declared=Number(response.headers.get('content-length')||0);need(declared<=MAX_RELAY_BYTES,502,'The relay response is too large.');
      const reader=response.body.getReader();let length=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_RELAY_BYTES){await reader.cancel();throw Error('oversize');}chunks.push(Buffer.from(value));}
      const inserted=this.importPage(JSON.parse(Buffer.concat(chunks).toString('utf8')),after);
      this.reachable=true;this.error=null;return {ok:true,inserted};
    }catch(error){this.reachable=false;this.error=error?.status===502?'The relay returned an invalid message batch.':'Unable to reach the cloud relay. Check installation and local network access.';return {ok:false};}
    finally{clearTimeout(timeout);}
  }
  async handle(req,res,route){
    if(!route.startsWith('/api/wechat-demo/'))return false;
    const mutation=req.method!=='GET',actor=this.app.actor(req,mutation),{send,payload}=this.h;
    if(route==='/api/wechat-demo/status'&&req.method==='GET'){send(res,200,this.status(actor));return true;}
    if(route==='/api/wechat-demo/messages'&&req.method==='GET'){
      const channel=new URL(req.url,'http://localhost').searchParams.get('channel');need(channelValid(channel),400,'Choose the WeChat customer service or robot channel.');send(res,200,{channel,messages:this.messages(actor,channel)});return true;
    }
    if(route==='/api/wechat-demo/messages'&&req.method==='DELETE'){
      this.app.role(actor,'Operator');
      const channel=new URL(req.url,'http://localhost').searchParams.get('channel');need(channelValid(channel),400,'Choose the WeChat customer service or robot channel.');
      need(this.channelAccess(actor,channel).can_clear,403,'This account has no WeChat identity binding for this channel.');
      const visible=this.visible(actor);
      const deleted=Number(this.s.run(`DELETE FROM wechat_demo_messages WHERE ${visible.sql} AND channel=?`,...visible.args,channel).changes);
      // Keep the relay cursor. Clearing the local inbox must not replay cloud
      // events that this installation has already consumed.
      send(res,200,{channel,deleted});return true;
    }
    if(route==='/api/wechat-demo/simulate'&&req.method==='POST'){
      this.app.role(actor,'Operator');const p=await payload(req);need(channelValid(p.channel)&&typeof p.text==='string'&&p.text.trim().length>0&&p.text.length<=2000,400,'Choose a channel and enter a message of up to 2000 characters.');
      need(this.channelAccess(actor,p.channel).can_simulate,403,'This account has no WeChat identity binding for this channel.');
      const key=this.app.requestKey(req),digest=hash(canonical(p));
      const result=this.s.transaction(()=>{
        const cached=this.app.cached(actor,key,digest,req.method,route);if(cached)return cached;
        const reviewer=this.app.access.reviewer(actor),messageKey='simulation-'+random();
        const insert=this.s.run('INSERT INTO wechat_demo_messages(channel,source,transport,message_key,tenant_id,owner_id,reviewer_id,sender_label,message_type,text,received_at,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',p.channel,'simulation','simulation',messageKey,actor.tenant_id,actor.id,reviewer.id,actor.name,'text',short(p.text.trim(),2000),now(),'{}');
        const message=this.messages(actor,p.channel).find(m=>m.id===Number(insert.lastInsertRowid));
        const response={message};this.app.remember(actor,key,digest,req.method,route,201,response);return {status:201,response};
      });send(res,result.status,result.response);return true;
    }
    need(false,404,'Endpoint not found.');
  }
}
