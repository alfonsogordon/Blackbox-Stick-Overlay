// Browser Blackbox decoder adapter. Bundled against Betaflight's GPL-3.0 Blackbox Explorer parser.
import { FlightLog } from "./vendor/blackbox/src/flightlog.js";
let log = null, start = 0, end = 0, indexes = [];
export function loadBinary(bytes, flightNumber = 1) {
  log = new FlightLog(new Uint8Array(bytes));
  const count = log.getLogCount();
  if (flightNumber < 1 || flightNumber > count) throw new Error("Log contains " + count + " flights; selected " + flightNumber);
  if (!log.openLog(flightNumber - 1)) throw new Error("Unable to open flight " + flightNumber);
  indexes = [0,1,2,3].map(i => {
    const k = log.getMainFieldIndexByName("rcCommand[" + i + "]");
    if (k === undefined) throw new Error("Missing rcCommand[" + i + "] field");
    return k;
  });
  start = log.getMinTime();
  end = log.getMaxTime();
  if (!(end > start)) throw new Error("Invalid flight timestamps");
  return { count, duration: (end - start) / 1000000 };
}
export function sampleBinary(seconds) {
  if (!log) return [0,0,0,1000];
  const micros = Math.max(start, Math.min(end, start + seconds * 1000000));
  const frame = log.getFrameAtTime(micros);
  return frame ? indexes.map(i => Number(frame[i]) || 0) : [0,0,0,1000];
}

export function getBinaryFields() {
  return log ? log.getMainFieldNames().slice() : [];
}
export function sampleBinaryFields(seconds) {
  if (!log) return null;
  const micros = Math.max(start, Math.min(end, start + seconds * 1000000));
  return log.getFrameAtTime(micros);
}

/**
 * Extract Betaflight event frames used by Blackbox Explorer's timeline.
 * The main-frame array alone does not expose arming/disarming events.
 * Events are expressed relative to the selected flight log's start.
 */
export function getBinaryEvents() {
 if (!log) return [];
 const result = [], chunks = log.getChunksInTimeRange(start,end);
 for (const chunk of chunks) {
  for (const frame of chunk.events || []) {
   if (!Number.isFinite(frame.time)) continue;
   const at=Math.max(0,(frame.time-start)/1000000);
   if (frame.event===30) result.push({at,kind:"flight_mode",armed:(Number(frame.data?.newFlags||0)&1)!==0,previousArmed:(Number(frame.data?.lastFlags||0)&1)!==0});
   else if(frame.event===15)result.push({at,kind:"disarm",armed:false,reason:frame.data?.reason??null});
  }
 }
 return result.sort((a,b)=>a.at-b.at);
}
