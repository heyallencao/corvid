#!/usr/bin/env node
import { connect } from '../sdk/index.js';

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
`;

async function main(){
  const [command,...args]=process.argv.slice(2);
  if(!command || command==='help' || command==='--help' || command==='skill') {if(args.length)throw new Error('Unexpected arguments');process.stdout.write(usage);return;}
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
