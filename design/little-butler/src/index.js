import {STATES, frameAt, POSES} from './motion.js';
export {STATES, frameAt} from './motion.js';

const DEFAULT_ASSETS=new URL('../assets/poses/',import.meta.url).href;
const icon=body=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS={
  talk:icon('<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>'),
  type:icon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>'),
  actions:icon('<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>'),
  voice:icon('<path d="m11 4-5 4H2v8h4l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'),
  devices:icon('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M8 21h8"/>'),
  hide:icon('<path d="m6 9 6 6 6-6"/>'),
  stop:icon('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  settings:icon('<circle cx="12" cy="12" r="3"/><path d="m10 2-.6 3-2 .9L4.5 5 2 9l2.3 2v2L2 15l2.5 4 2.9-.9 2 .9.6 3h4l.6-3 2-.9 2.9.9 2.5-4-2.3-2v-2L22 9l-2.5-4-2.9.9-2-.9L14 2Z"/>')
};
const ACTIONS=['Save this','Screenshot','Record screen','Remind me','Clipboard','More'];
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Framework independent. No backend actions run without a host event handler. */
export class LittleButler extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._state='peek'; this._start=0; this._loaded=false; this._images={};
    this._voice=false; this._microphone=false; this._quiet=false; this._context=false;this._activityAt=performance.now();
    this._devices=[]; this._selectedDevice=null; this._progress=null; this._destroyed=false;
    this._raf=0; this._idleTimer=0; this._longTimer=0; this._drag=null;
    this._reducedQuery=matchMedia('(prefers-reduced-motion: reduce)');
    this._reduced=this._reducedQuery.matches;
    this._onMotion=e=>{this._reduced=e.matches;};
    this._onVisibility=()=>{
      cancelAnimationFrame(this._raf);
      if(!document.hidden){this._start=performance.now();this._raf=requestAnimationFrame(t=>this._tick(t));}
    };
    this._onResize=()=>this._clampPosition();
    this._onKey=e=>{if(e.key==='Escape'){this._approvalReject?.(); this.hide();}};
  }
  connectedCallback() {
    this._destroyed=false;
    this.setAttribute('role','complementary'); this.setAttribute('aria-label','Little Butler companion');
    this._render();
    this.dock(this.getAttribute('dock')==='left'?'left':'right');
    this._reducedQuery.addEventListener('change',this._onMotion);
    document.addEventListener('visibilitychange',this._onVisibility);
    document.addEventListener('keydown',this._onKey);
    window.addEventListener('resize',this._onResize);
    this.ready=this._load().then(()=>{
      if(this._destroyed)return;
      this._loaded=true; this._start=performance.now();
      this._raf=requestAnimationFrame(t=>this._tick(t));
      this._emit('ready',{});
    }).catch(error=>{
      this.shadowRoot.querySelector('.status').textContent='Mascot assets unavailable';
      this._emit('asseterror',{message:error.message});
      throw error;
    });
    // ready remains awaitable; avoid unhandled rejections for declarative use.
    this.ready.catch(()=>{});
  }
  disconnectedCallback(){
    this._destroyed=true; cancelAnimationFrame(this._raf);clearTimeout(this._idleTimer);clearTimeout(this._longTimer);
    this._approvalReject?.();
    this._reducedQuery.removeEventListener('change',this._onMotion);
    document.removeEventListener('visibilitychange',this._onVisibility);
    document.removeEventListener('keydown',this._onKey);
    window.removeEventListener('resize',this._onResize);
    if(this._utterance) speechSynthesis.cancel();
  }
  async _load(){
    const base=this.getAttribute('assets')||DEFAULT_ASSETS;
    await Promise.all(POSES.map(name=>new Promise((resolve,reject)=>{
      const im=new Image(); im.onload=()=>{this._images[name]=im;resolve();};
      im.onerror=()=>reject(new Error(`Could not load ${name}.png from ${base}`));
      im.src=new URL(`${name}.png`,new URL(base,document.baseURI)).href;
    })));
  }
  _emit(name,detail){this.dispatchEvent(new CustomEvent(`butler:${name}`,{detail,bubbles:true,composed:true}));}
  get state(){return this._state;}
  setState(state,{message,progress}={}){
    if(!STATES[state])throw new RangeError(`Unknown state: ${state}`);
    this._state=state;this._start=performance.now();
    if(!['idle','blink','peek','hide','sleep','quiet'].includes(state))this._activityAt=this._start;
    this._progress=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):null;
    if(message!==undefined)this.say(message);
    const status=this.shadowRoot.querySelector('.status');
    if(status)status.textContent=state==='record'?'Recording':state==='offline'?'Offline':state==='listen'?'Listening':state==='think'?'Thinking':state==='work'?'Working':state==='transfer'?'Transferring':'';
    this.shadowRoot.querySelector('.pet')?.setAttribute('aria-label',`Butler: ${state}. Open controls`);
    this._emit('statechange',{state});
    clearTimeout(this._idleTimer);
    if(state==='idle'&&!this._quiet)this._idleTimer=setTimeout(()=>{
      if(this._state==='idle'&&!this._panelOpen)this.setState('blink');
    },4500+Math.random()*4000);
  }
  _tick(now){
    if(this._destroyed||document.hidden)return;
    if(this._loaded){
      if(this._state==='idle'&&!this._panelOpen&&now-this._activityAt>12000)this.setState('hide');
      const spec=STATES[this._state];const elapsed=now-this._start;
      if(!spec.loop && elapsed>=spec.duration){this.setState(spec.next||'idle');}
      const current=STATES[this._state];const t=((now-this._start)%current.duration)/current.duration;
      const f=frameAt(this._state,t,this._reduced);
      const ctx=this._ctx;ctx.clearRect(0,0,256,320);
      ctx.save();ctx.translate(128+f.x,304+f.y);ctx.rotate(f.rotation*Math.PI/180);ctx.scale(f.sx,f.sy);
      ctx.globalAlpha=f.alpha;ctx.drawImage(this._images[f.pose],-128,-304,256,320);ctx.restore();
      // Status animation conveys real state; progress is host supplied only.
      if(this._state==='record'){
        ctx.fillStyle='#e45656';ctx.beginPath();ctx.arc(210,30,7,0,Math.PI*2);ctx.fill();
      }
      if(this._progress!==null){ctx.fillStyle='#aaa';ctx.fillRect(55,312,146,3);ctx.fillStyle='#5b82b1';ctx.fillRect(55,312,146*this._progress,3);}
    }
    this._raf=requestAnimationFrame(t=>this._tick(t));
  }
  open(){if(this._quiet)this.setQuiet(false);this._showPanel('main');this.setState('summon');}
  hide(){this._approvalReject?.();this._panelOpen=false;this.shadowRoot.querySelector('.panel').hidden=true;this.shadowRoot.querySelector('.message').hidden=true;this.setState(this._quiet?'quiet':'hide');}
  say(text,{speak=this._voice&&!this._quiet}={}){
    this._activityAt=performance.now();
    const node=this.shadowRoot.querySelector('.message');node.textContent=String(text);node.hidden=!text||this._quiet;
    if(speak&&text&&'speechSynthesis'in window){
      speechSynthesis.cancel();
      this._utterance=new SpeechSynthesisUtterance(String(text));this._utterance.rate=.9;this._utterance.pitch=.8;
      this._utterance.onend=()=>{if(this._state==='speak')this.setState('idle');};
      if(['idle','peek','pleased'].includes(this._state))this.setState('speak');
      speechSynthesis.speak(this._utterance);
    }
  }
  stop(){
    if('speechSynthesis'in window)speechSynthesis.cancel();
    this._approvalReject?.();this.setState('idle');this._emit('stop',{});
  }
  setVoice(enabled){this._voice=!!enabled;if(!enabled&&'speechSynthesis'in window){speechSynthesis.cancel();if(this._state==='speak')this.setState('idle');}this._emit('preference',{name:'voice',value:this._voice});}
  setMicrophone(enabled){this._microphone=!!enabled;this._emit('preference',{name:'microphone',value:this._microphone});}
  setQuiet(enabled){this._quiet=!!enabled;this._emit('preference',{name:'quiet',value:this._quiet});if(enabled){if('speechSynthesis'in window)speechSynthesis.cancel();this.hide();}else this.setState('idle');}
  setReducedMotion(enabled){this._reduced=!!enabled;}
  setSize(size){
    if(!['small','medium'].includes(size))throw new RangeError('Size must be small or medium');
    this.setAttribute('size',size);this._clampPosition();this._emit('preference',{name:'size',value:size});
  }
  setDevices(devices){
    this._devices=devices.map(d=>({id:String(d.id),name:String(d.name),online:!!d.online}));
    if(!this._devices.some(d=>d.id===this._selectedDevice&&d.online))this._selectedDevice=this._devices.find(d=>d.online)?.id||null;
    if(this._view==='devices'&&this._panelOpen)this._showPanel('devices');
  }
  dock(side){
    if(!['left','right'].includes(side))throw new RangeError('Dock must be left or right');
    this.style.left=side==='left'?'12px':'auto';this.style.right=side==='right'?'12px':'auto';this.style.bottom='0px';
    this.setAttribute('dock',side);this._emit('dock',{side});
  }
  confirm({title='Confirm action',description='',recipient='',device='',attachment=''}={}){
    this._approvalReject?.();this._panelOpen=true;this._view='confirm';this.setState('attention');
    const panel=this.shadowRoot.querySelector('.panel');panel.hidden=false;
    panel.innerHTML=`<div class="heading">${escapeHTML(title)}</div><p>${escapeHTML(description)}</p>${recipient?`<p>To: ${escapeHTML(recipient)}</p>`:''}${device?`<p>Device: ${escapeHTML(device)}</p>`:''}${attachment?`<p>Attachment: ${escapeHTML(attachment)}</p>`:''}<div class="row"><button data-decision="no">Cancel</button><button class="primary" data-decision="yes">Approve</button></div>`;
    return new Promise(resolve=>{
      const finish=value=>{this._approvalReject=null;this._showPanel('main');this.setState('idle');resolve(value);};
      this._approvalReject=()=>finish(false);
      panel.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>finish(b.dataset.decision==='yes'));
      panel.querySelector('[data-decision="no"]').focus();
    });
  }
  _showPanel(view){
    if(this._approvalReject && view!=='confirm')return;
    this._view=view;this._panelOpen=true;const panel=this.shadowRoot.querySelector('.panel');panel.hidden=false;
    const back='<button class="back" data-view="main">← Back</button>';
    if(view==='main'){
      panel.innerHTML=`<div class="heading">At your service.</div><form><label for="command">What do you need?</label><div class="row"><input id="command" maxlength="2000" autocomplete="off" placeholder="Type a command…"><button type="submit" class="primary" aria-label="Send command">↑</button></div></form><div class="controls">${Object.entries(ICONS).map(([k,v])=>`<button data-control="${k}" title="${k}"><span aria-hidden="true">${v}</span><small>${k==='voice'?(this._voice?'Voice on':'Voice off'):k[0].toUpperCase()+k.slice(1)}</small></button>`).join('')}</div>`;
      panel.querySelector('form').onsubmit=e=>{e.preventDefault();const input=panel.querySelector('input');if(input.value.trim()){this._emit('command',{text:input.value.trim(),deviceId:this._selectedDevice});input.value='';}};
      panel.querySelectorAll('[data-control]').forEach(b=>b.onclick=()=>this._control(b.dataset.control));
    }else if(view==='actions'){
      panel.innerHTML=`${back}<div class="heading">Quick actions</div>${ACTIONS.map((a,i)=>`<button class="action" data-action="${i}">${a}<span>›</span></button>`).join('')}`;
      panel.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>this._emit('action',{action:['save','screenshot','record','remind','clipboard','more'][Number(b.dataset.action)],deviceId:this._selectedDevice}));
    }else if(view==='devices'){
      panel.innerHTML=`${back}<div class="heading">Run on device</div>${this._devices.length?this._devices.map(d=>`<button class="action" data-device="${escapeHTML(d.id)}" ${d.online?'':'disabled'}>${escapeHTML(d.name)}<small>${d.online?(d.id===this._selectedDevice?'Selected':'Online'):'Offline'}</small></button>`).join(''):'<p>Your app has not connected any devices.</p>'}`;
      panel.querySelectorAll('[data-device]').forEach(b=>b.onclick=()=>{this._selectedDevice=b.dataset.device;this._emit('devicechange',{deviceId:this._selectedDevice});this._showPanel('devices');});
    }else if(view==='settings'){
      panel.innerHTML=`${back}<div class="heading">Make yourself comfortable.</div>${[['voice','Speak replies',this._voice],['microphone','Microphone',this._microphone],['quiet','Quiet mode',this._quiet],['reduced','Reduce motion',this._reduced],['context','Screen context',this._context]].map(([k,label,on])=>`<label class="setting">${label}<input type="checkbox" data-setting="${k}" ${on?'checked':''}></label>`).join('')}<p>Microphone and screen access require your app’s permission flow.</p><div class="row"><button data-dock="left">Dock left</button><button data-dock="right">Dock right</button></div><div class="row"><button data-size="small">Small</button><button data-size="medium">Medium</button></div>`;
      panel.querySelectorAll('[data-setting]').forEach(input=>input.onchange=()=>{
        const key=input.dataset.setting;
        if(key==='voice')this.setVoice(input.checked);
        else if(key==='microphone')this.setMicrophone(input.checked);
        else if(key==='quiet')this.setQuiet(input.checked);
        else if(key==='reduced')this.setReducedMotion(input.checked);
        else {const requested=input.checked;input.checked=this._context;this._emit('contextrequest',{enabled:requested});}
      });
      panel.querySelectorAll('[data-dock]').forEach(b=>b.onclick=()=>this.dock(b.dataset.dock));
      panel.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>this.setSize(b.dataset.size));
    }
    panel.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>this._showPanel(b.dataset.view));
  }
  setScreenContext(enabled){this._context=!!enabled;const input=this.shadowRoot.querySelector('[data-setting="context"]');if(input)input.checked=this._context;this._emit('contextchange',{enabled:this._context});}
  _control(key){
    if(['actions','devices','settings'].includes(key))return this._showPanel(key);
    if(key==='hide')return this.hide();if(key==='stop')return this.stop();
    if(key==='voice'){this.setVoice(!this._voice);return this._showPanel('main');}
    if(key==='type')return this.shadowRoot.querySelector('input')?.focus();
    if(key==='talk')this._emit('talkrequest',{microphoneEnabled:this._microphone});
  }
  _clampPosition(){
    const rect=this.getBoundingClientRect();
    if(this.style.left!=='auto'&&this.style.left)this.style.left=`${Math.max(0,Math.min(innerWidth-rect.width,parseFloat(this.style.left)||0))}px`;
    this.style.bottom=`${Math.max(0,Math.min(innerHeight-rect.height,parseFloat(this.style.bottom)||0))}px`;
  }
  _bindPointer(){
    const pet=this.shadowRoot.querySelector('.pet');
    pet.oncontextmenu=e=>{e.preventDefault();if(this._approvalReject)return;this.setState('summon');this._showPanel('actions');};
    pet.onpointerdown=e=>{
      if(e.button!==0||this._approvalReject)return;
      const rect=this.getBoundingClientRect();
      this._drag={x:e.clientX,y:e.clientY,left:rect.left,bottom:innerHeight-rect.bottom,moved:false,long:false,prior:this._state};
      pet.setPointerCapture(e.pointerId);
      this._longTimer=setTimeout(()=>{if(this._drag&&!this._drag.moved){this._drag.long=true;this.setState('summon');this._showPanel('actions');}},500);
    };
    pet.onpointermove=e=>{
      const d=this._drag;if(!d)return;
      const dx=e.clientX-d.x,dy=e.clientY-d.y;
      if(Math.hypot(dx,dy)>7){
        clearTimeout(this._longTimer);
        if(!d.moved){d.moved=true;this.setState('drag');}
        this.style.right='auto';this.style.left=`${d.left+dx}px`;this.style.bottom=`${d.bottom-dy}px`;this._clampPosition();
      }
    };
    pet.onpointerup=e=>{
      clearTimeout(this._longTimer);const d=this._drag;this._drag=null;if(!d)return;
      if(d.moved){
        if(e.clientY-d.y>80&&Math.abs(e.clientX-d.x)<45){this.dock(this.getBoundingClientRect().left<innerWidth/2?'left':'right');this.hide();return;}
        this.dock(this.getBoundingClientRect().left<innerWidth/2?'left':'right');this.setState('idle');
      }else if(!d.long)this._panelOpen?this.hide():this.open();
    };
    pet.onpointercancel=()=>{clearTimeout(this._longTimer);if(this._drag?.moved)this.setState('idle');this._drag=null;};
    pet.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this._panelOpen?this.hide():this.open();}};
  }
  _render(){
    this.shadowRoot.innerHTML=`<style>
      :host{position:fixed;right:12px;bottom:0;z-index:2147483000;display:block;width:88px;height:110px;color:#292a2e;font:14px/1.4 system-ui,sans-serif;--surface:#fcfaf7;--accent:#476b95;--butler-size:88px}
      *{box-sizing:border-box} [hidden]{display:none!important} button,input{font:inherit}button{cursor:pointer;border:1px solid #ddd9d3;background:#fffdf9;border-radius:12px;padding:10px;color:inherit;min-height:44px}button:hover{background:#eeeae3}button:focus-visible,input:focus-visible{outline:3px solid #7195ba;outline-offset:2px}button:disabled{opacity:.42;cursor:not-allowed}
      .pet{width:100%;height:100%;border:0;background:transparent!important;touch-action:none;padding:0;overflow:hidden;display:block}.pet canvas{width:100%;height:100%;display:block;pointer-events:none}.panel{position:absolute;right:0;bottom:116px;width:min(300px,calc(100vw - 24px));max-height:calc(100dvh - 150px);overflow:auto;padding:16px;border:1px solid #e3dfd8;border-radius:20px;background:var(--surface);box-shadow:0 14px 45px #17191c24}
      :host([dock=left]) .panel{left:0;right:auto}.heading{font-weight:650;margin-bottom:12px;font-size:16px}.row{display:flex;gap:8px;align-items:center}.row>*{min-width:0}.row input{flex:1}input:not([type=checkbox]){width:100%;border:1px solid #ddd9d3;border-radius:12px;padding:10px;background:white;color:#292a2e;min-height:44px}label{display:block;margin-bottom:8px;font-size:12px;color:#666}.primary{background:var(--accent);color:white;border-color:var(--accent)}.primary:hover{background:#345579}.controls{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}.controls button{padding:8px 2px;display:grid;gap:4px;place-items:center}.controls span{font-size:20px}.controls small{font-size:10px}.action{display:flex;justify-content:space-between;width:100%;margin:6px 0;text-align:left}.back{border:0;background:transparent;padding:0;min-height:32px}.setting{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#34353a;min-height:38px}.setting input{width:19px;height:19px;accent-color:var(--accent)}p{font-size:12px;color:#69676b;overflow-wrap:anywhere}.message{position:absolute;right:0;bottom:116px;max-width:260px;min-width:120px;padding:10px 14px;background:var(--surface);border-radius:16px;border:1px solid #e3dfd8;box-shadow:0 4px 20px #0001;font-size:12px;overflow-wrap:anywhere;pointer-events:none}.panel:not([hidden])~.message{display:none}.status{position:absolute;bottom:0;right:0;white-space:nowrap;font-size:10px;pointer-events:none;background:#fcfaf7e8;border-radius:5px;padding:0 3px}
      @media(max-width:500px){:host{width:64px;height:80px}.panel{bottom:88px}.message{bottom:88px}}
      :host([size=small]){width:64px;height:80px}:host([size=small]) .panel,:host([size=small]) .message{bottom:88px}:host([size=medium]){width:96px;height:120px}:host([size=medium]) .panel,:host([size=medium]) .message{bottom:128px}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
    </style><button class="pet" aria-label="Butler: peek. Open controls"><canvas width="256" height="320" aria-hidden="true"></canvas></button><section class="panel" aria-label="Butler controls" hidden></section><div class="message" role="status" aria-live="polite" hidden></div><div class="status" role="status" aria-live="polite"></div>`;
    this._ctx=this.shadowRoot.querySelector('canvas').getContext('2d');this._bindPointer();
  }
}
if(!customElements.get('little-butler'))customElements.define('little-butler',LittleButler);
