"""Repeat Back/Forward and mixed batches against an explicitly owned BB tab."""
import json,importlib.util,argparse
from pathlib import Path
spec=importlib.util.spec_from_file_location('edges',Path(__file__).with_name('edge-cases.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
p=argparse.ArgumentParser(description=__doc__);p.add_argument('session_file');p.add_argument('output');args=p.parse_args();s=json.loads(Path(args.session_file).read_text())['session'];suite=mod.Suite(s)
try:
 suite.action('open example',{'kind':'command','args':['open','https://example.com']})
 for i in range(3):
  suite.action(f'back {i}',{'kind':'command','args':['back']})
  suite.verify(f'back destination {i}',"location.href==='about:blank'")
  suite.action(f'forward {i}',{'kind':'command','args':['forward']})
  suite.verify(f'forward destination {i}',"document.title==='Example Domain'")
 suite.action('back and forward in mixed batch',{'kind':'batch','commands':[['back'],['get','url'],['forward'],['get','title']]})
 suite.verify('mixed batch destination',"document.title==='Example Domain'")
 suite.action('restore test tab',{'kind':'command','args':['back']})
finally:Path(args.output).write_text(json.dumps(suite.rows,indent=2)+'\n')
