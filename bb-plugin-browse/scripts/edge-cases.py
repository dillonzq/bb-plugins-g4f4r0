"""Repeatable integration checks in an explicitly owned BB test tab; never real account forms."""
import json, subprocess, time, argparse, statistics
from pathlib import Path


def call(m, v):
    r = subprocess.run(['bb','browse',m,json.dumps(v)],capture_output=True,text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return json.loads(r.stdout)

fixture = '''<!doctype html><title>Browse Stagehand edge cases</title><style>body{font:16px system-ui;margin:24px}input,button,textarea,[contenteditable]{margin:6px;padding:8px}#cover{position:fixed;inset:0;background:#eee;z-index:999;display:none}#wide{width:2500px}#moving{position:relative}#bottom{margin-top:1400px}</style>
<h1>Browse Stagehand edge cases</h1><input id="text" value="old"><textarea id="area">old</textarea><div id="edit" contenteditable="true">old</div><input id="readonly" readonly value="unchanged"><fieldset disabled><input id="fieldset" value="unchanged"></fieldset><button id="disabled" aria-disabled="true" onclick="window.bad++">Disabled</button><button id="counter" onclick="window.count++">Count</button><button class="duplicate">One</button><button class="duplicate">Two</button><button id="moving" onclick="window.moves++">Moving</button><div id="cover">Temporary overlay</div><custom-app></custom-app><iframe id="frame" srcdoc="<input id='inside' value='old'>"></iframe><input id="file" type="file"><a id="download">Download</a><button id="bottom" onclick="window.bottoms++">Below fold</button><canvas id="canvas" width="200" height="100"></canvas>'''
setup = '''window.lateClicks=0;window.wideClicks=0;window.batchCount=0;window.count=0;window.bad=0;window.moves=0;window.bottoms=0;const root=document.querySelector('custom-app').attachShadow({mode:'open'});root.innerHTML='<input id="shadow" value="old"><button id="shadowButton">Shadow</button>';document.querySelector('#download').href=URL.createObjectURL(new Blob(['edge download ✓\\n'],{type:'text/plain'}));document.querySelector('#canvas').getContext('2d').fillRect(10,10,20,20);true'''

class Suite:
    def __init__(self,session): self.s=session;self.rows=[]
    def action(self,name,op,expected='succeeded'):
        start=time.monotonic();j=call('run',{'id':self.s['id'],'operation':op})
        while j['status']=='running':
            time.sleep(.15);j=call('job',{'hostId':self.s['hostId'],'id':j['id']})
        row={'name':name,'wallMs':round((time.monotonic()-start)*1000),'expected':expected,**{k:j.get(k) for k in ['status','durationMs','output','error']}}
        row['pass']=j['status']==expected;self.rows.append(row);print(json.dumps(row),flush=True);return j
    def js(self,name,expression): return self.action(name,{'kind':'command','args':['eval',f'(()=>eval({json.dumps(expression)}))()']})
    def element(self,name,action,selector,value=None,expected='succeeded',**extra):
        return self.action(name,{'kind':'element','action':action,'selector':selector,**({'value':value} if value is not None else {}),**extra},expected)
    def verify(self,name,expression):
        return self.js(name,f"(()=>{{if(!({expression}))throw new Error('Verification failed: {name}');return true}})()")
    def run(self,advanced=False):
        self.js('fixture',f"document.open();document.write({json.dumps(fixture)});document.close();true")
        self.js('fixture setup',f'(()=>{{{setup}}})()')
        for selector in ['#text','#area','#edit','custom-app >>> #shadow']:
            self.element('fill '+selector,'fill',selector,'Hello 世界 👋')
        self.verify('all fills retained',"document.querySelector('#text').value==='Hello 世界 👋'&&document.querySelector('#area').value==='Hello 世界 👋'&&document.querySelector('#edit').textContent==='Hello 世界 👋'&&document.querySelector('custom-app').shadowRoot.querySelector('input').value==='Hello 世界 👋'")
        self.element('read-only rejection','fill','#readonly','wrong',expected='failed')
        self.element('disabled fieldset rejection','fill','#fieldset','wrong',expected='failed')
        self.element('aria-disabled rejection','click','#disabled',expected='failed')
        self.element('ambiguous selector rejection','click','.duplicate',expected='failed')
        self.verify('no disabled mutation',"bad===0&&document.querySelector('#readonly').value==='unchanged'&&document.querySelector('#fieldset').value==='unchanged'")
        self.element('below-fold click','click','#bottom')
        self.verify('below-fold exactly once','bottoms===1')
        self.action('shadow DOM observation',{'kind':'observe','screenshot':True})
        self.action('iframe fill',{'kind':'batch','commands':[['frame','#frame'],['fill','#inside','frame text'],['get','value','#inside'],['frame','main']]})
        self.verify('iframe value verified in page',"document.querySelector('#frame').contentDocument.querySelector('#inside').value==='frame text'")
        self.action('canvas export',{'kind':'canvas','selector':'#canvas'})
        self.action('link download',{'kind':'download','selector':'#download','name':'edge.txt'})
        self.action('full-page screenshot',{'kind':'screenshot','fullPage':True})
        for i in range(3):
            for selector in ['#text','#area','custom-app >>> #shadow']:
                self.element(f'individual speed {i} {selector}','fill',selector,f'round {i}')
        if advanced:
            for i in range(3):
                self.action(f'sequence speed {i}',{'kind':'sequence','steps':[{'kind':'element','action':'fill','selector':s,'value':f'sequence {i}'} for s in ['#text','#area','custom-app >>> #shadow']]})
            self.js('schedule overlay','document.querySelector("#cover").style.display="block";setTimeout(()=>document.querySelector("#cover").style.display="none",2000);true')
            self.element('temporary overlay waits','click','#counter')
            self.verify('overlay click exactly once','count===1')
            self.js('schedule insertion',"setTimeout(()=>{const b=document.createElement('button');b.id='late';b.textContent='Late';b.onclick=()=>window.lateClicks=(window.lateClicks||0)+1;document.body.prepend(b)},2000);true")
            self.element('late element waits','click','#late')
            self.verify('late click exactly once','lateClicks===1')
            self.action('sequence stops on error',{'kind':'sequence','steps':[{'kind':'element','action':'click','selector':'#counter'},{'kind':'element','action':'click','selector':'.duplicate'},{'kind':'element','action':'click','selector':'#counter'}]},'failed')
            self.verify('failed sequence no replay','count===2')
            self.js('schedule motion',"document.querySelector('#moving').animate([{transform:'translateX(0)'},{transform:'translateX(180px)'}],{duration:2000,fill:'forwards'});true")
            self.element('moving target settles','click','#moving')
            self.verify('moving click exactly once','moves===1')
            self.js('replace during settling',"const old=document.querySelector('#moving');old.scrollIntoView=()=>{const fresh=old.cloneNode(true);fresh.onclick=()=>window.moves++;old.replaceWith(fresh)};true")
            self.element('replaced target reacquired before input','click','#moving')
            self.verify('replacement clicked once','moves===2')
            self.js('oversized and hidden fixtures',"const wide=document.createElement('button');wide.id='wide';wide.textContent='Wide';wide.onclick=()=>window.wideClicks=(window.wideClicks||0)+1;document.body.prepend(wide);const hide=document.createElement('button');hide.id='hidden';hide.style.display='none';document.body.prepend(hide);true")
            self.element('oversized target visible portion','click','#wide')
            self.verify('wide target exactly once','wideClicks===1')
            self.element('hidden target rejects','click','#hidden',expected='failed',waitMs=0)
            self.element('missing target rejects','click','#missing',expected='failed',waitMs=100)
            self.js('masked field fixture',"document.querySelector('#text').oninput=e=>e.target.value=e.target.value.toUpperCase();true")
            self.element('transformed fill detected','fill','#text','lowercase',expected='failed')
            self.verify('transformed field retained one insertion',"document.querySelector('#text').value==='LOWERCASE'")
            self.js('basic form fixture',"document.body.insertAdjacentHTML('afterbegin','<input id=check type=checkbox><select id=select><option value=one>One</option><option value=two>Two</option></select>');true")
            self.action('checkbox and select',{'kind':'batch','commands':[['check','#check'],['select','#select','two']]})
            self.verify('checkbox and select state',"document.querySelector('#check').checked&&document.querySelector('#select').value==='two'")
            self.action('batch stops on error',{'kind':'batch','commands':[['eval','window.batchCount=1'],['eval',"throw new Error('intentional')"],['eval','window.batchCount++']]},'failed')
            self.verify('batch no trailing mutation','batchCount===1')
            self.action('record start',{'kind':'record','action':'start','fps':10})
            self.action('screenshot while recording',{'kind':'screenshot'})
            self.js('record motion',"document.body.style.background='#def';true")
            self.action('record stop',{'kind':'record','action':'stop','fps':10})
            self.action('image PDF',{'kind':'pdf'})

        return self.rows

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('session_file');p.add_argument('output');p.add_argument('--advanced',action='store_true');a=p.parse_args()
    data=json.loads(Path(a.session_file).read_text());suite=Suite(data.get('session',data))
    try:suite.run(a.advanced)
    finally:Path(a.output).write_text(json.dumps(suite.rows,indent=2)+'\n')
