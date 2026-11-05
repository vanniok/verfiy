'use strict';
Object.assign(zh,{
  'WeChat customer service':'微信客服','WeCom robot':'企业微信机器人','WeChat message demo':'微信消息演示','Member sign-in settings':'成员登录设置',
  'Customer service inbox':'微信客服消息入口','Robot message inbox':'企业微信机器人消息入口',
  'Two channels. Messages arrive here.':'两条微信通道，消息汇入这里。',
  'Send a message through your connected WeChat customer service conversation and watch it arrive in this inbox.':'从已经打通的微信客服会话发送消息，在这个入口查看主程序的接收结果。',
  'Send a message to your connected WeCom robot and watch it arrive in this inbox.':'向已经打通的企业微信智能机器人发送消息，在这个入口查看主程序的接收结果。',
  'Customer service':'微信客服','WeCom intelligent robot':'企业微信智能机器人','Cloud callback':'阿里云接收入口','Main program inbox':'主程序收件箱',
  'Message connection demo':'消息联通演示','Live reception verified':'已收到真实微信消息','Waiting for first real message':'等待第一条真实微信消息',
  'Cloud relay setup required':'等待配置云端转接','Connection needs attention':'连接需要检查','Checking connection…':'正在检查连接…',
  'Real WeChat messages':'真实微信消息','Local simulation messages':'本地模拟消息','Most recent real arrival':'最后真实接收时间',
  'No real messages yet':'尚未收到真实消息','Received messages':'收到的消息','Updates automatically':'自动更新','Refresh inbox':'刷新收件箱','Clear current channel':'清空当前通道',
  "Clear all messages in this channel? This removes real and simulated messages from your account's local inbox.":'确定清空当前通道吗？这会删除你账号在此通道的真实消息和本地模拟消息。','Channel messages cleared.':'当前通道记录已清空。',
  'Waiting for a customer service message':'等待微信客服消息','Waiting for a robot message':'等待企业微信机器人消息',
  'This inbox displays messages after the cloud relay delivers them to the main program.':'云端转接把消息送达主程序后，这里会自动显示。',
  'Real WeChat':'真实微信','Local simulation':'本地模拟','Cloud relay':'云端转接','Direct callback':'微信直接回调',
  'Text':'文本','Image':'图片','Voice':'语音','File':'文件','Video':'视频','Event':'事件','Mixed message':'混合消息','Non-text message received':'已收到非文本消息',
  'Sender':'发送者','Unknown sender':'未提供发送者','Message ID':'消息编号','Received at':'主程序接收时间',
  'Try a local simulation':'试用本地模拟','Simulation checks this screen. A real WeChat message is still required to verify the connection.':'模拟用于检查这个演示画面。确认微信接通需要收到真实微信消息。',
  'Type a simulated message…':'输入一条本地模拟消息…','Add simulated message':'添加模拟消息','Adding message…':'正在添加…','Simulation added. Send a real WeChat message to verify the connection.':'已添加模拟消息。请从微信发送真实消息来验证接通。',
  'Connection details':'连接信息','Public callback address':'公网回调地址','Cloud service port':'阿里云程序端口','Main program reception':'主程序接收状态',
  'Cloud relay configured':'云端转接已配置','Cloud relay not configured':'云端转接尚未配置','Last connection check':'最后连接检查',
  'Configure the cloud relay before testing real WeChat messages in this local program.':'先配置云端转接，再从微信发送消息测试这个本地主程序。',
  'Cloud relay is ready. Send a real message through this channel.':'云端转接已就绪。请通过这条微信通道发送真实消息。',
  'Waiting for cloud relay readiness':'等待云端转接就绪','Waiting for the cloud relay to become ready, then send a real WeChat message.':'等待云端转接就绪，再从微信发送真实消息。',
  'Reception paused. Check the cloud relay connection and refresh this inbox.':'接收暂时中断。请检查云端转接连接，并刷新收件箱。',
  'This channel is receiving real WeChat messages.':'这个入口已接收到真实微信消息。',
  'Channel messages are for this demonstration workspace. Staff roles and review permissions remain assigned to signed-in accounts.':'消息在这个演示工作区展示。人员身份与审核权限仍由登录账号决定。',
  'Unable to refresh the inbox. Your received messages remain visible.':'收件箱暂时无法刷新，已收到的消息仍显示在这里。',
  'View customer service messages':'查看微信客服消息','View robot messages':'查看机器人消息','Customer service route':'微信客服路线','Robot route':'机器人路线'
});

