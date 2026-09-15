// Opt-in no-op control-route measurement. No pointer, keyboard or page mutation.
import WebSocket from 'ws';
const id=process.argv[2];if(!id)throw Error('Session ID required');
const ws=new WebSocket('ws://127.0.0.1:38886/api/v1/plugins/browse/http/control?id='+encodeURIComponent(id));
const samples:number[]=[];let seq=0,at=0;const timer=setTimeout(()=>{ws.terminate();process.exitCode=1;},20000);
const send=()=>{at=performance.now();ws.send(JSON.stringify({seq:++seq,events:[{kind:'heartbeat'}]}));};
ws.on('open',()=>setTimeout(send,800));
ws.on('message',raw=>{const result=JSON.parse(String(raw));if(result.error){console.error(result.error);process.exitCode=1;ws.close();return;}samples.push(performance.now()-at);if(seq<100)send();else{const sorted=[...samples].sort((a,b)=>a-b);console.log(JSON.stringify({transport:result.transport??'rpc',samples:samples.length,p50:sorted[50],p95:sorted[95],max:sorted.at(-1),kind:'loopback heartbeat ACK; excludes page mutation and video'}));ws.close();}});
ws.on('error',e=>{console.error(e.message);process.exitCode=1;});ws.on('close',()=>clearTimeout(timer));
