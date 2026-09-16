/** Runs in the page and returns bounded observations through BB. */
export const deepQuerySource = `const deepQuery=(selector)=>{let roots=[document];const parts=selector.split(/\\s*>>>\\s*/);for(let i=0;i<parts.length;i++){const matches=roots.flatMap(root=>[...root.querySelectorAll(parts[i])]);if(i===parts.length-1)return matches;roots=matches.map(e=>e.shadowRoot).filter(Boolean);}return [];};`;
export const observeExpression = `(() => {
 const selector = (root,e) => {
  if (e.id && root.querySelectorAll('#'+CSS.escape(e.id)).length===1) return '#'+CSS.escape(e.id);
  const parts=[];let n=e;
  while(n && n.nodeType===1){let part=n.localName;const siblings=[...(n.parentNode?.children??[])].filter(s=>s.localName===n.localName);if(siblings.length>1)part+=':nth-of-type('+(siblings.indexOf(n)+1)+')';parts.unshift(part);const candidate=parts.join(' > ');if(root.querySelectorAll(candidate).length===1)return candidate;n=n.parentElement;}return parts.join(' > ');
 };
 const elements=[];let inspected=0;
 function walk(root,prefix=''){
  for(const e of root.querySelectorAll('*')){
   if(++inspected>12000||elements.length>=150)return;
   if(e.shadowRoot)walk(e.shadowRoot,prefix+selector(root,e)+' >>> ');
   const r=e.getBoundingClientRect(),style=getComputedStyle(e);if(r.width<1||r.height<1||style.visibility==='hidden'||style.display==='none')continue;
   if(e.matches('button,a[href],input,select,textarea,[role],[title],[tabindex],[contenteditable],canvas,iframe')||style.cursor==='pointer'){
    elements.push({selector:prefix+selector(root,e),tag:e.localName,role:e.getAttribute('role'),label:(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim().slice(0,160),type:e.getAttribute('type'),...(e.getAttribute('type')==='color'?{color:e.value}:{}),disabled:e.matches(':disabled,[aria-disabled="true"]')||!!e.closest('[inert],[aria-disabled="true"]'),readOnly:!!e.readOnly,rect:{x:r.x,y:r.y,width:r.width,height:r.height},...(e.localName==='iframe'?{src:e.src}:{}),...(e.localName==='canvas'?{canvasWidth:e.width,canvasHeight:e.height}:{})});
   }
  }
 }
 walk(document);
 return {url:location.href,title:document.title,viewport:{width:innerWidth,height:innerHeight,deviceScale:devicePixelRatio},elements,note:'DOM observations supplement accessibility refs. Use element actions for >>> shadow selectors. DOM selectors and rectangles refer to the top page, in CSS pixels. Accessibility refs follow the upstream frame selection. Reinspect after layout changes.'};
})()`;
export function elementExpression(selector: string, action: string = "click") {
  return `(async()=>{${deepQuerySource}
const selector=${JSON.stringify(selector)},action=${JSON.stringify(action)};
const a=deepQuery(selector);if(a.length!==1)throw new Error((a.length===0?'AB_WAIT: ':'')+'Selector must identify one element; matched '+a.length);
const e=a[0];
for(let n=e;n;n=n.parentElement??n.getRootNode()?.host)if(n.matches(':disabled,[aria-disabled="true"],[inert]'))throw new Error('Element is disabled');
const editable=e.isContentEditable||e.localName==='textarea'||(e.localName==='input'&&['text','search','email','url','tel','password','number'].includes(e.type));
if(action==='fill'&&(!editable||e.readOnly))throw new Error('Fill requires a writable text field or contenteditable element');
e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
const before=e.getBoundingClientRect();
await new Promise(resolve=>setTimeout(resolve,32));
if(!e.isConnected||deepQuery(selector).length!==1||deepQuery(selector)[0]!==e)throw new Error('AB_WAIT: Target changed before input');
const r=e.getBoundingClientRect(),style=getComputedStyle(e);
if(r.width<1||r.height<1||style.visibility==='hidden'||style.display==='none')throw new Error('AB_WAIT: Element is not visible');
if(['x','y','width','height'].some(k=>Math.abs(r[k]-before[k])>0.5))throw new Error('AB_WAIT: Target is moving');
const left=Math.max(0,r.x),top=Math.max(0,r.y),right=Math.min(innerWidth,r.x+r.width),bottom=Math.min(innerHeight,r.y+r.height);
if(right<=left||bottom<=top)throw new Error('AB_WAIT: Element is outside the viewport');
const x=(left+right)/2,y=(top+bottom)/2;
let hit=document.elementFromPoint(x,y);while(hit?.shadowRoot){const next=hit.shadowRoot.elementFromPoint(x,y);if(!next||next===hit)break;hit=next;}
let inside=false;for(let n=hit;n;n=n.parentElement??n.getRootNode()?.host){if(n===e){inside=true;break;}}
if(!inside){const cover=hit?'<'+hit.localName+(hit.id?'#'+hit.id:'')+(typeof hit.className==='string'&&hit.className.trim()?'.'+hit.className.trim().split(/\\s+/).slice(0,3).join('.'):'')+'> '+(hit.getAttribute?.('aria-label')||hit.getAttribute?.('title')||hit.innerText||'').trim().replace(/\\s+/g,' ').slice(0,120):'unknown';throw new Error('AB_WAIT: Another element covers this target: '+cover);}
const token='__bbAgentBrowserFillTarget';if(action==='fill')globalThis[token]=e;
return{x,y,tag:e.localName,editable,token};})()`;
}