const WechatDemo=(()=>{
  const channels={
    kf:{view:'wechat-kf',title:'Customer service inbox',name:'WeChat customer service',description:'Send a message through your connected WeChat customer service conversation and watch it arrive in this inbox.',callback:'',port:5000,symbol:'chat',short:'KF'},
    bot:{view:'wechat-bot',title:'Robot message inbox',name:'WeCom robot',description:'Send a message to your connected WeCom robot and watch it arrive in this inbox.',callback:'',port:6000,symbol:'robot',short:'BOT'}
  };
  const fresh=()=>({userId:null,revision:0,busy:false,sending:false,clearing:false,status:null,error:'',messages:{kf:[],bot:[]},drafts:{kf:'',bot:''},fingerprints:{kf:'',bot:''},checkedAt:null});
  let state=fresh();
  const active=()=>!!S.user&&['wechat-kf','wechat-bot'].includes(S.view);
  const channelId=()=>S.view==='wechat-bot'?'bot':'kf';
  function symbol(name){
    const path=name==='robot'?'M8 3h8v3H8z M12 1v2 M5 7h14v12H5z M2 11h3 M19 11h3 M8 19v3 M16 19v3 M8 11h1 M15 11h1 M9 15h6':'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5';
    return `<svg class="wechat-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  }
  function account(){if(state.userId!==S.user?.id){const revision=state.revision+1;state=fresh();state.userId=S.user?.id;state.revision=revision;}}
  function info(id){return state.status?.channels?.find(c=>c.id===id)||{};}
  const access=id=>Personnel.messageAccess(id,state.status);
  const canSimulate=id=>S.user?.role==='Operator'&&access(id).enabled===true&&access(id).can_simulate===true;
  const canClear=id=>S.user?.role==='Operator'&&access(id).enabled===true&&access(id).can_clear===true;
  function realCount(id){return Number(info(id).real_messages)||0;}
  function connection(id){
    const c=info(id),relay=state.status?.relay;
    if(state.error||c.relay_state==='error')return {label:'Connection needs attention',className:'error',note:'Reception paused. Check the cloud relay connection and refresh this inbox.'};
    if(!state.status)return {label:'Checking connection…',className:'waiting',note:'This inbox displays messages after the cloud relay delivers them to the main program.'};
    if(c.relay_state==='not_configured'||!relay?.configured)return {label:'Cloud relay setup required',className:'waiting',note:'Configure the cloud relay before testing real WeChat messages in this local program.'};
    if(c.relay_state==='online')return {label:'Live reception verified',className:'live',note:'This channel is receiving real WeChat messages.'};
    if(!relay.reachable)return {label:'Waiting for cloud relay readiness',className:'waiting',note:'Waiting for the cloud relay to become ready, then send a real WeChat message.'};
    return {label:'Waiting for first real message',className:'waiting',note:'Cloud relay is ready. Send a real message through this channel.'};
  }
  function time(value){if(!value)return t('No real messages yet');const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'—':parsed.toLocaleString(language==='en'?'en-GB':'zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}
  function lastReal(id){const c=info(id);return c.last_real_received_at||state.messages[id].filter(m=>m.source==='wecom').sort((a,b)=>String(b.received_at).localeCompare(String(a.received_at)))[0]?.received_at||(realCount(id)>0?c.last_received_at:null);}
  function transport(message){return message.transport==='direct_callback'?'Direct callback':message.source==='simulation'?'Local simulation':'Cloud relay';}
  function typeName(type){return {text:'Text',image:'Image',voice:'Voice',file:'File',video:'Video',event:'Event',mixed:'Mixed message'}[type]||type||'Text';}
  function bubble(message){
    const real=message.source==='wecom',sender=message.sender_label||t('Unknown sender'),text=message.text||t('Non-text message received');
    return `<article class="wechat-message ${real?'is-real':'is-simulated'}" data-message-id="${esc(message.id)}" data-message-source="${real?'wecom':'simulation'}"><div class="wechat-message-avatar">${esc([...String(sender)][0]||'?')}</div><div class="wechat-message-body"><div class="wechat-message-meta"><strong>${esc(sender)}</strong><span class="wechat-source ${real?'real':'simulation'}">${h(real?'Real WeChat':'Local simulation')}</span><time datetime="${esc(message.received_at)}">${esc(time(message.received_at))}</time></div><div class="wechat-bubble"><p>${esc(text)}</p></div><div class="wechat-message-foot"><span>${h(typeName(message.message_type))}</span><span>${h(transport(message))}</span><span title="${h('Message ID')}">${esc(message.id)}</span></div></div></article>`;
  }
  function messageList(id){
    if(state.messages[id].length)return state.messages[id].map(bubble).join('');
    return `<div class="wechat-empty">${symbol(channels[id].symbol)}<h3>${h(id==='kf'?'Waiting for a customer service message':'Waiting for a robot message')}</h3><p>${h(channels[id].description)}</p><span>${h('This inbox displays messages after the cloud relay delivers them to the main program.')}</span></div>`;
  }
  function drawUnavailable(){
    const id=channelId(),channel=channels[id],pending=access(id).enabled===null;
    $('#content').innerHTML=`<div class="wechat-demo wechat-access-page" data-wechat-channel="${id}" data-message-access="${pending?'checking':'disabled'}"><div class="page-head"><div><h1>${h(channel.title)}</h1><p>${h(channel.name)}</p></div></div><div class="wechat-channel-tabs" role="group" aria-label="${h('WeChat message demo')}">${Object.entries(channels).map(([key,c])=>`<button class="${id===key?'selected':''} ${access(key).enabled===false?'is-message-unbound':''}" data-action="nav" data-view="${c.view}" aria-pressed="${id===key}">${symbol(c.symbol)}<span>${h(c.name)}</span>${access(key).enabled===false?`<span class="wechat-tab-count">${h('Not linked')}</span>`:''}</button>`).join('')}</div><section class="panel wechat-unavailable" id="wechat-unavailable" role="status"><span class="wechat-unavailable-mark">${icon('user')}</span><div class="eyebrow">${h(pending?'Checking account access…':'WeChat identity not linked')}</div><h2>${h(pending?'Checking account access…':'Message inbox temporarily unavailable')}</h2><p>${h(pending?'Please refresh to check this account’s message access.':'This account has no WeChat message identity binding.')}</p><dl class="wechat-unavailable-account"><div><dt>${h('Your company')}</dt><dd>${esc(S.user.tenant_name)}</dd></div><div><dt>${h('Your account')}</dt><dd>${esc(S.user.name)}</dd></div><div><dt>${h('Your role')}</dt><dd>${h(S.user.business_role||S.user.role)}</dd></div></dl>${pending?'':`<p>${h('Link this account to its WeChat identity to enable its own message inbox.')}</p><p class="wechat-unavailable-note">${icon('shield')}${h('Messages assigned to other accounts stay in their own workspaces.')}</p>`}<p class="wechat-access-error" id="wechat-access-error" hidden role="alert"></p><div class="wechat-unavailable-actions"><button class="btn" data-wechat-action="refresh">${icon('refresh')}${h('Check binding status')}</button><button class="btn ghost" data-action="nav" data-view="workspace">${h('Back to my workspace')}${icon('arrow')}</button></div></section><p class="wechat-permission-note">${icon('user')}${h('Employee sign-in and message identity bindings are configured separately.')}</p></div>`;
    for(const button of document.querySelectorAll('.wechat-channel-tabs [data-view]'))button.dataset.channelTab=button.dataset.view==='wechat-bot'?'bot':'kf';
    paint();
  }
  function draw(){
    if(!active())return;
    if(access(channelId()).enabled!==true){drawUnavailable();return;}
    const id=channelId(),other=id==='kf'?'bot':'kf',channel=channels[id];
    $('#content').innerHTML=`<div class="wechat-demo" data-wechat-channel="${id}"><section class="wechat-hero"><div class="wechat-hero-copy"><div class="eyebrow">${h('Message connection demo')} <span>${id==='kf'?'01':'02'} / 02</span></div><h1>${h(channel.title)}</h1><p>${h(channel.description)}</p><div class="wechat-connection" id="wechat-connection" role="status"></div></div><div class="wechat-hero-art" aria-hidden="true"><div class="wechat-orbit"></div><div class="wechat-app-mark">${symbol(channel.symbol)}</div><div class="wechat-arrival-mark">${icon('check')}<span>VERIFY</span></div></div></section><div class="wechat-channel-tabs" role="group" aria-label="${h('WeChat message demo')}">${Object.entries(channels).map(([key,c])=>`<button class="${id===key?'selected':''}" data-action="nav" data-view="${c.view}" aria-pressed="${id===key}">${symbol(c.symbol)}<span>${h(c.name)}</span><span class="wechat-tab-count" data-wechat-count="${key}">${realCount(key)}</span></button>`).join('')}</div><div class="wechat-metrics"><div><span>${h('Real WeChat messages')}</span><strong id="wechat-real-count">0</strong><small>${h(channel.name)}</small></div><div><span>${h('Local simulation messages')}</span><strong id="wechat-simulation-count">0</strong><small>${h('Local simulation')}</small></div><div class="wechat-time-metric"><span>${h('Most recent real arrival')}</span><strong id="wechat-last-real">—</strong><small>${h('Received at')}</small></div></div><div class="wechat-layout"><section class="wechat-inbox panel"><div class="wechat-inbox-head"><div><h2>${h('Received messages')}</h2><p><i class="wechat-pulse"></i>${h('Updates automatically')}</p></div><button class="btn ghost compact" data-wechat-action="refresh" aria-label="${h('Refresh inbox')}">${icon('refresh')}<span>${h('Refresh inbox')}</span></button></div><div class="wechat-error" id="wechat-error" hidden role="alert"></div><div class="wechat-messages" id="wechat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="${h(channel.title)}">${messageList(id)}</div>${S.user.role==='Operator'?`<form class="wechat-compose" id="wechat-simulate-form"><div class="wechat-compose-title"><strong>${h('Try a local simulation')}</strong><span class="wechat-source simulation">${h('Local simulation')}</span></div><p>${h('Simulation checks this screen. A real WeChat message is still required to verify the connection.')}</p><label class="sr-only" for="wechat-simulate-text">${h('Type a simulated message…')}</label><textarea class="input" id="wechat-simulate-text" name="text" required maxlength="2000" rows="2" placeholder="${h('Type a simulated message…')}">${esc(state.drafts[id])}</textarea><button class="btn" type="submit" id="wechat-simulate-submit">${icon('plus')}${h('Add simulated message')}</button></form>`:''}</section><aside class="wechat-side"><section class="panel wechat-path"><div class="wechat-side-heading"><h2>${h('Main program reception')}</h2><span class="wechat-route-label">${h(id==='kf'?'Customer service route':'Robot route')}</span></div><div class="wechat-path-step"><span class="wechat-step-mark">${symbol(channel.symbol)}</span><div><strong>${h(id==='kf'?'Customer service':'WeCom intelligent robot')}</strong><small>${h(channel.name)}</small></div></div><div class="wechat-path-line"></div><div class="wechat-path-step"><span class="wechat-step-mark cloud">${icon('external')}</span><div><strong>${h('Cloud callback')}</strong><small id="wechat-callback-host"></small></div></div><div class="wechat-path-line"></div><div class="wechat-path-step" id="wechat-received-step"><span class="wechat-step-mark received">${icon('check')}</span><div><strong>${h('Main program inbox')}</strong><small id="wechat-path-status">${h('Waiting for first real message')}</small></div></div><p class="wechat-connection-note" id="wechat-connection-note"></p></section><section class="panel wechat-details"><h2>${h('Connection details')}</h2><dl><div><dt>${h('Public callback address')}</dt><dd class="wechat-url" id="wechat-callback">${esc(channel.callback)}</dd></div><div><dt>${h('Cloud service port')}</dt><dd id="wechat-cloud-port">${channel.port}</dd></div><div><dt>${h('Cloud relay')}</dt><dd id="wechat-relay-status">${h('Checking connection…')}</dd></div><div><dt>${h('Last connection check')}</dt><dd id="wechat-last-check">—</dd></div></dl></section><button class="wechat-other-channel" data-action="nav" data-view="${channels[other].view}">${symbol(channels[other].symbol)}<span>${h(other==='kf'?'View customer service messages':'View robot messages')}</span>${icon('arrow')}</button></aside></div><p class="wechat-permission-note">${icon('shield')}${h('Channel messages are for this demonstration workspace. Staff roles and review permissions remain assigned to signed-in accounts.')}</p></div>`;
    $('.wechat-demo').dataset.messageAccess='enabled';
    for(const button of document.querySelectorAll('.wechat-channel-tabs [data-view]'))button.dataset.channelTab=button.dataset.view==='wechat-bot'?'bot':'kf';
    if(!canSimulate(id))$('#wechat-simulate-form')?.remove();
    const inboxActions=document.createElement('div');inboxActions.className='wechat-inbox-actions';
    if(canClear(id))inboxActions.innerHTML=`<button class="btn danger compact" data-wechat-action="clear" aria-label="${h('Clear current channel')}">${icon('trash')}<span>${h('Clear current channel')}</span></button>`;
    inboxActions.appendChild($('[data-wechat-action="refresh"]'));$('.wechat-inbox-head').appendChild(inboxActions);
    state.fingerprints[id]='';paint();
  }
  function paint(){
    if(!active())return;
    if($('#wechat-unavailable')){
      const error=$('#wechat-access-error');if(error){error.hidden=!state.error;error.textContent=t('Account access status unavailable')+' '+t('Please refresh to check this account’s message access.');}
      if(access(channelId()).enabled===null){const failed=state.error||access(channelId()).reason==='unavailable',label=failed?'Account access status unavailable':'Checking account access…';$('#wechat-unavailable h2').textContent=t(label);$('#wechat-unavailable .eyebrow').textContent=t(label);}
      for(const button of document.querySelectorAll('.wechat-channel-tabs [data-view]')){const locked=access(button.dataset.view==='wechat-bot'?'bot':'kf').enabled===false;button.classList.toggle('is-message-unbound',locked);let note=button.querySelector('.wechat-tab-count');if(!locked)note?.remove();else if(!note){note=document.createElement('span');note.className='wechat-tab-count';note.textContent=t('Not linked');button.appendChild(note);}}
      return;
    }
    if(!$('#wechat-messages'))return;
    const id=channelId(),c=info(id),status=connection(id),messages=state.messages[id];
    $('#wechat-connection').className='wechat-connection '+status.className;
    $('#wechat-connection').innerHTML=`<i></i>${h(status.label)}`;
    $('#wechat-real-count').textContent=number(c.real_messages||0);
    $('#wechat-simulation-count').textContent=number(c.simulated_messages||0);
    $('#wechat-last-real').textContent=time(lastReal(id));
    for(const tab of document.querySelectorAll('[data-wechat-count]')){const locked=access(tab.dataset.wechatCount).enabled===false;tab.textContent=locked?t('Not linked'):number(realCount(tab.dataset.wechatCount));tab.closest('button')?.classList.toggle('is-message-unbound',locked);}
    $('#wechat-callback').textContent=typeof c.callback_url==='string'?c.callback_url:'';
    try{$('#wechat-callback-host').textContent=c.callback_url?new URL(c.callback_url).host:'';}catch{$('#wechat-callback-host').textContent='';}
    $('#wechat-cloud-port').textContent=c.cloud_port||channels[id].port;
    $('#wechat-relay-status').textContent=t(state.status?.relay?.configured?'Cloud relay configured':'Cloud relay not configured');
    $('#wechat-last-check').textContent=time(c.last_poll_at||state.checkedAt);
    $('#wechat-path-status').textContent=t(status.label);
    $('#wechat-connection-note').textContent=t(status.note);
    $('#wechat-received-step').classList.toggle('has-real-messages',status.className==='live');
    const error=$('#wechat-error');error.hidden=!state.error;error.textContent=t('Unable to refresh the inbox. Your received messages remain visible.');
    const fingerprint=JSON.stringify(messages);
    if(fingerprint!==state.fingerprints[id]){
      const container=$('#wechat-messages'),nearEnd=container.scrollHeight-container.scrollTop-container.clientHeight<100,empty=!container.querySelector('.wechat-message');
      container.innerHTML=messageList(id);state.fingerprints[id]=fingerprint;
      if(nearEnd||empty)container.scrollTop=container.scrollHeight;
    }
  }
  async function refresh(){
    if(!active()||state.busy)return;
    account();const id=channelId(),user=S.user.id,revision=state.revision;state.busy=true;
    try{
      const status=await api('/api/wechat-demo/status');
      if(!active()||S.user.id!==user||state.revision!==revision||channelId()!==id)return;
      state.status=status;state.error='';state.checkedAt=new Date().toISOString();
      Personnel.updateMessageStatus(status,user);
      if(access(id).enabled!==true){
        state.messages[id]=[];
        const desired=access(id).enabled===false?'disabled':'checking';
        if($('.wechat-demo')?.dataset.messageAccess!==desired)drawUnavailable();else paint();
        return;
      }
      if($('#wechat-unavailable'))draw();
      const inbox=await api('/api/wechat-demo/messages?channel='+id);
      if(!active()||S.user.id!==user||state.revision!==revision||channelId()!==id)return;
      const unique=new Map((inbox.messages||[]).filter(m=>m.channel===id).map(m=>[m.id,m]));
      state.messages[id]=[...unique.values()].sort((a,b)=>String(a.received_at).localeCompare(String(b.received_at))||Number(a.id)-Number(b.id));
      paint();
    }catch(error){if(active()&&S.user.id===user&&state.revision===revision){state.error=error.message;paint();}}
    finally{if(state.revision===revision)state.busy=false;}
  }
  async function clearCurrent(){
    if(!active()||state.clearing||!canClear(channelId()))return;
    if(!window.confirm(t("Clear all messages in this channel? This removes real and simulated messages from your account's local inbox.")))return;
    const id=channelId(),user=S.user.id,revision=state.revision,button=$('[data-wechat-action="clear"]');state.clearing=true;if(button)button.disabled=true;
    try{
      await api('/api/wechat-demo/messages?channel='+id,{method:'DELETE'});
      if(!active()||S.user.id!==user||state.revision!==revision||channelId()!==id)return;
      state.messages[id]=[];state.fingerprints[id]='';await refresh();toast('Channel messages cleared.');
    }catch(error){if(S.user?.id===user)toast(error.message,true);}
    finally{if(state.revision===revision){state.clearing=false;if(active()&&$('[data-wechat-action="clear"]'))$('[data-wechat-action="clear"]').disabled=false;}}
  }
  async function render(){account();state.revision++;state.busy=false;state.sending=false;state.clearing=false;draw();await refresh();}
  document.addEventListener('input',event=>{if(active()&&event.target.id==='wechat-simulate-text')state.drafts[channelId()]=event.target.value;});
  document.addEventListener('click',async event=>{
    if(!active())return;
    if(event.target.closest('[data-wechat-action="clear"]')){event.preventDefault();await clearCurrent();return;}
    if(event.target.closest('[data-wechat-action="refresh"]')){event.preventDefault();await refresh();}
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='wechat-simulate-form')return;event.preventDefault();event.stopImmediatePropagation();
    if(!active()||state.sending||!canSimulate(channelId()))return;
    const id=channelId(),text=state.drafts[id].trim(),user=S.user.id,revision=state.revision;if(!text)return;
    state.sending=true;const button=$('#wechat-simulate-submit');button.disabled=true;button.innerHTML=h('Adding message…');
    try{
      await api('/api/wechat-demo/simulate',{method:'POST',body:{channel:id,text}});
      if(!active()||S.user.id!==user||state.revision!==revision)return;
      state.drafts[id]='';$('#wechat-simulate-text').value='';await refresh();toast('Simulation added. Send a real WeChat message to verify the connection.');
    }catch(error){if(S.user?.id===user)toast(error.message,true);}
    finally{if(state.revision===revision){state.sending=false;if(active()&&$('#wechat-simulate-submit')){$('#wechat-simulate-submit').disabled=false;$('#wechat-simulate-submit').innerHTML=icon('plus')+h('Add simulated message');}}}
  });
  setInterval(()=>{if(active()&&!document.hidden&&!$('#modal').open)refresh();},2400);
  return {render,active,reset(){const revision=state.revision+1;state=fresh();state.revision=revision;}};
})();
