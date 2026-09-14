"""Linux live resource and reuse audit. Runs only in its own about:blank sessions."""
import argparse, concurrent.futures, json, os, statistics, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
args=argparse.ArgumentParser();args.add_argument("--cycles",type=int,default=10);args.add_argument("--output",default="resource-audit.json");options=args.parse_args()
rows=[];owned=[];samples=[];known_daemon_pids=set()
def call(m,v):
 r=subprocess.run(['bb','browse',m,json.dumps(v)],capture_output=True,text=True,timeout=40)
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout)
def check(name,ok,**data):
 row={'name':name,'pass':bool(ok),**data};rows.append(row);print(json.dumps(row),flush=True)
 if not ok:raise AssertionError(name)
def wait(r):
 j=r['job'];deadline=time.monotonic()+35
 while j['status']=='running':
  if time.monotonic()>deadline:raise TimeoutError(j)
  time.sleep(.05);j=call('job',{'hostId':r['session']['hostId'],'id':j['id']})
 if j['status']!='succeeded':raise RuntimeError(j)
 return j
def action(r,expr):
 j=call('run',{'id':r['session']['id'],'operation':{'kind':'command','args':['eval',expr]}})
 return wait({'session':r['session'],'job':j})
def processes():
 daemon_pids=set() # Stagehand runs inside the shared host worker, not a per-session daemon.
 procs={}
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   cmd=(p/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace');status=(p/'status').read_text();ppid=int(next(x.split()[1] for x in status.splitlines() if x.startswith('PPid:')))
   procs[int(p.name)]=(ppid,cmd)
  except (OSError,StopIteration):pass
 roots={pid for pid,(_,cmd) in procs.items() if (cmd.split(' ',1)[0].endswith('/chrome') and any('--user-data-dir='+str(Path.home()/'.bb/plugins/browse/host-data/profiles'/sid)+' ' in cmd for sid in owned))}
 ids=set(roots)
 for _ in range(8):ids.update(pid for pid,(parent,_) in procs.items() if parent in ids)
 pss=0
 for pid in ids:
  try:pss+=int(next(x.split()[1] for x in Path(f'/proc/{pid}/smaps_rollup').read_text().splitlines() if x.startswith('Pss:')))
  except (OSError,StopIteration):pass
 return {'processes':len(ids),'pssMiB':round(pss/1024,2)}
try:
 baseline=processes();check('clean starting process baseline',baseline['processes']==0,**baseline)
 cold=[];reuse=[]
 for cycle in range(options.cycles):
  t=time.monotonic();r=call('start',{'url':'about:blank','newTab':True});owned.append(r['session']['id']);wait(r);cold.append(round((time.monotonic()-t)*1000))
  action(r,'window.browseAuditCounter=123;true')
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
   t=time.monotonic();results=list(pool.map(lambda _:call('start',{'url':'about:blank'}),range(8)));batch=round((time.monotonic()-t)*1000)
  check(f'cycle {cycle+1}: eight concurrent starts reuse same session',all(x['session']['id']==r['session']['id'] for x in results),batchWallMs=batch)
  t=time.monotonic();again=call('start',{'url':'about:blank'});reuse.append(round((time.monotonic()-t)*1000))
  check(f'cycle {cycle+1}: reuse preserves page state','true' in action(r,'window.browseAuditCounter===123')['output'])
  call('cancel',{'hostId':r['session']['hostId'],'id':r['job']['id']})
  check(f'cycle {cycle+1}: cancelling completed job preserves page','true' in action(r,'window.browseAuditCounter===123')['output'])
  sample=processes();samples.append(sample)
  if cycle==0:
   other=call('start',{'url':'about:blank','newTab':True});owned.append(other['session']['id']);wait(other)
   check('explicit newTab opens separate session',other['session']['id']!=r['session']['id'])
   action(other,'window.browseAuditCounter=456;true');check('separate session keeps original untouched','true' in action(r,'window.browseAuditCounter===123')['output'])
   call('close',{'id':other['session']['id']})
  with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:list(pool.map(lambda _:call('close',{'id':r['session']['id']}),range(5)))
  deadline=time.monotonic()+5
  while processes()['processes'] and time.monotonic()<deadline:time.sleep(.1)
  after=processes();check(f'cycle {cycle+1}: concurrent close leaves zero browser/daemon processes',after['processes']==0,**after)
 summary={'coldStartMedianMs':statistics.median(cold),'reuseMedianMs':statistics.median(reuse),'coldStartMs':cold,'reuseMs':reuse,'activePssMiB':[x['pssMiB'] for x in samples],'activeProcessCounts':[x['processes'] for x in samples],'end':processes()}
 print(json.dumps(summary),flush=True)
finally:
 for sid in owned:
  try:call('close',{'id':sid})
  except Exception:pass
 (ROOT/'validation'/options.output).write_text(json.dumps({'checks':rows,'summary':locals().get('summary')},indent=2)+'\n')
