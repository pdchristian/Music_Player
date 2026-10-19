// Erzeugt echte Test-WAV-Dateien fuer manuelle Tests / Playwright:
//  test/test_30s_mit-beat.wav  (30 s, deutliche Beat-Struktur -> schoene Waveform)
//  test/test_8s_kurz.wav       (8 s, Kurztest)
const fs = require("fs");
const path = require("path");

function wav(samples, sampleRate){
  const n = samples.length;
  const dv = new DataView(new ArrayBuffer(44 + n*2));
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o+i, s.charCodeAt(i)); };
  wstr(0,"RIFF"); dv.setUint32(4, 36+n*2, true); wstr(8,"WAVEfmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate*2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36,"data"); dv.setUint32(40, n*2, true);
  for (let i = 0; i < n; i++){
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i*2, s < 0 ? s*0x8000 : s*0x7fff, true);
  }
  return Buffer.from(dv.buffer);
}
function make(seconds, sr){
  const out = new Float64Array(Math.floor(seconds*sr));
  for (let t = 0; t < seconds; t += 0.25){
    const beat = Math.floor(t/2) % 4;
    const f = [220, 277, 330, 165][beat === 0 ? 0 : ((Math.floor(t)%3)+1)];
    const amp = beat === 0 ? 0.9 : 0.4;
    for (let i = Math.floor(t*sr); i < Math.min(out.length, Math.floor((t+0.24)*sr)); i++){
      const p = (i/sr - t) / 0.24;
      const env = Math.exp(-p*4) * amp;
      out[i] += Math.sin(2*Math.PI*f*(i/sr)) * env
              + Math.sin(2*Math.PI*f*2*(i/sr)) * env * 0.3;
    }
  }
  return Array.from(out);
}
const out = path.join(__dirname, "..", "test_audio");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "test_30s_mit-beat.wav"), wav(make(30, 22050), 22050));
fs.writeFileSync(path.join(out, "test_8s_kurz.wav"), wav(make(8, 22050), 22050));
console.log("Test-WAVs erzeugt:", fs.readdirSync(out).join(", "));
