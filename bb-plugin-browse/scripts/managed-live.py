import json,time,subprocess,urllib.request,importlib.util,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('session_file');p.add_argument('base_url',help='Trusted BB server URL reachable from this test machine');p.add_argument('output');args=p.parse_args()
spec=importlib.util.spec_from_file_location('edges',ROOT/'scripts/edge-cases.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
call=m.call
r=json.load(open(args.session_file));s=r['session'];suite=m.Suite(s);rows=[]
def check(name,ok,**data):
 rows.append({'name':name,'pass':bool(ok),**data});print(json.dumps(rows[-1]),flush=True)
def wait(j):
 while j['status']=='running':time.sleep(.2);j=call('job',{'hostId':s['hostId'],'id':j['id']})
 return j
def http(route,data=None,origin=None):
 headers={'Content-Type':'application/json'} if data else {}
 if origin:headers['Origin']=origin
 req=urllib.request.Request(args.base_url.rstrip('/')+'/api/v1/plugins/agent-browser/http/'+route,data=json.dumps(data).encode() if data else None,headers=headers)
 with urllib.request.urlopen(req,timeout=30) as f:return json.load(f)
try:
 suite.js('managed download fixture',"document.body.innerHTML='<input id=viewer><button id=download>Download</button><h1>Managed PDF test</h1>';window.clicks=0;document.querySelector('#download').onclick=()=>{window.clicks++;let a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['managed browser download ✓'],{type:'text/plain'}));a.download='original.txt';a.click()};localStorage.setItem('browse-persistence','retained');true")
 j=suite.action('native button download',{'kind':'downloadClick','selector':'#download','name':'button.txt'})
 suite.verify('download triggered exactly once','clicks===1')
 artifacts=call('artifacts',{'id':s['id']});a=next(a for a in artifacts if a['name'].endswith('-button.txt'));check('download bytes verified',Path(a['path']).read_text()=='managed browser download ✓')
 suite.action('native PDF',{'kind':'pdf'})
 frame=http('frame?id='+s['id']);check('viewer frame',bool(frame['data']) and frame['width']==1280)
 j=http('input',{'id':s['id'],'input':{'kind':'click','x':70,'y':40}});check('viewer click input',wait(j)['status']=='succeeded')
 suite.action('focus viewer test field',{'kind':'element','action':'click','selector':'#viewer'})
 j=http('input',{'id':s['id'],'input':{'kind':'text','text':'Viewer ✓'}});check('viewer text input',wait(j)['status']=='succeeded');suite.verify('viewer input arrived',"document.querySelector('#viewer').value==='Viewer ✓'")
 suite.action('record start',{'kind':'record','action':'start'})
 suite.js('visible recording change',"document.body.style.background='lightblue';true")
 suite.action('record screenshot',{'kind':'screenshot'})
 time.sleep(1)
 suite.action('record stop',{'kind':'record','action':'stop'})
 artifacts=call('artifacts',{'id':s['id']});a=sorted((a for a in artifacts if a['name'].endswith('.webm')),key=lambda a:a['name'])[-1];check('recording nonempty',a['bytes']>1000,bytes=a['bytes'],path=a['path'])
 job=call('run',{'id':s['id'],'operation':{'kind':'command','args':['wait','10000']}})
 try:http('input',{'id':s['id'],'input':{'kind':'text','text':'MUST NOT TYPE'}});check('viewer cannot compete with automation',False)
 except Exception as e:check('viewer cannot compete with automation','409' in str(e))
 call('cancel',{'hostId':s['hostId'],'id':job['id']});check('job cancels',wait(job)['status']=='cancelled')
 original=s;r=call('reconnect',{'id':s['id']});s=r['session'];suite.s=s;connected=wait(r['job']);check('managed reconnect',connected['status']=='succeeded' and s['profileId']==original['profileId'],job=connected)
 suite.verify('profile storage survived restart',"localStorage.getItem('browse-persistence')==='retained'")
 check('old artifacts survived reconnect',len(call('artifacts',{'id':original['id']}))>=3)
 call('close',{'id':s['id']});listed=call('list',{'threadId':s['threadId']});check('close releases browser',next(x for x in listed if x['id']==s['id'])['status']=='released')
 check('profile process terminated',not any('--user-data-dir=' in x and s['profileId'] in x for x in subprocess.check_output(['ps','-eo','args'],text=True).splitlines()))
finally:
 Path(args.output).write_text(json.dumps(suite.rows+rows,indent=2)+'\n')
