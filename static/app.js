'use strict';
const S = {user:null,csrf:'',mode:'demo',demo:null,documents:[],view:'workspace',selected:null,detail:null,tab:'overview',search:'',filter:'all',tenant:'atlas',loginEmail:'',busy:false};
const $ = (q,root=document)=>root.querySelector(q);
const esc = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={check:'m5 12 4 4L19 6',file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',order:'M5 4h14v17H5z M9 4V2h6v2 M8 9h8 M8 13h8 M8 17h5',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',arrow:'m9 5 7 7-7 7',back:'m14 5-7 7 7 7',plus:'M12 5v14 M5 12h14',upload:'M12 16V3 m-5 5 5-5 5 5 M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',download:'M12 3v13 m-5-5 5 5 5-5 M4 17v4h16v-4',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z m-4 9 3 3 5-5',alert:'M10.3 3.6 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0 M12 8v5 M12 17v.1',user:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-2a8 8 0 0 1 16 0v2',logout:'M9 21H4V3h5 M10 12h11 m-4-4 4 4-4 4',close:'m6 6 12 12 M6 18 18 6',trash:'M4 7h16 M9 7V4h6v3 M7 7l1 14h8l1-14 M10 11v6 M14 11v6',external:'M14 3h7v7 M10 14 21 3 M10 3H3v18h18v-7',edit:'m15 3 6 6-12 12H3v-6z M12 6l6 6',refresh:'M21 3v6h-6 M3 21v-6h6 M5 8a8 8 0 0 1 13-3l3 4 M3 15l3 4a8 8 0 0 0 13-3',copy:'M8 8h13v13H8z M16 8V3H3v13h5'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.file}"/></svg>`;
const initials=name=>name.split(' ').map(w=>w[0]).slice(0,2).join('');
const number=value=>value==null?'—':Number(value).toLocaleString(language);
const date=value=>value?new Date(value).toLocaleDateString(language,{month:'short',day:'numeric',year:'numeric'}):'—';
const datetime=value=>value?new Date(value).toLocaleString(language==='en'?'en-GB':language,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
const statuses={UPLOADED:['Queued','gray'],OCR_PROCESSING:['Processing','blue'],OCR_FAILED:['OCR failed','red'],OCR_COMPLETED:['Extracted','blue'],VERIFIED:['Ready to submit','gray'],AWAITING_REVIEW:['Awaiting review','orange'],REVIEW_REJECTED:['Returned','red'],REVIEW_COMPLETED:['Reviewed','green'],REPORT_READY:['Report ready','green']};

const h=(text,values)=>esc(t(text,values));
const documentCount=count=>t(count===1?'{count} document':'{count} documents',{count});
function languageButton(extra=''){
  return `<button class="language-toggle ${extra}" data-action="language" aria-label="${h(language==='en'?'Switch to Simplified Chinese':'Switch to English')}" title="${h(language==='en'?'Switch to Simplified Chinese':'Switch to English')}" lang="${language==='en'?'zh-CN':'en'}">${language==='en'?'中文':'English'}</button>`;
}
function switchLanguage(){
  const modal=S.modal, auditId=$('#audit-document')?.value;
  const drafts=[...document.querySelectorAll('#app input, #app textarea, #app select, #modal input, #modal textarea, #modal select')].filter(el=>el.type!=='file').map(el=>({id:el.id,name:el.name,type:el.type,value:el.value,checked:el.checked,modal:!!el.closest('#modal')}));
  const focused=document.activeElement?.id,scroll=window.scrollY;
  setLanguage(language==='en'?'zh-CN':'en');
  if(auditId)S.auditSelected=auditId;
  if(S.user)renderShell();else renderLogin(S.loginError);
  S.languageSwitch=true;
  try{if(modal==='upload')uploadModal();else if(modal==='reason')reasonModal(S.pending.kind);else if(modal==='switch')switchModal();else if(modal==='wecom-login')Personnel.loginModal().catch(e=>toast(e.message,true));else if(modal?.startsWith('wb-'))Tools.restoreModal();}
  finally{S.languageSwitch=false;}
  for(const draft of drafts){
    const root=draft.modal?$('#modal'):$('#app');
    const el=[...root.querySelectorAll('input, textarea, select')].find(el=>draft.id?el.id===draft.id:el.name===draft.name&&el.type===draft.type&&el.value===draft.value);
    if(el){el.value=draft.value;el.checked=draft.checked;}
  }
  if(focused)document.getElementById(focused)?.focus({preventScroll:true});
  window.scrollTo(0,scroll);
}
function badge(text,color='gray'){return `<span class="badge ${color}"><i class="dot"></i>${esc(t(text))}</span>`;}
function stateBadge(state){const b=statuses[state]||[state,'gray'];return badge(...b);}
function documentBadge(doc){return doc.state==='VERIFIED'&&doc.verification?.result==='NEEDS_CONFIRMATION'?badge(t('Needs confirmation'),'blue'):stateBadge(doc.state);}
function resultBadge(doc){const r=doc.verification?.result;return r==='EXCEPTION'?badge(t('Exception'),'orange'):r==='MATCHED'?badge(t('Matched'),'green'):r==='NEEDS_CONFIRMATION'?badge(t('Confirm fields'),'blue'):`<span class="muted">—</span>`;}
function toast(message,error=false){const el=$('#toast');el.textContent=t(message);el.className=error?'error':'';el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,error?7000:4200);}
function busy(value){S.busy=value;document.querySelectorAll('#modal button, #login-form button, #review-form button, [data-action=wecom-login]').forEach(b=>b.disabled=value||b.hasAttribute('data-locked-disabled'));}
function requestId(){
  const rng=globalThis.crypto;
  if(typeof rng?.randomUUID==='function')return rng.randomUUID();
  // Public HTTP pages can use getRandomValues even when randomUUID is unavailable.
  if(typeof rng?.getRandomValues!=='function')throw new Error('This browser does not support secure random values. Please use a current browser.');
  const bytes=rng.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function api(path,options={}){
  const method=options.method||'GET', headers={...(options.headers||{})};
  if(method!=='GET'&&S.csrf)headers['X-CSRF-Token']=S.csrf;
  let body=options.body;
  if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  if(method!=='GET'&&path!=='/api/auth/login'&&path!=='/api/auth/logout')headers['Idempotency-Key']=options.key||requestId();
  let response;
  for(let attempt=0;attempt<2;attempt++){
    try{response=await fetch(path,{method,headers,body,credentials:'same-origin'});break;}
    catch(error){if(attempt||method==='GET'||path.includes('/auth/'))throw new Error(t('Could not reach the local server. Please try again.'));}
  }
  const data=await response.json();
  if(!response.ok){if(response.status===401&&S.user){S.user=null;S.csrf='';renderLogin();}throw new Error(data.error||t('The request could not be completed.'));}
  return data;
}
function openModal(html){$('#modal-content').innerHTML=html;const modal=$('#modal');if(!modal.open)modal.showModal();}
function closeModal(force=false){if(force||!S.busy){$('#modal').close();S.modal=null;}}
function modalHead(title,subtitle){return `<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${languageButton()}<button class="modal-close" data-action="close-modal" aria-label="${h('Close dialog')}">${icon('close')}</button></div>`;}
function renderLogin(error=''){
  S.loginError=error;
  const accounts=(S.demo?.accounts||[]).filter(a=>a.email.includes(S.tenant==='atlas'?'atlas':'northstar'));
  $('#app').innerHTML=`<main class="login"><section class="login-story"><div class="brand"><img src="/mark.svg" alt=""><span>VERIFY</span></div><div class="story-main"><div class="eyebrow"><i class="dot"></i>${h('DOCUMENT CONTROL, SIMPLIFIED')}</div><h1>${h('Every delivery.')}<br>${h('Every detail.')}<br><span>${h('Verified.')}</span></h1><p>${h('Turn delivery notes into clear decisions, with purchase order checks, human review, and a traceable report.')}</p><div class="story-example"><div class="eyebrow">${h('ONE DELIVERY. A CLEAR ANSWER.')}</div><div class="story-numbers"><div><strong>1,000</strong><span>${h('Ordered units')}</span></div><div><strong>800</strong><span>${h('Remaining units')}</span></div><div><strong>960</strong><span>${h('Delivered units')}</span></div></div><div class="story-result">${icon('alert')}<strong>160</strong><span>${h('units above the remaining quantity.')}<br>${h('Detected before a decision is made.')}</span></div></div></div><div class="story-footer">${icon('shield')}${h('Private documents · Human review · Complete audit trail')}</div></section><section class="login-form-area">${languageButton('login-language')}<div class="login-panel"><div class="eyebrow muted">${h('YOUR VERIFICATION WORKSPACE')}</div><h1>${h('Welcome to Verify')}</h1><p>${h('Select an account, then enter your password to sign in.')}</p><div class="login-tabs"><button data-action="login-tenant" data-value="atlas" class="${S.tenant==='atlas'?'active':''}">${h("Customer")} · Atlas</button><button data-action="login-tenant" data-value="northstar" class="${S.tenant==='northstar'?'active':''}">${h("Supplier")} · Northstar</button></div><div class="demo-roles">${accounts.map(a=>`<button class="demo-role" data-action="select-account" data-email="${esc(a.email)}"><div class="icon-wrap">${icon(a.role==='Operator'?'upload':'shield')}</div><strong>${h(a.business_role||a.role)}</strong><span>${a.role==='Operator'?t('Upload, correct & submit'):t('Review, decide & report')}</span></button>`).join('')}</div>${Personnel.loginEntry()}<div class="login-divider">${h('SIGN IN WITH YOUR ACCOUNT')}</div>${error?`<div class="error-box" role="alert">${h(error)}</div>`:''}<form id="login-form"><div class="form-group"><label class="form-label" for="email">${h('Email address')}</label><input class="input" id="email" name="email" type="email" autocomplete="username" value="${esc(S.loginEmail)}" required></div><div class="form-group"><label class="form-label" for="password">${h('Password')}</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" placeholder="${h('Enter your password')}" required></div><button class="btn primary full" type="submit">${h('Sign in to workspace')} ${icon('arrow')}</button></form><p class="login-note">${S.demo?.shared_demo_password?`${h('Shared demo password:')} <code>${esc(S.demo.shared_demo_password)}</code><br>`:''}${h('Selecting an account only fills the email address. Enter your password to sign in.')}</p></div></section></main>`;
}
async function login(email,password){
  S.loginEmail=email;
  if(!email||!password){renderLogin('Enter your email address and password.');return;}
  busy(true);
  try{const data=await api('/api/auth/login',{method:'POST',body:{email,password}});S.user=data.user;S.csrf=data.csrf;S.mode=data.mode;S.selected=null;S.detail=null;S.view='workspace';S.tab='overview';S.filter='all';S.search='';Tools.reset();Personnel.reset();WechatDemo.reset();closeModal(true);await loadDocuments();renderShell();}
  catch(error){renderLogin(error.message);}
  finally{busy(false);}
}
async function loadDocuments(){const data=await api('/api/documents');S.documents=data.documents;}
function renderShell(){
  const u=S.user;if(!u)return renderLogin();
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><a class="brand" href="#" data-action="nav" data-view="documents"><img src="/mark.svg" alt="Verify"><span class="brand-word">VERIFY</span></a><div class="workspace-label">${h('WORKSPACE')}</div><div class="workspace-name"><div class="org-icon">${u.tenant_id==='atlas'?'AC':'NS'}</div>${esc(u.tenant_name)}</div><nav aria-label="${h('Workspace navigation')}">${Personnel.nav("workspace","My workspace","user")}<button class="nav-item ${S.view==='documents'?'active':''}" data-action="nav" data-view="documents" title="${h('Documents')}">${icon('grid')}<span>${h('Documents')}</span><span class="count">${S.documents.length}</span></button><button class="nav-item ${S.view==='orders'?'active':''}" data-action="nav" data-view="orders" title="${h('Purchase orders')}">${icon('order')}<span>${h('Purchase orders')}</span></button><button class="nav-item ${S.view==='conversion'?'active':''}" data-action="nav" data-view="conversion">${icon('file')}<span>${h('OCR conversion')}</span></button><button class="nav-item ${S.view==='comparison'?'active':''}" data-action="nav" data-view="comparison">${icon('check')}<span>${h('Order comparison')}</span></button>${u.role==='Reviewer'?`<button class="nav-item ${S.view==='audit'?'active':''}" data-action="nav" data-view="audit" title="${h('Audit trail')}">${icon('clock')}<span>${h('Audit trail')}</span></button>`:''}${Personnel.nav("wechat-kf","WeChat customer service","user")}${Personnel.nav("wechat-bot","WeCom robot","grid")}${Personnel.nav("wecom","WeCom employee sign-in","external")}</nav><div class="sidebar-notice">${icon('shield')}<strong>${h('Confidence in every decision.')}</strong><p>${h('Document checks support human review. Your organization’s records stay in your workspace.')}</p></div><div class="sidebar-user"><span class="avatar">${initials(u.name)}</span><div><strong>${esc(u.name)}</strong><small>${h(u.business_role)}</small></div><button class="logout-btn sidebar-switch" data-action="switch-account" title="${h('Switch person')}" aria-label="${h('Switch person')}">${icon('user')}<span>${h('Switch person')}</span></button></div></aside><main class="main"><header class="topbar"><div class="crumb">${h('Workspace')} ${icon('arrow')} <strong>${S.view==='workspace'?t('My workspace'):S.view==='wechat-kf'?t('WeChat customer service'):S.view==='wechat-bot'?t('WeCom robot'):S.view==='wecom'?t('WeCom employee sign-in'):S.view==='conversion'?t('OCR conversion'):S.view==='comparison'?t('Order comparison'):S.view==='orders'?t('Purchase orders'):S.view==='audit'?t('Audit trail'):t('Document verification')}</strong></div><div class="topbar-right">${languageButton()}<span class="demo-pill"><i class="dot"></i>${WechatDemo.active()?t('WeChat message demo'):['conversion','comparison'].includes(S.view)?t('Local document tools'):S.mode==='demo'?t('Demo workspace'):t('Live OCR connected')}</span><span class="topbar-role">${h(u.business_role)}</span><button class="btn ghost compact account-switch" data-action="switch-account" aria-label="${h('Switch person')}">${icon('user')}<span>${h('Switch person')}</span></button><span class="avatar">${initials(u.name)}</span></div></header><div class="main-content" id="content"></div></main></div>`;
  if(WechatDemo.active())WechatDemo.render();else if(['workspace','wecom'].includes(S.view))Personnel.render();else if(['conversion','comparison'].includes(S.view))Tools.render();else if(S.view==='orders')renderOrders();else if(S.view==='audit')renderAuditPage();else if(S.selected&&S.detail)renderDetail();else renderDashboard();
}
function filteredDocuments(){let docs=S.documents;if(S.filter!=='all')docs=docs.filter(d=>S.filter==='exceptions'?d.verification?.result==='EXCEPTION':S.filter==='review'?d.state==='AWAITING_REVIEW':S.filter==='complete'?d.state==='REPORT_READY':d.state==='OCR_FAILED');if(S.search){const q=S.search.toLowerCase();docs=docs.filter(d=>`${d.id} ${d.filename} ${d.fields?.purchase_order||''} ${d.fields?.supplier||''}`.toLowerCase().includes(q));}return docs;}
function rows(){const docs=filteredDocuments();return docs.length?docs.map(d=>`<tr data-action="open-document" data-id="${d.id}"><td><div class="file-cell"><span class="file-icon">${esc(d.mime==='application/pdf'?'PDF':'IMG')}</span><div><button class="text-link file-title" data-action="open-document" data-id="${d.id}">${esc(d.filename)}</button><span class="file-id mono">${d.id}</span></div></div></td><td class="mono">${esc(d.fields?.purchase_order||(['UPLOADED','OCR_PROCESSING'].includes(d.state)?t('Processing…'):'—'))}</td><td class="supplier-col muted">${esc(d.fields?.supplier||'—')}</td><td>${resultBadge(d)}</td><td>${documentBadge(d)}</td><td class="date-col muted">${date(d.created_at)}</td><td><button class="table-arrow" data-action="open-document" data-id="${d.id}" aria-label="${h('Open {filename}',{filename:d.filename})}">${icon('arrow')}</button></td></tr>`).join(''):`<tr><td colspan="7"><div class="empty"><div class="empty-icon">${icon('file')}</div><h3>${S.documents.length?t('No matching documents'):t('Your next delivery starts here')}</h3><p>${S.documents.length?t('Try a different search or status filter.'):t('Upload a delivery note, or try the sample with 960 delivered units to see a quantity exception.')}</p>${!S.documents.length&&S.user.role==='Operator'?`<button class="btn primary" data-action="upload-modal">${h('Try a sample delivery')}</button>`:''}</div></td></tr>`;}
function renderDashboard(){
  const docs=S.documents,awaiting=docs.filter(d=>d.state==='AWAITING_REVIEW').length,exceptions=docs.filter(d=>d.verification?.result==='EXCEPTION').length,complete=docs.filter(d=>d.state==='REPORT_READY').length;
  $('#content').innerHTML=`<div class="page-head"><div><h1>${h('Delivery verification')}</h1><p>${h('A clear view of every delivery, from upload to final review.')}</p></div>${S.user.role==='Operator'?`<button class="btn primary" data-action="upload-modal">${icon('plus')}${h('New document')}</button>`:`<button class="btn primary" data-action="show-review-queue">${icon('shield')}${h('Review queue')} <span>${awaiting}</span></button>`}</div><section class="hero"><div><div class="eyebrow">${h('BUILT FOR A CLEARER WORKFLOW')}</div><h2>${h('Small details. Better decisions.')}</h2><p>${h('Check delivery notes against purchase orders, resolve exceptions, and keep every decision on record.')}</p></div><div class="hero-art" aria-hidden="true"><div class="hero-sheet"><i></i><i></i><i></i><i></i>${icon('file')}</div><div class="hero-check">${icon('check')}</div></div></section><div class="stats">${[[t('My records'),docs.length,t(S.user.role==='Operator'?'Created by me':'Assigned to me'),'file'],[t('Awaiting review'),awaiting,t('Ready for a reviewer decision'),'clock'],[t('Exceptions detected'),exceptions,t('Calculated against purchase orders'),'alert'],[t('Reports ready'),complete,t('Approved and ready to download'),'check']].map(x=>`<div class="stat"><div class="stat-top"><span>${x[0]}</span><span class="stat-icon">${icon(x[3])}</span></div><div class="stat-value">${x[1]}</div><div class="stat-foot">${x[2]}</div></div>`).join('')}</div><section class="panel"><div class="panel-head"><div><h2>${h('Documents')}</h2><p>${h(S.user.role==='Operator'?'My own records and records assigned to my reviewer.':'Only records assigned to me appear in my review workspace.')}</p></div><div class="table-tools"><label class="search">${icon('search')}<input id="document-search" type="search" aria-label="${h('Search documents')}" placeholder="${h('Search documents…')}" value="${esc(S.search)}"></label><select id="document-filter" aria-label="${h('Filter documents')}"><option value="all">${h('All statuses')}</option><option value="review">${h('Awaiting review')}</option><option value="exceptions">${h('Exceptions')}</option><option value="complete">${h('Reports ready')}</option><option value="failed">${h('OCR failed')}</option></select></div></div><div class="table-wrap"><table class="document-table"><thead><tr><th>${h('Document')}</th><th>${h('Purchase order')}</th><th class="supplier-col">${h('Supplier')}</th><th>${h('Verification')}</th><th>${h('Status')}</th><th class="date-col">${h('Uploaded')}</th><th></th></tr></thead><tbody id="document-rows">${rows()}</tbody></table></div><div class="table-footer"><span id="shown-count">${documentCount(filteredDocuments().length)}</span><span>${h('Private to {tenant}',{tenant:S.user.tenant_name})}</span></div></section><div class="bottom-note">${icon('shield')}${h('Document verification only. This workspace does not create inventory postings.')} ${S.mode==='demo'?t('Sample extraction uses labeled demo fixtures.'):''}</div>`;
  $('#document-filter').value=S.filter;
}
function updateRows(){$('#document-rows').innerHTML=rows();$('#shown-count').textContent=documentCount(filteredDocuments().length);}
function unsavedFields(){if(!S.detail||!$('#fields-form'))return false;return [...document.querySelectorAll('[data-field]')].some(el=>{const current=el.dataset.field==='delivered_quantity'?(el.value===''?null:Number(el.value)):el.value;return current!==(S.detail.fields?.[el.dataset.field]??(el.dataset.field==='delivered_quantity'?null:''));});}
async function openDocument(id){S.selected=id;S.tab='overview';try{S.detail=(await api(`/api/documents/${id}`)).document;renderShell();}catch(e){toast(e.message,true);}}
function steps(d){const state=d.state;const extracted=!['UPLOADED','OCR_PROCESSING','OCR_FAILED'].includes(state),submitted=['AWAITING_REVIEW','REVIEW_COMPLETED','REPORT_READY','REVIEW_REJECTED'].includes(state),reviewed=['REPORT_READY','REVIEW_REJECTED','REVIEW_COMPLETED'].includes(state);return `<div class="steps">${[[t('Received'),true],[t('Extracted'),extracted],[t('Submitted'),submitted],[t('Reviewed'),reviewed]].map((x,i)=>`<div class="step ${x[1]?'done':i===1&&!extracted||i===2&&extracted&&!submitted||i===3&&submitted&&!reviewed?'active':''}"><span class="step-number">${x[1]?icon('check'):i+1}</span>${x[0]}</div>`).join('')}</div>`;}
function verificationCard(d){
  const v=d.verification||{},o=v.order,q=d.fields?.delivered_quantity,excess=v.issues?.find(i=>i.code==='QUANTITY_EXCEEDED');
  return `<section class="panel"><div class="panel-head"><h2>${h('Purchase order verification')}</h2>${resultBadge(d)}</div><div class="card-body">${o?`<div class="quantity-row"><div><span>${h('Ordered')}</span><strong>${number(o.ordered)}</strong></div><div><span>${h('Remaining')}</span><strong>${number(o.remaining)}</strong></div><div class="${excess?'excess':''}"><span>${h('Delivered')}</span><strong>${number(q)}</strong></div></div><div class="meter-label"><span>${h('{count} units previously received',{count:number(o.received)})}</span><span>${q==null?t('Awaiting quantity'):h('{quantity} / {remaining} remaining',{quantity:number(q),remaining:number(o.remaining)})}</span></div><meter class="quantity-meter" min="0" max="${o.ordered}" value="${Math.min(o.ordered,(o.received||0)+(q||0))}" aria-label="${h('Previously received and delivered quantity')}"></meter>`:`<p class="small muted">${v.result?t('No matching purchase order is available.'):t('Verification will appear after extraction.')}</p>`}${v.issues?.length?`<div class="issue-list">${v.issues.map(i=>`<div class="issue">${icon('alert')}<div><strong>${esc(issueCopy(i).title)}</strong><p>${esc(issueCopy(i).detail)}</p><code>${esc(i.code)}</code></div></div>`).join('')}</div>`:v.result==='MATCHED'?`<div class="confirmation">${icon('check')}${h('All required fields match the purchase order.')}</div>`:''}</div></section>`;
}
function fieldsCard(d){
  const editable=S.user.role==='Operator'&&['VERIFIED','REVIEW_REJECTED'].includes(d.state),f=d.fields||{},x=d.extraction||{};
  return `<section class="panel"><div class="panel-head"><div><h2>${h('Delivery note fields')}</h2><p>${x.confirmed_by?h('Confirmed by {name}',{name:x.confirmed_by}):t('Extracted information for operator confirmation')}</p></div><span class="confidence">${x.confidence!=null?h('{count}% confidence',{count:Math.round(x.confidence*100)}):''}</span></div><div class="card-body"><div class="form-grid field-form" id="fields-form">${[['purchase_order',t('Purchase order'),'text'],['supplier',t('Supplier'),'text'],['part_number',t('Part number'),'text'],['delivered_quantity',t('Delivered quantity'),'number']].map(([key,label,type])=>`<div class="form-group"><label class="form-label" for="field-${key}">${label}</label><input class="input" id="field-${key}" data-field="${key}" type="${type}" ${type==='number'?'min="1" max="1000000000" step="1"':'maxlength="180"'} value="${esc(f[key]??'')}" ${editable?'':'disabled'} placeholder="${type==='number'?t('Enter quantity'):t('Enter '+fieldLabels[key].toLowerCase())}"></div>`).join('')}</div><p class="field-help">${h(x.note||t('Your file is saved privately. Extraction has not completed yet.'))}</p>${editable?`<div class="field-actions"><button class="btn" data-action="save-fields">${icon('edit')}${x.needs_confirmation?t('Confirm fields'):t('Save corrections')}</button>${d.verification?.can_submit?`<button class="btn primary" data-action="submit-review">${h('Submit for review')} ${icon('arrow')}</button>`:''}</div>${x.needs_confirmation?`<p class="small muted">${h('Confirm the values above to resolve the extraction uncertainty.')}</p>`:''}`:d.state==='AWAITING_REVIEW'?`<div class="confirmation">${icon('shield')}${h('Fields are locked while a reviewer considers this document.')}</div>`:d.state==='REPORT_READY'?`<div class="confirmation">${icon('shield')}${h('Reviewed data is locked. Corrections require a new review.')}</div>`:''}</div></section>`;
}
function reviewCard(d){
  const reviewer=S.user.role==='Reviewer',review=d.review;
  if(d.state==='AWAITING_REVIEW'&&reviewer)return `<section class="panel"><div class="panel-head"><h2>${h('Make a review decision')}</h2>${badge(t('Reviewer'),'green')}</div><div class="card-body"><p class="small muted">${h('Review the original file, confirmed fields, and exception evidence before deciding.')}</p><form id="review-form"><div class="review-choice"><label><input type="radio" name="decision" value="approve" checked>${h('Approve verification')}</label><label><input type="radio" name="decision" value="reject">${h('Return to operator')}</label></div><div class="form-group"><label class="form-label" for="review-reason">${h('Review comments')} <span class="muted">${h('(required)')}</span></label><textarea class="input" id="review-reason" name="reason" minlength="5" maxlength="2000" required placeholder="${h('Explain your decision and how any exceptions were assessed.')}"></textarea></div><button class="btn primary full" type="submit">${icon('shield')}${h('Submit review decision')}</button></form><p class="modal-note">${h('Approving records your decision and generates the English report. Returning allows the operator to correct and resubmit.')}</p></div></section>`;
  if(review)return `<section class="panel"><div class="panel-head"><h2>${h('Review decision')}</h2>${badge(review.decision==='approve'?t('Approved'):t('Returned'),review.decision==='approve'?'green':'red')}</div><div class="card-body"><div class="review-detail"><span class="avatar">${initials(review.reviewer)}</span><div><strong>${esc(review.reviewer)}</strong><span>${datetime(review.at)}</span></div></div><p class="quote">${esc(review.reason)}</p>${d.has_report?`<div class="report-box">${icon('file')}<div><strong>${h('English verification report')}</strong><p>${h('Generated from the approved data snapshot.')}</p></div></div><a class="btn primary full" href="/api/documents/${d.id}/report">${icon('download')}${h('Download PDF report')}</a>`:''}${reviewer&&d.state==='REPORT_READY'?`<div class="divider"></div><button class="btn ghost full" data-action="return-correction">${icon('refresh')}${h('Return for correction & new review')}</button>`:''}</div></section>`;
  return `<section class="panel"><div class="panel-head"><h2>${h('Human review')}</h2></div><div class="card-body waiting">${icon('shield')}<h3>${d.state==='AWAITING_REVIEW'?t('Ready for a reviewer'):t('Review comes next')}</h3><p>${d.state==='AWAITING_REVIEW'?t('Switch to a Reviewer account to inspect the evidence and record a decision.'):t('An operator must confirm the fields and submit the document before a reviewer can make a decision.')}</p>${d.state==='AWAITING_REVIEW'?`<div class="field-actions"><button class="btn full" data-action="switch-account">${h('Switch to Reviewer')}</button></div>`:''}</div></section>`;
}
function renderDetail(){
  const d=S.detail;if(!d)return;const v=d.verification||{},excess=v.issues?.find(i=>i.code==='QUANTITY_EXCEEDED');
  $('#content').innerHTML=`<button class="back" data-action="back-documents">${icon('back')}${h('All documents')}</button><div class="detail-heading"><div class="detail-title"><h1>${esc(d.filename)}</h1>${documentBadge(d)}</div><div class="detail-meta"><span class="mono">${d.id}</span><span>${h('Uploaded {time}',{time:datetime(d.created_at)})}</span><span>${h('Version {version}',{version:d.version})}</span></div></div><div class="detail-tabs"><button class="${S.tab==='overview'?'active':''}" data-action="detail-tab" data-tab="overview">${h('Overview & verification')}</button>${S.user.role==='Reviewer'?`<button class="${S.tab==='audit'?'active':''}" data-action="detail-tab" data-tab="audit">${h('Audit trail')}</button>`:''}</div><div id="detail-body">${S.tab==='audit'?`<div class="panel loading"><span class="spinner"></span>${h('Loading the audit trail…')}</div>`:`${steps(d)}${d.state==='OCR_FAILED'?`<div class="notice red">${icon('alert')}<div><strong>${h('OCR processing failed')}</strong><p>${h(d.error)}</p>${S.user.role==='Operator'?`<button class="btn compact" data-action="retry-ocr">${icon('refresh')}${h('Retry failed task')}</button>`:''}</div></div>`:['UPLOADED','OCR_PROCESSING'].includes(d.state)?`<div class="notice green"><span class="spinner"></span><div><strong>${h('Processing your delivery note')}</strong><p>${h('Your original file is saved. This page updates automatically as extraction finishes.')}</p></div></div>`:excess?`<div class="notice">${icon('alert')}<div><strong>${h('Quantity Discrepancy Detected · {count} extra units',{count:number(excess.evidence.excess)})}</strong><p>${esc(issueCopy(excess).detail)}</p></div></div>`:v.result==='MATCHED'?`<div class="notice green">${icon('check')}<div><strong>${h('Purchase order matched')}</strong><p>${h('Required fields are complete and the delivered quantity is within the remaining order quantity.')}</p></div></div>`:''}<div class="detail-grid"><div class="stack">${fieldsCard(d)}<section class="panel"><div class="panel-head"><h2>${h('Original delivery note')}</h2><a class="btn ghost compact" href="/api/documents/${d.id}/original" target="_blank" rel="noopener">${h('Open original')} ${icon('external')}</a></div><div class="preview">${d.mime==='application/pdf'?`<iframe src="/api/documents/${d.id}/original#toolbar=0&navpanes=0" title="${h('Original delivery note PDF')}"></iframe>`:`<img src="/api/documents/${d.id}/original" alt="${h('Original delivery note')}">`}</div><div class="original-toolbar"><span>${esc(d.mime==='application/pdf'?t('PDF document'):t('Image document'))}</span><span>${h('Private original · Unchanged')}</span></div></section></div><div class="stack">${verificationCard(d)}${reviewCard(d)}<section class="panel"><div class="panel-head"><h2>${h('Document integrity')}</h2>${icon('shield')}</div><div class="card-body"><label class="form-label">${h('Original file SHA-256')}</label><div class="hash mono">${d.sha256}</div><p class="modal-note">${h('Every field change, rule check, and review decision is recorded.')} ${S.user.role==='Reviewer'?t('Open the audit trail to inspect the history.'):t('Audit history is available to the Reviewer role.')}</p></div></section></div></div>`}</div>`;
  if(S.tab==='audit')loadAudit(d.id,'#detail-body');
}
async function renderOrders(){
  $('#content').innerHTML=`<div class="loading">${h('Loading purchase orders…')}</div>`;
  try{const {orders}=await api('/api/orders');if(S.view!=='orders')return;$('#content').innerHTML=`<div class="page-head"><div><h1>${h('Purchase orders')}</h1><p>${h('The fixed order register used to verify delivery notes.')}</p></div>${badge(t('Demo order register'),'green')}</div><div class="order-grid">${orders.map(o=>`<section class="panel order-card"><div class="eyebrow">${h('PURCHASE ORDER')}</div><h2>${esc(o.po)}</h2><p class="muted small">${esc(o.supplier)}</p><div class="quantity-row"><div><span>${h('Ordered')}</span><strong>${number(o.ordered)}</strong></div><div><span>${h('Previously received')}</span><strong>${number(o.received)}</strong></div><div><span>${h('Remaining')}</span><strong>${number(o.remaining)}</strong></div></div><div class="order-meta"><span>${h('Part')} <strong>${esc(o.part)}</strong></span><span>${esc(S.user.tenant_name)}</span></div></section>`).join('')}</div><div class="bottom-note">${icon('shield')}${h('Historical received quantities are fixed demo data. Verification and approval do not change inventory.')}</div>`;}catch(e){toast(e.message,true);}
}
function renderAuditPage(){
  $('#content').innerHTML=`<div class="page-head"><div><h1>${h('Audit trail')}</h1><p>${h('Follow the complete record of each document and decision.')}</p></div>${badge(t('Append-only records'),'green')}</div><section class="panel"><div class="review-selector"><label class="form-label" for="audit-document">${h('Select a document')}</label><select class="input" id="audit-document">${S.documents.map(d=>`<option value="${d.id}">${esc(d.filename)} · ${d.id}</option>`).join('')}</select></div><div id="audit-content">${S.documents.length?`<div class="loading">${h('Loading history…')}</div>`:`<div class="empty"><h3>${h('No documents to trace yet')}</h3><p>${h('Upload a document as an Operator to begin the workflow.')}</p></div>`}</div></section>`;
  if(S.documents.length){const selected=S.documents.some(d=>d.id===S.auditSelected)?S.auditSelected:S.documents[0].id;$('#audit-document').value=selected;loadAudit(selected,'#audit-content');}
}
const eventLabels={DOCUMENT_UPLOADED:'Original document saved',STATE_CHANGED:'Processing state changed',OCR_COMPLETED:'Extraction completed',OCR_FAILED:'OCR processing failed',RULES_VERIFIED:'Purchase order checks completed',FIELDS_REVISED:'Delivery fields corrected',FIELDS_CONFIRMED:'Delivery fields confirmed',SUBMITTED_FOR_REVIEW:'Submitted for human review',REVIEW_DECIDED:'Reviewer decision recorded',REPORT_GENERATED:'English PDF report generated',REPORT_DOWNLOADED:'Report downloaded',RETURNED_FOR_CORRECTION:'Returned for correction and new review',RETRY_REQUESTED:'OCR retry requested',TASK_RECOVERED:'Interrupted task recovered'};
function auditDetails(event){const d=event.details;if(event.action==='STATE_CHANGED')return `${h(statuses[d.from]?.[0]||d.from)} → ${h(statuses[d.to]?.[0]||d.to)}${d.reason?`<br>`+h(d.reason):''}`;if(event.action==='FIELDS_REVISED'||event.action==='FIELDS_CONFIRMED')return `<div>${esc(d.reason)}</div><div class="audit-values">${[[t('BEFORE'),d.before],[t('AFTER'),d.after]].map(([label,fields])=>`<div><strong>${esc(label)}</strong>${Object.entries(fields||{}).map(([k,v])=>`${h(fieldLabels[k]||k.replaceAll('_',' '))}: ${esc(v??t('Not available'))}`).join(`<br>`)}</div>`).join('')}</div>`;if(event.action==='REVIEW_DECIDED')return `${h(d.review?.decision?.toUpperCase())} · ${esc(d.review?.reviewer)}<br>${esc(d.review?.reason)}`;if(event.action==='RULES_VERIFIED')return `${h(d.result)}${d.issues?.length?`<br>`+d.issues.map(i=>esc(issueCopy(i).detail)).join(`<br>`):''}`;if(event.action==='OCR_COMPLETED')return `${h(d.source)} · ${h('{count}% confidence',{count:Math.round((d.confidence||0)*100)})}`;if(d.reason)return esc(d.reason);if(d.sha256)return `SHA-256 <span class="hash mono">${esc(d.sha256)}</span>`;if(d.attempt)return h('Attempt {count}',{count:d.attempt});return '';
}
async function loadAudit(id,target){
  try{const {events}=await api(`/api/documents/${id}/audit`);const node=$(target);if(!node)return;node.innerHTML=`<div class="audit-list">${events.map(e=>`<article class="audit-event"><span class="audit-dot">${icon(e.action.includes('REPORT')?'file':e.action.includes('REVIEW')?'shield':e.action.includes('REVISED')?'edit':'check')}</span><div class="audit-title"><span>${h(eventLabels[e.action]||e.action)}</span><span class="audit-date">${datetime(e.at)}</span></div><div class="audit-actor">${esc(e.actor_name==='Document processing service'?t(e.actor_name):e.actor_name)} · ${h('Event #{id}',{id:e.id})}</div><div class="audit-detail">${auditDetails(e)}</div></article>`).join('')}</div>`;}catch(e){const node=$(target);if(node)node.innerHTML=`<div class="empty"><p>${h(e.message)}</p></div>`;}
}
function uploadModal(){
  S.modal='upload';
  const samples=S.demo?.samples||[];
  openModal(`${modalHead(t('New delivery note'),t('Upload a document or explore a ready-to-use sample.'))}<div class="modal-body"><label class="dropzone" id="dropzone" for="upload-file">${icon('upload')}<strong>${h('Choose a file or drop it here')}</strong><p>${h('PDF, PNG, or JPEG · Up to 10 MB')}</p><input id="upload-file" type="file" accept=".pdf,.png,.jpg,.jpeg"></label><div class="sample-label">${h('EXPLORE THE WORKFLOW WITH A SAMPLE')}</div><div class="sample-list">${samples.map(s=>`<div class="sample-item"><div class="file-cell"><div class="file-icon">PDF</div><div><strong>${h(s.label)}</strong><span>${h(s.description)}</span></div></div><button class="btn compact" data-action="upload-sample" data-filename="${esc(s.filename)}">${h('Use sample')} ${icon('arrow')}</button></div>`).join('')}</div><p class="modal-note">${S.mode==='demo'?t('Demo mode reproduces extraction only for these predefined sample files. Other uploads are saved and require manual field entry. Live OCR is not configured.'):t('The configured OCR service processes uploads on the server. Confirm its supported formats before uploading.')}</p></div>`);
}
async function upload(file){
  if(!file)return;if(file.size>10*1024*1024)return toast(t('Choose a file no larger than 10 MB.'),true);
  busy(true);
  try{const form=new FormData();form.append('file',file,file.name);const data=await api('/api/documents',{method:'POST',body:form});closeModal(true);await loadDocuments();await openDocument(data.document.id);toast(t('Document saved. Extraction is being processed.'));}
  catch(e){toast(e.message,true);}finally{busy(false);}
}
function reasonModal(kind){
  S.modal='reason';
  const doc=S.detail;if(!doc)return;
  let fields=null;
  if(kind==='fields'&&!S.languageSwitch){fields={};document.querySelectorAll('[data-field]').forEach(el=>fields[el.dataset.field]=el.dataset.field==='delivered_quantity'?(el.value===''?null:Number(el.value)):el.value);}
  if(!S.languageSwitch)S.pending={kind,fields,id:doc.id,version:doc.version};
  openModal(`${modalHead(kind==='fields'?t('Record your correction'):t('Return for correction'),kind==='fields'?t('Changes and the reason are saved in the audit trail.'):t('The current report will be withdrawn until a new review is completed.'))}<form class="modal-body" id="reason-form"><label class="form-label" for="change-reason">${kind==='fields'?t('Reason for correction or confirmation'):t('Reason for returning this document')}</label><textarea id="change-reason" class="input" name="reason" minlength="5" maxlength="2000" placeholder="${h('Explain why the fields are being corrected or confirmed.')}" required></textarea><p class="modal-note">${kind==='fields'?t('Your confirmed fields will be checked against the purchase order again.'):t('Previous review decisions and report evidence remain in the audit history.')}</p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">${h('Cancel')}</button><button class="btn primary" type="submit">${kind==='fields'?t('Save & verify'):t('Return for correction')}</button></div></form>`);
  $('#change-reason').focus();
}
async function mutate(action,body={},method='POST'){
  if(S.busy)return;busy(true);
  try{const data=await api(`/api/documents/${S.detail.id}/${action}`,{method,body:{version:S.detail.version,...body}});S.detail=data.document;await loadDocuments();closeModal(true);renderShell();toast(action==='review'?t('Review decision saved.'):action==='submit'?t('Submitted to the reviewer.'):action==='retry'?t('A new OCR attempt has been queued.'):t('Document updated.'));}
  catch(e){toast(e.message,true);}finally{busy(false);}
}
function clearSession(){
  S.user=null;S.csrf='';S.documents=[];S.selected=null;S.detail=null;S.pending=null;S.view='workspace';S.search='';S.filter='all';
  Tools.reset();Personnel.reset();WechatDemo.reset();closeModal(true);
}
function showAccountLogin(email=''){
  if(S.user)return;
  const account=(S.demo?.accounts||[]).find(a=>a.email===email);
  if(account)S.tenant=account.tenant_id||((account.email||'').includes('@northstar.')?'northstar':'atlas');
  S.loginEmail=email;closeModal(true);renderLogin();
  const password=$('#password');if(password)password.value='';
  (email?password:$('#email'))?.focus();
}
async function switchPerson(email){
  if(!S.user||S.busy)return;
  busy(true);
  try{
    const data=await api('/api/auth/switch',{method:'POST',body:{email}});
    S.user=data.user;S.csrf=data.csrf;S.mode=data.mode;S.documents=[];S.selected=null;S.detail=null;S.pending=null;S.view='workspace';S.tab='overview';S.filter='all';S.search='';
    Tools.reset();Personnel.reset();WechatDemo.reset();closeModal(true);await loadDocuments();renderShell();
  }finally{busy(false);}
}
async function signOut(){
  busy(true);
  try{await api('/api/auth/logout',{method:'POST'});clearSession();S.loginEmail='';renderLogin();}
  finally{busy(false);}
}
function switchModal(){
  S.modal='switch';
  openModal(`${modalHead(t('Switch person'),t('Select a person to switch within this signed-in workspace.'))}<div class="modal-body"><div class="sample-list">${(S.demo?.accounts||[]).map(a=>`<button class="sample-item full" data-action="switch-person" data-email="${esc(a.email)}"><div class="file-cell"><span class="avatar">${initials(a.name)}</span><div><strong>${esc(a.name)} · ${h(a.business_role||a.role)}</strong><span>${esc(a.tenant)}</span></div></div>${icon('arrow')}</button>`).join('')}</div><div class="divider"></div><button class="btn ghost full" data-action="logout">${icon('logout')}${h('Sign out')}</button></div>`);
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el)return;event.preventDefault();if(S.busy)return;
  const action=el.dataset.action;
  try{
    if(action==='close-modal')closeModal();
    else if(action==='language')switchLanguage();
    else if(action==='wecom-login')await Personnel.loginModal();
    else if(action==='login-tenant'){S.tenant=el.dataset.value;S.loginEmail='';renderLogin();}
    else if(action==='select-account')showAccountLogin(el.dataset.email);
    else if(action==='switch-person')await switchPerson(el.dataset.email);
    else if(action==='nav'){S.view=el.dataset.view;S.selected=null;S.detail=null;renderShell();}
    else if(action==='open-document')await openDocument(el.dataset.id);
    else if(action==='back-documents'){S.selected=null;S.detail=null;S.view='documents';await loadDocuments();renderShell();}
    else if(action==='upload-modal')uploadModal();
    else if(action==='upload-sample'){const file=await fetch(`/samples/${encodeURIComponent(el.dataset.filename)}`);if(!file.ok)throw new Error(t('The sample could not be opened.'));await upload(new File([await file.blob()],el.dataset.filename,{type:'application/pdf'}));}
    else if(action==='save-fields')reasonModal('fields');
    else if(action==='return-correction')reasonModal('return');
    else if(action==='submit-review'){if(unsavedFields())return toast(t('Save your field corrections before submitting for review.'),true);await mutate('submit');}
    else if(action==='retry-ocr')await mutate('retry');
    else if(action==='detail-tab'){S.tab=el.dataset.tab;renderDetail();}
    else if(action==='switch-account')switchModal();
    else if(action==='show-review-queue'){S.filter='review';S.selected=null;S.detail=null;renderDashboard();}
    else if(action==='logout')await signOut();
    else if(action==='reload')location.reload();
  }catch(e){toast(e.message,true);}
});
document.addEventListener('submit',async event=>{
  event.preventDefault();if(S.busy)return;
  const form=event.target;
  if(form.id==='login-form')await login(form.email.value,form.password.value);
  else if(form.id==='review-form')await mutate('review',{decision:new FormData(form).get('decision'),reason:form.reason.value});
  else if(form.id==='reason-form'){
    const pending=S.pending;if(!pending)return;
    await mutate(pending.kind==='fields'?'fields':'return',{version:pending.version,reason:form.reason.value,...(pending.kind==='fields'?{fields:pending.fields}:{})},pending.kind==='fields'?'PATCH':'POST');
  }
});
document.addEventListener('input',event=>{if(event.target.id==='email')S.loginEmail=event.target.value;else if(event.target.id==='document-search'){S.search=event.target.value;updateRows();}});
document.addEventListener('change',event=>{if(event.target.id==='document-filter'){S.filter=event.target.value;updateRows();}else if(event.target.id==='upload-file')upload(event.target.files[0]);else if(event.target.id==='audit-document'){S.auditSelected=event.target.value;loadAudit(event.target.value,'#audit-content');}});
document.addEventListener('dragover',event=>{if(event.target.closest('#dropzone')){event.preventDefault();$('#dropzone').classList.add('drag');}});
document.addEventListener('dragleave',event=>{if(event.target.closest('#dropzone'))$('#dropzone')?.classList.remove('drag');});
document.addEventListener('drop',event=>{if(event.target.closest('#dropzone')){event.preventDefault();$('#dropzone').classList.remove('drag');upload(event.dataTransfer.files[0]);}});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal'))closeModal();});
$('#modal').addEventListener('close',()=>{S.modal=null;});
$('#modal').addEventListener('cancel',event=>{if(S.busy)event.preventDefault();});
function employeeSigninError(){
  const url=new URL(location.href),reason=url.searchParams.get('employee_signin');
  if(reason===null)return '';
  const messages={
    disabled:'Employee sign-in is disabled. Use your account to continue.',
    unconfigured:'Employee sign-in is not configured for this company. Use your account to continue.',
    https_required:'Open the configured HTTPS application homepage in WeCom to sign in.',
    invalid_state:'Employee sign-in expired or could not be verified. Please start again.',
    unbound:'Your WeCom identity has no assigned employee account. Contact your administrator or use your account to continue.',
    service_unavailable:'The employee identity service is unavailable. Please try again or use your account.',
    signin_failed:'Employee sign-in did not complete. Please try again or use your account.'
  };
  url.searchParams.delete('employee_signin');history.replaceState(history.state,'',url.href);
  return Object.hasOwn(messages,reason)?messages[reason]:messages.signin_failed;
}
async function init(){
  const signinError=employeeSigninError();
  try{S.demo=await api('/api/demo');S.mode=S.demo.mode;try{const data=await api('/api/auth/me');S.user=data.user;S.csrf=data.csrf;S.mode=data.mode;S.view='workspace';await loadDocuments();renderShell();if(signinError)toast(signinError,true);}catch(e){renderLogin(signinError);}}
  catch(e){$('#app').innerHTML=`<div class="boot"><img src="/mark.svg" alt=""><p>${esc(e.message)}</p><button class="btn" data-action="reload">${h('Refresh this page')}</button></div>`;}
}
setInterval(async()=>{
  if(WechatDemo.active()||Tools.active()||!S.user||S.busy||document.hidden||$('#modal').open||unsavedFields()||document.activeElement?.closest('.field-form')||document.activeElement?.closest('#review-form'))return;
  try{
    if(S.selected&&S.detail){const next=(await api(`/api/documents/${S.selected}`)).document;if(next.version!==S.detail.version){S.detail=next;await loadDocuments();if(S.tab==='overview')renderDetail();}}
    else if(S.view==='documents'&&document.activeElement?.id!=='document-search'){const old=JSON.stringify(S.documents.map(d=>[d.id,d.version]));await loadDocuments();if(old!==JSON.stringify(S.documents.map(d=>[d.id,d.version])))renderDashboard();}
  }catch(e){if(S.user)toast(e.message,true);}
},2500);
init();
