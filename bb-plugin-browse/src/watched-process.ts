import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

// The host worker can be terminated after a daemon disconnect or crash without
// running plugin disposal. A tiny parent process keeps an IPC-like stdin pipe
// open and terminates the owned child as soon as that pipe closes.
const WATCHDOG = String.raw`
const {spawn}=require('node:child_process');
const command=process.argv[1],args=process.argv.slice(2);
const child=spawn(command,args,{env:process.env,stdio:['ignore','ignore','pipe'],windowsHide:true});
child.stderr.pipe(process.stderr);
let stopping=false,force;
function stop(signal='SIGTERM'){
  if(stopping)return;
  stopping=true;
  if(child.exitCode===null&&child.signalCode===null){
    child.kill(signal);
    force=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')},1500);
    force.unref();
  }
}
process.stdin.resume();
process.stdin.on('end',()=>stop());
process.stdin.on('error',()=>stop());
process.on('SIGTERM',()=>stop());
process.on('SIGINT',()=>stop());
child.on('error',error=>{process.stderr.write(String(error));process.exitCode=127});
child.on('exit',(code,signal)=>{clearTimeout(force);process.exit(signal?128:code??0)});
`;

export function spawnWatched(
  command: string,
  args: string[],
  options: Omit<SpawnOptions, "stdio"> & {
    stderr?: "ignore" | "pipe";
  } = {},
): ChildProcess {
  const { stderr = "pipe", ...spawnOptions } = options;
  return spawn(process.execPath, ["-e", WATCHDOG, command, ...args], {
    ...spawnOptions,
    stdio: ["pipe", "ignore", stderr],
    windowsHide: true,
  });
}
