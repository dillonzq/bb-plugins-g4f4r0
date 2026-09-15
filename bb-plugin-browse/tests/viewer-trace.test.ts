import {it,expect} from 'vitest';
import {viewerTrace} from '../src/viewer-trace';
it('bounds timing samples and stops collecting when the trace expires',()=>{
 let now=1;
 const trace=new Function('performance',viewerTrace+'return {sample:traceSample,report:traceReport,enable:()=>traceUntil=100};')({now:()=>now});
 trace.sample('inputRtt',5);expect(trace.report()).toEqual({});trace.enable();
 for(let i=0;i<200;i++)trace.sample('inputRtt',i);
 trace.sample('decode',NaN);trace.sample('decode',-1);
 expect(trace.report()).toEqual({inputRtt:{count:128,p50:64,p95:121,max:127}});
 now=101;trace.sample('inputRtt',5);expect(trace.report()).toEqual({});
});
