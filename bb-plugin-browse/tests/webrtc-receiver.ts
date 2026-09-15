// Test-only receiver: same canvas presentation and input path as the production viewer.
export function webrtcReceiver(port: number) { return `
let videoMode=true,rtcPeer=null,rtcVideo=null;
function stopVideo(){rtcPeer?.close();rtcVideo?.remove();rtcPeer=null;rtcVideo=null;}
function openVideo(){
 const pc=rtcPeer=new RTCPeerConnection({iceServers:[]});window.testPeer=pc;
 const ws=cast=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/webrtc/signaling');let peer='';let chain=Promise.resolve();
 pc.onconnectionstatechange=()=>{status.textContent=pc.connectionState==='connected'?'Live · WebRTC':'WebRTC · '+pc.connectionState;};
 const send=m=>ws.send(peer+' '+JSON.stringify(m));
 ws.onopen=()=>ws.send('HELLO client '+JSON.stringify({client_type:'controller',client_slot:1,display_id:'primary'}));
 pc.onicecandidate=e=>{if(e.candidate)send({ice:{candidate:e.candidate.candidate,sdpMLineIndex:e.candidate.sdpMLineIndex}});};
 ws.onmessage=e=>{chain=chain.then(async()=>{const text=String(e.data);if(text==='HELLO'){ws.send('SESSION server');return;}if(text.startsWith('SESSION_OK ')){peer=text.split(' ')[1];return;}if(text.startsWith('ERROR'))throw Error(text);const i=text.indexOf(' ');if(i<0)return;peer=text.slice(0,i);const m=JSON.parse(text.slice(i+1));if(m.sdp){await pc.setRemoteDescription(m.sdp);await pc.setLocalDescription(await pc.createAnswer());send({sdp:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});}else if(m.ice)await pc.addIceCandidate(m.ice);}).catch(e=>console.error(String(e)));};
 pc.ondatachannel=e=>{e.channel.onopen=()=>e.channel.send('START_VIDEO');};
 pc.ontrack=e=>{if(e.track.kind!=='video')return;const video=rtcVideo=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';video.srcObject=new MediaStream([e.track]);document.body.append(video);video.play().catch(console.error);function frame(){if(pc.connectionState==='closed')return;lastSocketFrame=Date.now();if(decodedFrame)decodedFrame.bitmap.close();decodedFrame={readyAt:performance.now(),bitmap:new VideoFrame(video),frame:{width:video.videoWidth,height:video.videoHeight,url:currentUrl,loading:false},ack:()=>{}};drawFrame();video.requestVideoFrameCallback(frame);}video.requestVideoFrameCallback(frame);};
 ws.onclose=()=>stopVideo();
}
`; }
