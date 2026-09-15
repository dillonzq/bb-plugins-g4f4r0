import {describe,it,expect,vi,afterEach} from 'vitest';
vi.mock('node:fs/promises',()=>({readFile:vi.fn()}));
import {readFile} from 'node:fs/promises';
import {registerStreamTest} from '../src/stream-test';
function routes(){const handlers=new Map<string,any>();registerStreamTest({http:{route:(method:string,path:string,fn:any)=>handlers.set(method+' '+path,fn),experimental_websocket:()=>{}}} as any);return handlers;}
function context(){return {header:vi.fn(),req:{text:async()=>''},text:(body:unknown,status:number)=>({body,status}),json:(body:unknown,status:number)=>({body,status}),html:(body:unknown)=>({body})};}
afterEach(()=>vi.unstubAllGlobals());
describe('embedded stream test capability',()=>{
 it('does not contact a fixture with an expired capability',async()=>{vi.mocked(readFile).mockResolvedValue(JSON.stringify({port:46115,token:'a'.repeat(64),expires:0}));const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const result=await routes().get('GET /stream-test/viewer-info')(context());expect(result.status).toBe(503);expect(fetch).not.toHaveBeenCalled();});
 it('keeps the capability in the server-side request',async()=>{const token='b'.repeat(64);vi.mocked(readFile).mockResolvedValue(JSON.stringify({port:46115,token,expires:Date.now()+10000}));const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({hostLabel:'Test'})});vi.stubGlobal('fetch',fetch);const result=await routes().get('GET /stream-test/viewer-info')(context());expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:46115/viewer-info');expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer '+token);expect(JSON.stringify(result)).not.toContain(token);});
});
