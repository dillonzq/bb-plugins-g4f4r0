/** Timing only. Bounded per-report samples; tracing expires without a reload. */
export const viewerTrace = String.raw`
let traceUntil=0,traceSamples={};
function traceSample(name,value){if(performance.now()>traceUntil||!Number.isFinite(value)||value<0)return;const values=traceSamples[name]||(traceSamples[name]=[]);if(values.length<128)values.push(Math.min(60000,value));}
function traceReport(){const result={};for(const [name,values] of Object.entries(traceSamples)){if(!values.length)continue;values.sort((a,b)=>a-b);result[name]={count:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values[values.length-1]};}traceSamples={};return result;}
`;
