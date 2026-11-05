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
