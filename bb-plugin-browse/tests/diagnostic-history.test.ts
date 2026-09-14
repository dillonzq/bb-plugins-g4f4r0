import {it,expect} from 'vitest';
import {boundedDiagnostic,diagnosticUrl} from '../src/diagnostic-history';
it('preserves ordinary diagnostics and caps oversized page data',()=>{
 const normal={args:[{type:'string',value:'hello'}]};expect(boundedDiagnostic(normal)).toBe(normal);
 const large=boundedDiagnostic({args:[{value:'x'.repeat(1000000)}]});
 expect(large).toMatchObject({truncated:true});expect(JSON.stringify(large).length).toBeLessThan(16000);
 expect(diagnosticUrl('https://example.com')).toBe('https://example.com');
 expect(diagnosticUrl('data:'+ 'a'.repeat(1000000)).length).toBeLessThanOrEqual(8192);
});
it('keeps the serialized bound even when the preview needs JSON escaping',()=>{
 const result=boundedDiagnostic({value:'\\"\n'.repeat(100000)});
 expect(JSON.stringify(result).length).toBeLessThan(16000);
});
