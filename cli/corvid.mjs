#!/usr/bin/env node
import { connect } from '../sdk/index.js';
import { HOST_IDS, connectHost, disconnectHost, doctor } from './connect.mjs';

const usage=`corvid run < script.mjs

Runs JavaScript from standard input in Node.js. Available bindings:
  openRoom(nameOrId, {profileId?})  create or resume an agent-owned room
  listRooms()                       list rooms and ownership
  resumeRoom(id)                    resume a yielded room when allowed
  claimRoom(id)                     request the user's approval for a room
  client                            access the corvid SDK

Example:
  const task = await openRoom('research');
  console.log({roomId: task.roomId});
  const page = task.page('p1');
  await page.goto('https://example.com');
  console.log(await page.snapshot());
  await task.finish({keep: []});

Scripts execute with the local Node.js process's permissions. Browser actions
require a running corvid desktop. This is a partial API; see sdk/README.md.

corvid connect <host> [--token <token>] [--browser-script] [--yes]
corvid disconnect <host>
corvid doctor [host]

Connect the Corvid Browser MCP server and the corvid-browser skill into an
external agent host (supported: ${HOST_IDS.join(', ')}). connect lists every
config file and entry it is about to write and requires explicit confirmation.
Without --token it issues a scoped openRoomGrant credential through the running
Corvid desktop and embeds it into the host config (disconnect revokes it);
--token embeds an existing scoped token instead and disconnect leaves it alone.
--browser-script additionally enables the browser_script batch execution tool,
which runs scripts with full local Node.js permissions — it is NOT sandboxed.
disconnect reverts exactly what connect wrote. doctor diagnoses the desktop
control service, registrations and skills.
`;

function parseFlags(args) {
  const flags={};
  const rest=[];
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--yes')flags.yes=true;
    else if(arg==='--browser-script')flags.browserScript=true;
    else if(arg==='--token'){if(i+1>=args.length)throw new Error('--token 需要一个凭据值（或省略它以自动签发）');flags.token=args[++i];}
    else if(arg.startsWith('--token='))flags.token=arg.slice(8);
    else rest.push(arg);
  }
  return {flags,rest};
}

async function main(){
  const [command,...args]=process.argv.slice(2);
  if(!command || command==='help' || command==='--help' || command==='skill') {if(args.length)throw new Error('Unexpected arguments');process.stdout.write(usage);return;}
  if(command==='connect' || command==='disconnect' || command==='doctor') {
    const {flags,rest}=parseFlags(args);
    if(command==='connect'){if(rest.length!==1)throw new Error('Usage: corvid connect <host>');await connectHost(rest[0],{token:flags.token,yes:Boolean(flags.yes),browserScript:flags.browserScript===true?true:flags.browserScript===undefined?undefined:false});return;}
    if(command==='disconnect'){if(rest.length!==1)throw new Error('Usage: corvid disconnect <host>');await disconnectHost(rest[0]);return;}
    if(rest.length>1)throw new Error('Usage: corvid doctor [host]');
    await doctor(rest[0]||undefined);
    return;
  }
  if(command!=='run' || args.length)throw new Error('Usage: corvid run < script.mjs');
  let source='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin)source+=chunk;
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const script=new AsyncFunction('openRoom','listRooms','resumeRoom','claimRoom','client',`"use strict";\n${source}`);
  const client=await connect();
  try {
    const openRoom=(identifier,options)=>client.openRoom(identifier,options);
    const listRooms=async()=>(await client.rooms()).map(room=>room.info);
    const resumeRoom=async id=>{const room=await client.room(id);await room.resumeControl();return client.room(id);};
    const claimRoom=id=>client.claimRoom(id);
    await script(openRoom,listRooms,resumeRoom,claimRoom,client);
  } finally {await client.disconnect();}
}
main().catch(error=>{console.error(error?.stack || String(error));process.exitCode=1;});
