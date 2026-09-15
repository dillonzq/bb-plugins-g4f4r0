import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { z } from 'zod';
const endpoint=z.object({port:z.number().int().min(1024).max(65535),token:z.string().regex(/^[a-f0-9]{64}$/),expires:z.number()});
async function active(){const config=endpoint.parse(JSON.parse(await readFile(join(homedir(),'.cache/browse-stream-bench/embedded.json'),'utf8')));if(config.expires<Date.now())throw Error('Test expired');return config;}
/** Explicit, temporary test fixture. No URLs or ports are accepted from the client. */
export function registerStreamTest(bb:BbPluginApi){
 for(const [method,path] of [['GET','viewer'],['GET','viewer-info'],['POST','presence'],['POST','input'],['POST','rtc-diagnostics']] as const){
  bb.http.route(method,'/stream-test/'+path,async c=>{
   c.header('Cache-Control','no-store');
   try{const config=await active();const body=method==='POST'?await c.req.text():undefined;if(body&&body.length>65536)return c.text('Request too large',413);
    const response=await fetch(`http://127.0.0.1:${config.port}/${path}`,{method,body,headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},signal:AbortSignal.timeout(10000)});
    if(path==='viewer'){c.header('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; worker-src blob:; media-src blob:; frame-ancestors 'self'");return c.html(await response.text());}
    return c.json(await response.json(),response.ok?200:502);
   }catch{return path==='viewer'?c.html('<html><body style="background:#111;color:#aaa;font:14px system-ui;display:grid;place-items:center;height:95vh">The browser test has ended.</body></html>'):c.json({error:'Test unavailable'},503);}
  });
 }
 for(const path of ['api/webrtc/signaling','control','video']){
  bb.http.experimental_websocket('/stream-test/'+path,()=>{
   let upstream:WebSocket|undefined,closed=false;const pending:string[]=[];
   return {
    onOpen(socket){void(async()=>{try{const config=await active();if(closed)return;upstream=new WebSocket(`ws://127.0.0.1:${config.port}/${path}`,{headers:{authorization:`Bearer ${config.token}`},maxPayload:4*1024*1024,handshakeTimeout:5000});upstream.on('open',()=>{if(closed){upstream?.close();return;}for(const message of pending)upstream!.send(message);pending.length=0;});upstream.on('message',(data,binary)=>{if(!closed)socket.send(binary?Buffer.from(data as Buffer):String(data));});upstream.on('close',()=>{if(!closed)socket.close(1000,'Test connection ended');});upstream.on('error',()=>{if(!closed)socket.close(1011,'Test unavailable');});}catch{socket.close(1011,'Test unavailable');}})();},
    onMessage(socket,raw){if(closed)return;if(typeof raw!=='string'||raw.length>65536||(upstream?.bufferedAmount??0)>65536){socket.close(1008,'Invalid test message');return;}if(upstream?.readyState===1)upstream.send(raw);else if(pending.length<16)pending.push(raw);else socket.close(1008,'Test queue full');},
    onClose(){closed=true;pending.length=0;upstream?.close();},
   };
  });
 }
}
