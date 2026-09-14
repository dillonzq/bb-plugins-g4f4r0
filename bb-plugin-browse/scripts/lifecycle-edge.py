"""Exercise upload, navigation, busy protection and cancellation in the owned fixture tab."""
import json, time, importlib.util, argparse
from pathlib import Path
spec=importlib.util.spec_from_file_location('edges',Path(__file__).with_name('edge-cases.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
call=mod.call
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('session_file');parser.add_argument('output');args=parser.parse_args()
s=json.loads(Path(args.session_file).read_text())['session'];suite=mod.Suite(s)
artifactSession=s['id']
rows=[]
def check(name,passed,**data):
 row={'name':name,'pass':bool(passed),**data};rows.append(row);print(json.dumps(row),flush=True)
def wait(j):
 while j['status']=='running':time.sleep(.15);j=call('job',{'hostId':s['hostId'],'id':j['id']})
 return j
try:
 artifacts=call('artifacts',{'id':s['id']});edge=next(a for a in artifacts if a['name'].endswith('-edge.txt'))
 suite.action('upload saved text file',{'kind':'command','args':['upload','#file',edge['path']]})
 suite.js('uploaded file byte contents',"(async()=>{if(await document.querySelector('#file').files[0].text()!=='edge download ✓\\n')throw new Error('Upload bytes mismatch');return true})()")
 suite.action('dialog accept',{'kind':'batch','commands':[['eval',"setTimeout(()=>window.dialogAnswer=confirm('Browse Stagehand test'),100);true"],['wait','200'],['dialog','accept']]})
 suite.verify('confirmation result accepted','dialogAnswer===true')
 suite.js('pointer events instrumentation',"window.pointerEvents=[];document.addEventListener('mousedown',()=>pointerEvents.push('down'));document.addEventListener('mouseup',()=>pointerEvents.push('up'));true")
 job=call('run',{'id':s['id'],'operation':{'kind':'sequence','steps':[{'kind':'gesture','strokes':[[{'x':10+i,'y':10} for i in range(150)]],'intervalMs':30},{'kind':'command','args':['eval','window.shouldNotRun=true']}]}})
 check('long sequence is asynchronous',job['status']=='running')
 try:
  call('run',{'id':s['id'],'operation':{'kind':'command','args':['get','title']}});check('busy session blocks competing action',False)
 except RuntimeError as e:check('busy session blocks competing action','busy' in str(e))
 start=time.monotonic();call('cancel',{'hostId':s['hostId'],'id':job['id']});end=wait(job);check('cancel sequence',end['status']=='cancelled',wallMs=round((time.monotonic()-start)*1000))
 oldTab=s['tabId'];r=call('reconnect',{'id':s['id']});connected=wait(r['job']);check('reconnect keeps same native tab',connected['status']=='succeeded' and r['session']['tabId']==oldTab);s=r['session'];suite.s=s;Path(args.session_file).write_text(json.dumps(r))
 suite.verify('cancelled pointer released and trailing action absent',"pointerEvents.join(',')==='down,up'&&!window.shouldNotRun")
 suite.action('navigate to example',{'kind':'command','args':['open','https://example.com']})
 suite.verify('navigation title and ready state',"document.title==='Example Domain'&&document.readyState!=='loading'")
 suite.action('navigation back',{'kind':'command','args':['back']})
 suite.verify('back returned to original page',"location.href==='about:blank'")
 call('release',{'id':s['id']});tabs=call('tabs',{k:s[k] for k in ['hostId','instanceId','generation','threadId']});check('release preserves native tab',any(t['tabId']==oldTab for t in tabs))
 files=call('artifacts',{'id':artifactSession});check('artifacts remain after release',len(files)>0,count=len(files))
finally:
 Path(args.output).write_text(json.dumps(suite.rows+rows,indent=2)+'\n')
