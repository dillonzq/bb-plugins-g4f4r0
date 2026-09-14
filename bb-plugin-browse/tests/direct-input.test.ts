import {it,expect,vi} from 'vitest';
import {DirectInput,directBatch,selectionExpression} from '../src/direct-input';
const pointer=(type:'down'|'move'|'up',buttons=0)=>({kind:'pointer' as const,type,x:20,y:30,button:'left' as const,buttons,clickCount:1,modifiers:0});
it('keeps drag ownership across batches and releases it on disconnect',async()=>{
 const cdp={send:vi.fn().mockResolvedValue({}),evaluate:vi.fn().mockResolvedValue('selected')};const input=new DirectInput(cdp);
 await input.run('a',[pointer('down',1)]);expect(input.held).toBe(true);
 await expect(input.run('b',[pointer('move')])).rejects.toThrow('another viewer');
 await input.run('a',[pointer('move',1)]);await input.reset('b');expect(input.held).toBe(true);
 await input.reset('a');expect(input.held).toBe(false);
 expect(cdp.send).toHaveBeenLastCalledWith('Input.dispatchMouseEvent',expect.objectContaining({type:'mouseReleased',button:'left',buttons:0}));
});
it('returns selection on pointer release and excludes password selections',async()=>{
 const cdp={send:vi.fn().mockResolvedValue({}),evaluate:vi.fn().mockImplementation(async e=>e===selectionExpression?'Selected text':'text')};const input=new DirectInput(cdp);
 await input.run('a',[pointer('down',1)]);expect(await input.run('a',[pointer('up')])).toEqual({selection:'Selected text',cursor:'text'});
 expect(selectionExpression).toContain("e.type==='password'");
});
it('dispatches editing keys directly and releases held keys after a failure',async()=>{
 const cdp={send:vi.fn().mockResolvedValue({}),evaluate:vi.fn().mockResolvedValue('')};const input=new DirectInput(cdp);
 await input.run('a',[{kind:'keyboard',type:'down',key:'a',code:'KeyA',modifiers:4,repeat:false}]);
 expect(cdp.send).toHaveBeenCalledWith('Input.dispatchKeyEvent',expect.objectContaining({commands:['selectAll'],type:'rawKeyDown'}));
 cdp.send.mockRejectedValueOnce(Error('lost'));
 await expect(input.run('a',[{kind:'text',text:'example'}])).rejects.toThrow('lost');expect(input.held).toBe(false);
 expect(cdp.send).toHaveBeenLastCalledWith('Input.dispatchKeyEvent',expect.objectContaining({type:'keyUp',key:'a'}));
});
it('bounds messages and rejects arbitrary protocol commands',()=>{
 expect(()=>directBatch.parse({id:'session',clientId:'client',events:Array(65).fill(pointer('move'))})).toThrow();
 expect(()=>directBatch.parse({id:'session',clientId:'client',events:[{kind:'cdp',method:'Browser.close'}]})).toThrow();
});
