"use strict";
/* ═══════════════════════════════════════════════════════════════════════
   BeatClip – Offline-Musik-Player (PWA, Android + iOS)
   -----------------------------------------------------------------------
   • Audiodateien werden importiert und in IndexedDB gespeichert (offline!)
   • Playlists mit je eigenem Schnitt {start,end} pro Titel
   • Echte Wiedergabe über ein <audio>-Element → optimales Routing auf
     Bluetooth-Lautsprecher (Android A2DP / iOS AirPlay & BT) + Sperrbildschirm
   • Media Session API: Titel, Cover, Play/Pause/Prev/Next auf Lockscreen & BT-Fernbedienung
   • Waveform aus echten Audiodaten (Peak-MinMax), Griffe zum Schneiden
   ═══════════════════════════════════════════════════════════════════════ */

/* Build-Marke: mit versionName/versionCode in android/app/build.gradle (bzw.
   ios/…/Info.plist) hochziehen, damit auf Geraeten erkennbar ist, welcher Stand
   installiert ist. */
const APP_VER = "1.1", APP_BUILD = 3;

/* ─────────────────────────── Utils ───────────────────────────────────── */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
function mmss(sec){ sec = Math.max(0, sec|0);
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; }
function mmssPrecise(sec){ sec = Math.max(0, sec);
  const m = Math.floor(sec/60), s = Math.floor(sec%60), t = Math.round((sec%1)*10);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${t}`; }
function fmtBytes(b){ if(b>=1048576) return (b/1048576).toFixed(1)+" MB";
  if(b>=1024) return (b/1024).toFixed(0)+" KB"; return b+" B"; }
function timeAgo(ts){ const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60) return "gerade eben"; if (s < 3600) return Math.floor(s/60)+" min";
  if (s < 86400) return Math.floor(s/3600)+" h"; return Math.floor(s/86400)+" T"; }
function toast(msg, isErr){ const el = $("#toast"); el.textContent = msg;
  el.classList.toggle("err", !!isErr); el.classList.add("show");
  clearTimeout(el._tm); el._tm = setTimeout(() => el.classList.remove("show"), 2600); }
const ICONS = ["🎧","🌅","🌃","🔊","🎹","🎸","🥁","🌧️","☕","🏜️","🌌","🚆","🌲","🎉","🔥","🧠"];
const iconFor = id => ICONS[(parseInt(id,36)||0) % ICONS.length];

/* ─────────────────────── State (im Speicher) ─────────────────────────── */
const state = {
  screen:"home", stack:[],
  ui:{ libQ:"", plSort:"title", activePl:null, drag:null, reorder:null, dragged:false, editTrack:null,
       editPl:null, nudgeFocus:"end", importing:false, importDone:0, importTotal:0,
       exportBusy:null,
       npIcon:"🎧", deferredInstall:null },
  db:{ ok:false, error:null },
  playlists:[],       // {id,name,cover,items:[{id,trackId,cut:{start,end}|null}]}
  tracks:new Map(),   // trackId -> {id,title,artist,album,dur,fmt,size,icon,added,name}
  queue:[], qIndex:-1,
  player:{ trackId:null, playing:false },
  settings:{ theme:"dark", repeat:"all", shuffle:false, fade:1.0, gapless:true,
             volume:0.9, sleepMin:0, plFirstRun:true },
  bt:{ active:false, label:"Lautsprecher" },
};

/* ─────────────────────────── IndexedDB ───────────────────────────────── */
const DB_NAME = "beatclip", DB_VER = 1;
let idb = null;
const recorderState = { recorder:null, stream:null, chunks:[], startedAt:0, timer:null, requesting:false, saving:false };
let channelExportFiles = [], channelExportData = null, channelExportTrack = null, channelExportFormat = "wav";
function openDB(){
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("tracks"))    db.createObjectStore("tracks",    { keyPath:"id" });
      if (!db.objectStoreNames.contains("blobs"))     db.createObjectStore("blobs",     { keyPath:"id" });
      if (!db.objectStoreNames.contains("playlists")) db.createObjectStore("playlists", { keyPath:"id" });
      if (!db.objectStoreNames.contains("settings"))  db.createObjectStore("settings",  { keyPath:"key" });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror   = () => rej(rq.error);
  });
}
const idbPut  = (store, val) => new Promise((res, rej) => {
  const t = idb.transaction(store, "readwrite");
  t.objectStore(store).put(val);
  t.oncomplete = () => res(); t.onerror = () => rej(t.error);
});
const idbDel  = (store, key) => new Promise((res, rej) => {
  const t = idb.transaction(store, "readwrite");
  t.objectStore(store).delete(key);
  t.oncomplete = () => res(); t.onerror = () => rej(t.error);
});
const idbAll  = store => new Promise((res, rej) => {
  const rq = idb.transaction(store, "readonly").objectStore(store).getAll();
  rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error);
});

async function loadAll(){
  try{
    idb = await openDB();
    state.db.ok = true;
    const [tracks, playlists, settings] = await Promise.all([
      idbAll("tracks"), idbAll("playlists"), idbAll("settings")]);
    tracks.forEach(t => state.tracks.set(t.id, t));
    state.playlists = playlists.sort((a,b) => (a.order||0)-(b.order||0));
    settings.forEach(s => { if (s.key === "settings") Object.assign(state.settings, s.value); });
    if (!state.playlists.length){
      const pl = { id:uid(), name:"Meine Playlist", cover:"🎶", order:0, items:[] };
      await idbPut("playlists", pl); state.playlists.push(pl);
    }
  }catch(e){
    state.db.ok = false; state.db.error = e && (e.message || String(e));
    console.error("IndexedDB nicht verfügbar:", e);
  }
}
const saveSettings = () => state.db.ok && idbPut("settings", { key:"settings", value:state.settings });
const savePlaylist = pl => state.db.ok && idbPut("playlists", pl);

/* ─────────────────────── Import + Metadaten ──────────────────────────── */
function parseName(filename){
  const base = filename.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
  const m = base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (m) return { artist:m[1].trim(), title:m[2].trim() };
  return { artist:"Unbekannt", title:base.trim() };
}
/* Waveform-Peaks (Peak-MinMax) aus echtem Audiomaterial */
async function computePeaks(arrayBuffer, n){
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) return null;
  let buf;
  try{
    buf = await new Promise((res, rej) => {
      const ctx = new AC(1, 1, 44100);
      const rq = ctx.decodeAudioData(
        arrayBuffer.slice(0),
        b => res(b), e => rej(e || new Error("decode")));
      if (!rq) ctx.oncomplete = () => res(ctx.renderedBuffer);
    });
  }catch(e){ return null; }
  const ch = buf.getChannelData(0), ch2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const block = Math.floor(ch.length / n), peaks = new Array(n);
  for (let i = 0; i < n; i++){
    let mx = 0;
    const from = i*block, to = Math.min(ch.length, from + block);
    const step = Math.max(1, Math.floor((to-from)/128));
    for (let j = from; j < to; j += step){
      const v = Math.abs(ch[j]) + (ch2 ? Math.abs(ch2[j]) : 0);
      if (v > mx) mx = v;
    }
    peaks[i] = +Math.min(1, mx).toFixed(3);
  }
  return { peaks, dur:buf.duration, sampleRate:buf.sampleRate };
}
function wavChannelsToBlob(channels, sampleRate){
  const n = channels[0].length, channelCount = channels.length;
  const data = new Int16Array(n * channelCount);
  for (let i = 0; i < n; i++){
    for (let c = 0; c < channelCount; c++){
      const s = clamp(channels[c][i], -1, 1);
      data[i*channelCount+c] = s < 0 ? s*0x8000 : s*0x7fff;
    }
  }
  const dv = new DataView(new ArrayBuffer(44 + data.length*2));
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o+i, s.charCodeAt(i)); };
  const blockAlign = channelCount*2, dataBytes = data.length*2;
  wstr(0,"RIFF"); dv.setUint32(4, 36+dataBytes, true); wstr(8,"WAVEfmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channelCount, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate*blockAlign, true);
  dv.setUint16(32, blockAlign, true); dv.setUint16(34, 16, true);
  wstr(36,"data"); dv.setUint32(40, dataBytes, true);
  new Int16Array(dv.buffer, 44).set(data);
  return new Blob([dv.buffer], { type:"audio/wav" });
}
function wavToBlob(buffer, sampleRate){ return wavChannelsToBlob([buffer], sampleRate); }
/* MP3-Encodung (lamejs, wird als vendor/lamejs.iife.js in index.html geladen).
   Laeuft in Stuecken und gibt den Main-Thread zwischendurch frei, damit die
   Fortschrittsanzeige im Sheet fluessig bleibt. */
const EXPORT_ABORT = { name:"EXPORT_ABORTED" };   // Signal: Lauf wurde verworfen
let exportJob = 0;                                // erhoht sich bei Abbruch/Sheet-Zu
const nextTick = () => new Promise(r => setTimeout(r, 0));
function exportAlive(job){ return job === exportJob; }

async function mp3ChannelsToBlob(channels, sampleRate, kbps, report){
  if (!window.lamejs?.Mp3Encoder) return null;
  const tell = report || (() => {});
  const job = exportJob;
  const channelCount = Math.min(2, channels.length);
  const encoder = new lamejs.Mp3Encoder(channelCount, sampleRate, kbps || 192);
  const chunk = 1152*40, parts = [];
  const toI16 = ch => {
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++){
      const s = clamp(ch[i], -1, 1);
      out[i] = s < 0 ? s*0x8000 : s*0x7fff;
    }
    return out;
  };
  tell("Sample werden aufbereitet…", 0);
  await nextTick();
  const left = toI16(channels[0]);
  if (!exportAlive(job)) throw EXPORT_ABORT;
  const right = channelCount > 1 ? toI16(channels[1]) : null;
  let painted = 0;
  for (let pos = 0; pos < left.length; pos += chunk){
    if (!exportAlive(job)) throw EXPORT_ABORT;
    const end = Math.min(left.length, pos+chunk);
    let frame;
    if (channelCount > 1) frame = encoder.encodeBuffer(left.subarray(pos, end), right.subarray(pos, end));
    else frame = encoder.encodeBuffer(left.subarray(pos, end));
    if (frame.length) parts.push(frame);
    const now = performance.now();
    if (now - painted > 110 || end === left.length){
      tell("MP3 wird erstellt…", end/left.length); painted = now;
      await nextTick();
    }
  }
  if (!exportAlive(job)) throw EXPORT_ABORT;
  const tail = encoder.flush();
  if (tail.length) parts.push(tail);
  return new Blob(parts, { type:"audio/mpeg" });
}
/* M4A (AAC) geht nur in der nativen App: Browser haben keinen AAC-Encoder.
   Dem WAV wird dort im Native-Layer in eine M4A-Datei umgewandelt. */
function nativeM4aAvailable(){ return !!(NativeMedia && NativeMedia.beginAudioEncode); }
async function nativeM4aFile(name, wavBlob, report){
  const tell = report || (() => {});
  const job = exportJob;
  const started = await NativeMedia.beginAudioEncode({ name });
  const id = started.id;
  try{
    const chunkSize = 256*1024;
    for (let offset = 0; offset < wavBlob.size; offset += chunkSize){
      if (!exportAlive(job)){ await cancelNativeEncode(id); throw EXPORT_ABORT; }
      const bytes = new Uint8Array(await wavBlob.slice(offset, offset+chunkSize).arrayBuffer());
      await NativeMedia.writeAudioEncodeChunk({ id, offset, data:toBase64(bytes) });
      tell("Rohdaten an die App uebergeben…", Math.min(1, (offset+chunkSize)/wavBlob.size));
    }
    if (!exportAlive(job)){ await cancelNativeEncode(id); throw EXPORT_ABORT; }
    tell("M4A wird kodiert…", null, true);
    await NativeMedia.finishAudioEncode({ id, name });
  }catch(error){
    if (!exportAlive(job)){ await cancelNativeEncode(id); throw EXPORT_ABORT; }
    if (NativeMedia.cancelAudioEncode){
      try{ await NativeMedia.cancelAudioEncode({ id }); }
      catch(cleanupError){ console.warn("Temporary M4A-Datei konnte nicht entfernt werden:", cleanupError); }
    }
    throw error;
  }
}
async function cancelNativeEncode(id){
  if (!NativeMedia?.cancelAudioEncode) return;
  try{ await NativeMedia.cancelAudioEncode({ id }); }
  catch(error){ console.warn("Temporary M4A-Datei konnte nicht entfernt werden:", error); }
}
async function importFiles(files){
  if (!state.db.ok){ toast("Speicher nicht verfügbar – Import unmöglich", true); return; }
  // Erst anhand der Endung prüfen, dann (nachrangig) an der MIME-Art –
  // Android meldet .m4a z.T. als video/mp4 oder ohne MIME-Typ.
  const AUDIO_EXT = /\.(mp3|m4a|mp4|aac|ogg|oga|opus|wav|flac|webm)$/i;
  const looksAudio = f => AUDIO_EXT.test(f.name) || /^audio\//.test(f.type || "") ||
    (!AUDIO_EXT.test(f.name) && f.type === "video/mp4");
  const list = Array.from(files).filter(looksAudio);
  if (!list.length){ toast("Keine Audiodateien ausgewählt – unterstützt: mp3, m4a, aac, ogg, opus, wav, flac, webm", true); return; }
  state.ui.importing = true; state.ui.importTotal = list.length; state.ui.importDone = 0;
  renderCurrent();
  try{
    for (const file of list){
      const { artist, title } = parseName(file.name);
      const id = uid();
      let dur = 0, peaks = null;
      try{
        const ab = await file.arrayBuffer();
        const info = await computePeaks(ab, 1000);
        if (info){ dur = info.dur; peaks = info.peaks; }
      }catch(e){ /* Datei trotzdem importieren: Dauer dann beim ersten Abspielen ermittelt */ }
      if (!dur) dur = await probeDuration(file).catch(() => 0);
      const track = { id, title, artist, album:"", dur, fmt:(file.name.split(".").pop()||"?").toUpperCase(),
        size:file.size, name:file.name, icon:iconFor(id), added:Date.now(), peaks:peaks || null,
        lastPlay:0 };
      await idbPut("blobs", { id, blob:file });
      await idbPut("tracks", track);
      state.tracks.set(id, track);
      /* automatisch in die erste Playlist */
      const pl = state.playlists[0];
      pl.items.push({ id:uid(), trackId:id, cut:null });
      await savePlaylist(pl);
      state.ui.importDone++;
      if (state.ui.importing) renderCurrent();
    }
  }finally{
    state.ui.importing = false;
    renderCurrent();
  }
  toast(`✅ ${list.length} Titel importiert (${list.length===1?fmtBytes(list[0].size):"mehrere MB"})`);
}
function probeDuration(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { URL.revokeObjectURL(url);
      res(isFinite(a.duration) && a.duration > 0 ? a.duration : 0); };
    a.onerror = () => { URL.revokeObjectURL(url); rej(); };
    a.src = url;
  });
}
function updateRecordingUI(){
  const button = $("#recordBtn"), status = $("#recordingStatus");
  if (!button || !status) return;
  const active = recorderState.recorder?.state === "recording";
  button.textContent = recorderState.requesting ? "Mikrofon…" :
    recorderState.saving ? "Speichere…" : active ? "■ Aufnahme beenden" : "🎙 Aufnahme";
  button.dataset.act = active ? "record-stop" : "record-start";
  button.disabled = recorderState.requesting || recorderState.saving;
  if (!active && !recorderState.saving && !recorderState.requesting){ status.hidden = true; return; }
  status.hidden = false;
  status.textContent = recorderState.requesting ? "Mikrofonzugriff wird angefragt…" :
    recorderState.saving ? "Aufnahme wird in der Bibliothek gespeichert…" :
    "Aufnahme läuft · " + mmss((Date.now()-recorderState.startedAt)/1000);
}
function recordingFileName(mimeType){
  const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  return `BeatClip-Aufnahme_${stamp}.${ext}`;
}
async function startRecording(){
  if (recorderState.recorder || recorderState.requesting || recorderState.saving) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined"){
    toast("Mikrofonaufnahme wird von diesem Browser nicht unterstützt", true); return;
  }
  let stream;
  recorderState.requesting = true;
  updateRecordingUI();
  try{
    stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const preferred = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm"];
    const mimeType = preferred.find(type => MediaRecorder.isTypeSupported?.(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderState.requesting = false;
    recorderState.stream = stream;
    recorderState.recorder = recorder;
    recorderState.chunks = [];
    recorderState.startedAt = Date.now();
    recorder.ondataavailable = event => { if (event.data.size) recorderState.chunks.push(event.data); };
    recorder.onerror = event => {
      console.error("Aufnahmefehler:", event.error);
      toast("Aufnahmefehler: " + (event.error?.message || "Mikrofonaufnahme fehlgeschlagen"), true);
    };
    recorder.onstop = async () => {
      const blob = new Blob(recorderState.chunks, { type:recorder.mimeType || "audio/webm" });
      const name = recordingFileName(blob.type);
      recorderState.recorder = null;
      recorderState.saving = true;
      recorderState.stream?.getTracks().forEach(track => track.stop());
      recorderState.stream = null;
      clearInterval(recorderState.timer);
      updateRecordingUI();
      try{
        if (!blob.size) throw new Error("Die Aufnahme enthält keine Audiodaten");
        await importFiles([new File([blob], name, { type:blob.type })]);
      }catch(error){
        console.error("Aufnahme konnte nicht gespeichert werden:", error);
        toast("Aufnahme konnte nicht gespeichert werden: " + error.message, true);
      }finally{
        recorderState.chunks = [];
        recorderState.saving = false;
        renderCurrent();
      }
    };
    audio.pause();
    recorder.start(1000);
    renderCurrent();
    updateRecordingUI();
    recorderState.timer = setInterval(updateRecordingUI, 500);
    toast("Aufnahme gestartet");
  }catch(error){
    stream?.getTracks().forEach(track => track.stop());
    recorderState.recorder = null;
    recorderState.stream = null;
    recorderState.requesting = false;
    recorderState.chunks = [];
    recorderState.saving = false;
    updateRecordingUI();
    console.error("Mikrofonaufnahme konnte nicht gestartet werden:", error);
    toast("Mikrofon nicht verfügbar: " + (error.message || "Berechtigung verweigert"), true);
  }
}
function stopRecording(){
  if (recorderState.recorder?.state !== "recording" || recorderState.saving) return;
  recorderState.saving = true;
  clearInterval(recorderState.timer);
  updateRecordingUI();
  recorderState.recorder.stop();
}
function safeFileBase(name){
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim() || "BeatClip";
}
async function extractChannels(trackId){
  const t = track(trackId);
  if (!t || !idb){ toast("Audiodatei nicht verfügbar", true); return; }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass){ toast("Audio-Extraktion wird von diesem Gerät nicht unterstützt", true); return; }
  let context;
  try{
    const rec = await new Promise((resolve, reject) => {
      const request = idb.transaction("blobs", "readonly").objectStore("blobs").get(trackId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Datei konnte nicht gelesen werden"));
    });
    if (!rec?.blob) throw new Error("Audiodatei nicht im lokalen Speicher gefunden");
    context = new AudioContextClass();
    const buffer = await context.decodeAudioData(await rec.blob.arrayBuffer());
    if (buffer.numberOfChannels < 2){
      toast("Diese Datei enthält nur einen Kanal – Stereo-Extraktion ist nicht möglich", true); return;
    }
    const labels = buffer.numberOfChannels === 2 ? ["Links", "Rechts"] :
      Array.from({ length:buffer.numberOfChannels }, (_, i) => `Kanal ${i+1}`);
    channelExportData = { base:safeFileBase(t.title),
      buffers:labels.map((_, index) => buffer.getChannelData(index)),
      sampleRate:buffer.sampleRate, names:labels };
    openChannelExportSheet(t);
  }catch(error){
    console.error("Kanäle konnten nicht extrahiert werden:", error);
    toast("Kanäle konnten nicht extrahiert werden: " + (error.message || "Unbekannter Fehler"), true);
  }finally{
    if (context && context.state !== "closed"){
      try{ await context.close(); }catch(error){ console.warn("AudioContext konnte nicht geschlossen werden:", error); }
    }
  }
}
const EXPORT_FORMATS = {
  wav:{ ext:"wav", label:"WAV",  mime:"audio/wav",  desc:"WAV-Audiodatei" },
  mp3:{ ext:"mp3", label:"MP3",  mime:"audio/mpeg", desc:"MP3-Audiodatei" },
  m4a:{ ext:"m4a", label:"M4A",  mime:"audio/mp4",  desc:"M4A-Audiodatei" },
};
function clearChannelExports(){
  exportJob++;                       // laufende Encodings verwerfen
  for (const item of channelExportFiles){
    for (const entry of Object.values(item.formats)){
      if (entry?.url) URL.revokeObjectURL(entry.url);
    }
  }
  channelExportFiles = [];
  channelExportData = null;
  channelExportTrack = null;
  channelExportFormat = "wav";
  state.ui.exportBusy = null;
}
/* Fortschritt im Sheet anzeigen: Label + Balken, ratio null = unbestimmt.
   locked = true, waehrend der System-Speicherdialog laeuft (nicht abbrechbar). */
function exportStatus(label, ratio, locked){
  const pct = ratio == null ? null : clamp(Math.round(ratio*100), 0, 100);
  const prev = state.ui.exportBusy;
  state.ui.exportBusy = label ? { label, pct, locked:!!locked } : null;
  if (!label || !prev || prev.label !== label || prev.pct !== pct || prev.locked !== !!locked) renderChannelExportSheet();
}
function openChannelExportSheet(t){
  channelExportTrack = t;
  channelExportFiles = channelExportData.names.map(() => ({ formats:{} }));
  renderChannelExportSheet();
}
function renderChannelExportSheet(){
  const d = channelExportData, t = channelExportTrack;
  if (!d || !t) return;
  const busy = state.ui.exportBusy;
  const m4aOn = nativeM4aAvailable();
  const chips = ["wav", "mp3", "m4a"].map(f => {
    const off = f === "m4a" && !m4aOn;
    return '<span class="chip' + (channelExportFormat === f ? ' on' : '') + (off ? ' chipOff' : '') + '"' +
      (off ? ' title="M4A gibts nur in der nativen BeatClip-App"' : '') +
      ' data-act="export-format" data-fmt="' + f + '">' + EXPORT_FORMATS[f].label + '</span>';
  }).join("");
  const rows = d.names.map((name, index) => {
    const dis = busy ? ' disabled' : '';
    return '<div class="channelExportRow"><div class="rowInfo"><div class="rowTitle">' +
      esc(d.base + "_" + name) + '.' + EXPORT_FORMATS[channelExportFormat].ext +
      '</div><div class="rowSub">Kanal: ' + esc(name) + '</div></div>' +
      '<button class="btn small primary" data-act="save-channel" data-index="' + index + '"' + dis + '>⬇ Speichern</button>' +
      '<button class="btn small" data-act="share-channel" data-index="' + index + '"' + dis + '>Teilen</button></div>';
  }).join("");
  // Rueckmeldung, solange kodiert/uebertragen wird (dauert bei langen Titeln).
  const status = busy
    ? '<div class="exportStatus"><div class="rowTitle"><span class="spin"></span> ' + esc(busy.label) +
      (busy.pct == null ? '' : ' ' + busy.pct + '%') + '</div>' +
      (busy.pct == null ? '<div class="progress indet"><i></i></div>'
                        : '<div class="progress"><i style="width:' + busy.pct + '%"></i></div>') +
      (busy.locked ? '' : '<div class="exportHint">Das kann bei langen Titeln einen Moment dauern – Schliessen bricht ab.</div>') +
      '</div>'
    : "";
  openSheet('<div class="grab"></div><h2>🎚 Kanäle extrahiert</h2>' +
    '<div class="sub">' + esc(t.title) + ' · ' + d.names.length + ' Mono-Kanal' +
    (d.names.length > 1 ? "e" : "") + ' – Format waehlen, dann speichern oder teilen</div>' +
    '<div class="chipRow' + (busy ? ' chipBusy' : '') + '">' + chips + '</div>' +
    status + rows + '<div class="sheetbtns"><button class="btn" data-act="sheet-close"' +
    (busy && busy.locked ? ' disabled' : '') + '>Fertig</button></div>', true);
}
/* Liefert (und cacht) die Exportdatei eines Kanals im gewaehlten Format.
   report(label, ratio) uebernimmt die Fortschrittsanzeige im Sheet. */
async function exportFile(index, report){
  const d = channelExportData, f = channelExportFormat;
  const item = channelExportFiles[index];
  if (!d || !item) return null;
  if (item.formats[f]) return item.formats[f].file;
  const meta = EXPORT_FORMATS[f];
  const name = `${d.base}_${d.names[index]}.${meta.ext}`;
  const tell = report || (() => {});
  let file = null;
  if (f === "wav"){
    tell("WAV wird erstellt…", 0.5);
    file = new File([wavChannelsToBlob([d.buffers[index]], d.sampleRate)], name, { type:meta.mime });
  }else if (f === "mp3"){
    const blob = await mp3ChannelsToBlob([d.buffers[index]], d.sampleRate, 192, tell);
    if (!blob){ toast("MP3-Encoder nicht verfuegbar (vendor/lamejs.iife.js fehlt)", true); return null; }
    file = new File([blob], name, { type:meta.mime });
  }else if (f === "m4a"){
    if (!nativeM4aAvailable()){ toast("M4A ist nur in der nativen BeatClip-App verfuegbar", true); return null; }
    return null; // wird direkt nativ codiert und gespeichert
  }
  if (!file) return null;
  item.formats[f] = { file, url:URL.createObjectURL(file) };
  return file;
}
async function exportUrl(index){
  const file = await exportFile(index);
  const item = channelExportFiles[index];
  return file && item?.formats[channelExportFormat]?.url || null;
}
function toBase64(bytes){
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000){
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset+0x8000, bytes.length)));
  }
  return btoa(binary);
}
async function saveChannelExport(index){
  if (state.ui.exportBusy) return;
  const f = channelExportFormat;
  const meta = EXPORT_FORMATS[f];
  const d = channelExportData;
  if (!d) { toast("Exportdatei nicht mehr verfügbar", true); return; }
  const job = exportJob;
  const name = `${d.base}_${d.names[index]}.${meta.ext}`;
  let exportId = null;
  const dropTemp = async () => {
    if (!exportId || !NativeMedia?.cancelAudioExport) return;
    try{ await NativeMedia.cancelAudioExport({ id:exportId }); }
    catch(cleanupError){ console.error("Temporäre Exportdatei konnte nicht entfernt werden:", cleanupError); }
  };
  try{
    if (f === "m4a"){
      if (!nativeM4aAvailable()){ toast("M4A ist nur in der nativen BeatClip-App verfuegbar", true); return; }
      exportStatus("WAV-Zwischendaten werden erstellt…", 0);
      await nativeM4aFile(name, wavChannelsToBlob([d.buffers[index]], d.sampleRate), exportStatus);
      toast("Datei gespeichert");
      return;
    }
    const file = await exportFile(index, exportStatus);
    if (!file){ toast("Exportdatei nicht mehr verfügbar", true); return; }
    if (NATIVE && NativeMedia?.beginAudioExport && NativeMedia?.writeAudioExportChunk && NativeMedia?.saveAudioExport){
      if (!exportAlive(job)) throw EXPORT_ABORT;
      const started = await NativeMedia.beginAudioExport({ name:file.name });
      exportId = started.id;
      const chunkSize = 256*1024;
      for (let offset = 0; offset < file.size; offset += chunkSize){
        if (!exportAlive(job)) throw EXPORT_ABORT;
        const bytes = new Uint8Array(await file.slice(offset, offset+chunkSize).arrayBuffer());
        await NativeMedia.writeAudioExportChunk({ id:exportId, offset, data:toBase64(bytes) });
        exportStatus("Datei an den Speicherdialog uebergeben…", Math.min(1, (offset+chunkSize)/file.size));
      }
      if (!exportAlive(job)) throw EXPORT_ABORT;
      exportStatus("Speicherdialog wird geoeffnet…", null, true);
      await NativeMedia.saveAudioExport({ id:exportId, name:file.name, mime:meta.mime });
      exportId = null;
      toast("Datei gespeichert");
      return;
    }
    if (window.showSaveFilePicker){
      exportStatus("Speicherdialog wird geoeffnet…", null, true);
      const handle = await window.showSaveFilePicker({
        suggestedName:file.name,
        types:[{ description:meta.desc, accept:{ [meta.mime]:["."+meta.ext] } }],
      });
      exportStatus("Datei wird geschrieben…", null, true);
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      toast("Datei gespeichert");
      return;
    }
    const url = await exportUrl(index);
    if (!url){ toast("Exportdatei nicht mehr verfügbar", true); return; }
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast("Download gestartet");
  }catch(error){
    await dropTemp();
    if (error === EXPORT_ABORT){ toast("Export abgebrochen"); return; }
    if (error?.code !== "USER_CANCELLED" && error?.name !== "AbortError"){
      console.error("Datei konnte nicht gespeichert werden:", error);
      toast("Datei konnte nicht gespeichert werden: " + (error?.message || "Unbekannter Fehler"), true);
    }
  }finally{
    if (exportAlive(job)) exportStatus(null);
  }
}
/* Demo-Titel (synthetische WAVs), falls keine echten Dateien griffbereit */
async function importDemoTracks(){
  if (!state.db.ok){ toast("Speicher nicht verfügbar", true); return; }
  const demos = [
    { name:"Beispiel-Künstler - Morgenhook.wav", secs:24, base:220, beat:2.0 },
    { name:"Beispiel-Künstler - Refrain-Wiederholung.wav", secs:30, base:330, beat:1.5 },
    { name:"Beispiel-Künstler - Nachtloop.wav", secs:20, base:160, beat:2.5 },
  ];
  state.ui.importing = true; state.ui.importTotal = demos.length; state.ui.importDone = 0; renderCurrent();
  for (const d of demos){
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OC(1, Math.ceil(d.secs*44100), 44100);
    const master = ctx.createGain(); master.gain.value = .5; master.connect(ctx.destination);
    for (let t = 0; t < d.secs; t += .5){
      const o = ctx.createOscillator(), g = ctx.createGain();
      const beat = (Math.floor(t/d.beat) % 4) === 0;
      o.frequency.value = d.base * (beat ? 1 : (1 + ((Math.floor(t)+d.base)%3)*.25));
      o.type = beat ? "triangle" : "sine";
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(beat ? .9 : .45, t + .04);
      g.gain.exponentialRampToValueAtTime(.001, t + .48);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + .5);
    }
    const rendered = await ctx.startRendering();
    const blob = wavToBlob(rendered.getChannelData(0), 44100);
    blob.name = d.name;
    await importFiles([blob]);
  }
  state.ui.importing = false; renderCurrent();
}

/* ─────────────────────── Wiedergabe-Engine ───────────────────────────── */
const audio = $("#audio");
let urlCache = new Map();   // trackId -> objectURL
let endWatchdog = null;
const blobURL = async trackId => {
  if (urlCache.has(trackId)) return urlCache.get(trackId);
  const rec = await new Promise(res => {
    const rq = idb.transaction("blobs","readonly").objectStore("blobs").get(trackId);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
  });
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(trackId, url);
  return url;
};
const track = id => state.tracks.get(id);
const playlist = id => state.playlists.find(p => p.id === id);
const currentItem = () => {
  if (state.qIndex < 0 || !state.queue[state.qIndex]) return null;
  const pl = state.playlists.find(p => p.items.some(i => i.id === state.queue[state.qIndex]));
  return pl ? { pl, it:pl.items.find(i => i.id === state.queue[state.qIndex]) } : null;
};
function span(){
  const t = track(state.player.trackId); if (!t) return null;
  const c = currentItem();
  const cut = c ? c.it.cut : null;
  const start = cut ? Math.min(cut.start, t.dur) : 0;
  const end   = cut ? Math.min(cut.end, t.dur)   : (audio.duration && isFinite(audio.duration) ? audio.duration : t.dur);
  return { start, end, len:Math.max(0.01, end-start), dur:t.dur };
}
async function playQueue(plId, itemLocalId){
  const pl = playlist(plId); if (!pl || !pl.items.length){ toast("Playlist ist leer", true); return; }
  state.queue = pl.items.map(i => i.id);
  const idx = state.queue.indexOf(itemLocalId);
  await playItem(state.queue[idx < 0 ? 0 : idx], plId);
}
async function playItem(qItem, plId){
  const pl = playlist(plId) || state.playlists.find(p => p.items.some(i => i.id === qItem));
  if (!pl) return;
  const it = pl.items.find(i => i.id === qItem);
  const t = track(it.trackId); if (!t) return;
  const url = await blobURL(it.trackId);
  if (!url){ toast("Datei nicht mehr im Speicher gefunden", true); return; }

  state.queue = pl.items.map(i => i.id);
  state.qIndex = state.queue.indexOf(qItem);
  state.player.trackId = it.trackId;

  audio.src = url;
  audio.volume = state.settings.volume;
  audio.currentTime = 0;
  const cut = it.cut;
  const from = cut ? cut.start : 0;

  await new Promise(res => {
    if (audio.readyState >= 2) return res();
    const done = () => { audio.removeEventListener("loadedmetadata", done); res(); };
    audio.addEventListener("loadedmetadata", done);
    setTimeout(done, 1500);
  });
  if (t.dur !== audio.duration && isFinite(audio.duration) && audio.duration > 0){
    t.dur = audio.duration; idbPut("tracks", t);
  }
  try{ audio.currentTime = clamp(from, 0, audio.duration); }catch(e){}
  await audio.play();
  state.player.playing = true;
  if (t.dur !== audio.duration && isFinite(audio.duration) && audio.duration > 0){
    t.dur = audio.duration; idbPut("tracks", t);
  }
  t.lastPlay = Date.now(); idbPut("tracks", t);
  armEndWatchdog();
  setupIOSAudioSession();
  updateMediaSession();
  nativeStartSession();
  if (state.settings.fade > 0) fadeIn();
  renderMini(); refreshCurrent();
}
function armEndWatchdog(){
  clearTimeout(endWatchdog);
  const s = span(); if (!s) return;
  const ahead = Math.max(0.05, s.end - audio.currentTime - 0.05);
  endWatchdog = setTimeout(() => {
    const s2 = span(); if (!s2) return;
    if (audio.currentTime >= s2.end - 0.06) onCutEnd();
    else armEndWatchdog();
  }, ahead*1000);
}
function onCutEnd(){
  const done = track(state.player.trackId);
  if (state.settings.repeat === "one"){
    const s = span(); audio.currentTime = s.start; armEndWatchdog(); return;
  }
  if (state.qIndex >= state.queue.length-1 && state.settings.repeat === "off"){
    audio.pause(); state.player.playing = false;
    nativeStopSession();
    toast(`⏹ „${done.title}“ zu Ende (Schnitt-Ende ${mmssPrecise(span().end)})`);
    renderMini(); refreshCurrent(); return;
  }
  nextTrack(false);
  toast(`↦ „${done ? done.title : ""}“ fertig · Schnitt-Ende bei ${mmssPrecise(span().end)}`);
}
async function nextTrack(manual){
  clearTimeout(endWatchdog);
  if (!state.queue.length) return;
  const s = span();
  if (state.settings.shuffle && state.queue.length > 1){
    let i; do { i = Math.floor(Math.random()*state.queue.length); } while (i === state.qIndex);
    return playItem(state.queue[i], currentItem()?.pl.id);
  }
  if (s && s.end - audio.currentTime < 1){
    audio.currentTime = clamp(s.start, 0, audio.duration); armEndWatchdog(); return;
  }
  let idx = state.qIndex + 1;
  if (idx >= state.queue.length){
    if (state.settings.repeat === "off" && !manual){ audio.pause(); state.player.playing=false; renderMini(); refreshCurrent(); return; }
    idx = 0;
  }
  playItem(state.queue[idx], currentItem()?.pl.id);
}
async function prevTrack(){
  const s = span();
  if (s && audio.currentTime - s.start > 3){ audio.currentTime = s.start; armEndWatchdog(); return; }
  clearTimeout(endWatchdog);
  let idx = state.qIndex - 1; if (idx < 0) idx = state.queue.length - 1;
  playItem(state.queue[idx], currentItem()?.pl.id);
}
async function togglePlay(){
  if (!state.player.trackId){
    const pl = state.playlists.find(p => p.items.length);
    if (pl && pl.items.length) return playQueue(pl.id, pl.items[0].id);
    toast("Keine Titel – bitte zuerst Audiodateien importieren", true); return;
  }
  if (audio.paused){ await audio.play(); state.player.playing = true; }
  else { audio.pause(); state.player.playing = false; }
  // Nach einem Stop (Schnitt-Ende) laeuft der native Dienst nicht mehr -> neu starten,
  // sonst fehlen Sperrbildschirm/Hintergrund-Wiedergabe.
  if (state.player.playing && !nativeSessionOn) nativeStartSession();
  else nativeSync(true);
  renderMini(); refreshCurrent();
}
/* Blendzeit an den Schnittkanten (dezenter Gain-Ramp über audio.volume) */
function fadeIn(){
  const target = state.settings.volume, d = Math.max(.05, state.settings.fade);
  const t0 = performance.now();
  const iv = setInterval(() => {
    const p = (performance.now()-t0)/(d*1000);
    if (p >= 1){ audio.volume = target; clearInterval(iv); return; }
    if (!audio.paused) audio.volume = target*p;
  }, 40);
}
function fadeOutThen(cb){
  const d = Math.max(.05, state.settings.fade);
  if (!d || !state.settings.gapless){ cb(); return; }
  const target = state.settings.volume, t0 = performance.now();
  const iv = setInterval(() => {
    const p = (performance.now()-t0)/(d*1000);
    if (p >= 1){ clearInterval(iv); audio.volume = 0; cb(); return; }
    audio.volume = target*(1-p);
  }, 40);
}

/* Ende des Schnitts zuverlässig erkennen: rAF + timeupdate + Watchdog */
let lastPos = -1, lastAdvance = 0, stalledNotified = false;
function loop(){
  if (state.player.playing && !audio.paused){
    const s = span();
    if (s && audio.currentTime >= s.end - 0.02){ onCutEnd(); }
    else {
      if (!lastAdvance) lastAdvance = performance.now();
      if (audio.currentTime !== lastPos){
        lastPos = audio.currentTime; lastAdvance = performance.now(); stalledNotified = false;
      } else if (!stalledNotified && audio.readyState >= 2 && !audio.seeking &&
                 performance.now() - lastAdvance > 4000){
        stalledNotified = true;
        console.warn("Wiedergabe steht still bei " + audio.currentTime + "s (readyState " + audio.readyState + ")");
        toast("⚠️ Der Ton steht still – Lautstärke/Bluetooth prüfen", true);
      }
      renderMini(true);
      if (state.screen === "player") updatePlayerUI();
      if (state.ui.editTrack && $("#sheet").classList.contains("open")) updateEditorHead();
      updateMediaPosition();
      nativeSync();
    }
  }
  else { lastAdvance = 0; }
  requestAnimationFrame(loop);
}
audio.addEventListener("timeupdate", () => { const s = span(); if (s && audio.currentTime >= s.end - 0.02) onCutEnd(); });
audio.addEventListener("ended", () => onCutEnd());
audio.addEventListener("pause", () => { if (state.player.playing){ state.player.playing = false; renderMini(); refreshCurrent(); } });
audio.addEventListener("play",  () => { if (!state.player.playing){ state.player.playing = true; renderMini(); refreshCurrent(); } });

audio.addEventListener("error", () => {
  if (!audio.error) return;   // src entfernt = kein Fehler
  const why = ["", "abgebrochen", "Netzwerk", "Dekodierung", "Format nicht unterstuetzt"][audio.error.code] || "unbekannt";
  console.error("Audio-Fehler:", audio.error.code, audio.error.message);
  toast("Audio-Fehler: " + why + " – anderes Format testen", true);
});

/* ────────────────── Bluetooth / iOS Audio-Session / Media Session ─────── */
async function setupIOSAudioSession(){
  if (NATIVE) return; // in der nativen iOS-App uebernimmt das Plugin (AVAudioSession)
  try{
    if (audio.setActiveMediaElement && typeof audio.setActiveMediaElement === "function"){
      await audio.setActiveMediaElement(true);
    }
  }catch(e){ /* nur Safari on iOS/iPadOS/Mac */ }
}
function artCanvas(size){
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0,0,size,size);
  gr.addColorStop(0,"#00b8a9"); gr.addColorStop(1,"#0e7490");
  g.fillStyle = gr; g.fillRect(0,0,size,size);
  g.font = `${Math.floor(size*.55)}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(track(state.player.trackId)?.icon || "🎧", size/2, size/2 + size*.03);
  return c;
}
let artURL = null;
function updateMediaSession(){
  // In der nativen Android-App uebernimmt die Android-MediaSession (Sperrbildschirm,
  // Benachrichtigung, BT-Tasten). Eine zweite Media Session wuerde konkurrenzieren.
  if (NATIVE) return;
  if (!("mediaSession" in navigator)) return;
  const t = track(state.player.trackId); if (!t) return;
  if (artURL) URL.revokeObjectURL(artURL);
  artURL = artCanvas(512).toDataURL("image/png");
  navigator.mediaSession.metadata = new MediaMetadata({
    title:t.title, artist:t.artist, album:t.album || "BeatClip (offline)",
    artwork:[ { src:artURL, sizes:"512x512", type:"image/png" } ],
  });
  navigator.mediaSession.setActionHandler("play",  () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => prevTrack());
  navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(true));
  navigator.mediaSession.setActionHandler("seekto", d => {
    const s = span(); if (!s) return;
    audio.currentTime = clamp(d.seekTime, s.start, s.end); armEndWatchdog();
  });
  updatePlaybackState();
}
function updatePlaybackState(){
  if (!("mediaSession" in navigator)) return;
  try{ navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing"; }catch(e){}
}
function updateMediaPosition(){
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const s = span(); if (!s || !isFinite(audio.duration)) return;
  try{
    navigator.mediaSession.setPositionState({
      duration:audio.duration,
      playbackRate:audio.playbackRate || 1,
      position:clamp(audio.currentTime, 0, audio.duration),
    });
  }catch(e){}
}
function refreshBtInfo(){
  if (NATIVE){ state.bt.label = NATIVE_OS === "iOS" ? "Now Playing / AirPlay" : "Android Media-Ausgabe"; $("#btLabel").textContent = state.bt.label; return; }
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  state.bt.label = iOS ? "AirPlay / BT" : "Bluetooth möglich";
  $("#btLabel").textContent = state.bt.label;
}
/* ═══════════════════════════════════════════════════════════════════════
   Native Android-Bruecke (Capacitor): Media-Benachrichtigung, Hintergrund-
   wiedergabe, Bluetooth-/Headset-Tasten und per "Teilen" uebernommene Dateien
   ═══════════════════════════════════════════════════════════════════════ */
const NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function"
                  && window.Capacitor.isNativePlatform());
const NativeMedia = NATIVE && window.Capacitor.Plugins ? (window.Capacitor.Plugins.BeatClipMedia || null) : null;
const NATIVE_OS = (NATIVE && window.Capacitor.platform === "ios") ? "iOS" : "Android";
let nativeSessionOn = false, nativeLastSync = 0;

function nativeSync(force){
  if (!NativeMedia) return;
  const now = Date.now();
  if (!force && now - nativeLastSync < 1500) return;
  nativeLastSync = now;
  const t = track(state.player.trackId); if (!t) return;
  const dur = (audio.duration && isFinite(audio.duration)) ? audio.duration : (t.dur || 0);
  NativeMedia.updateSession({
    title: t.title, artist: t.artist || "BeatClip",
    playing: !audio.paused,
    positionMs: Math.round(clamp(audio.currentTime, 0, dur) * 1000),
    durationMs: Math.round(dur * 1000),
  }).catch(() => {});
}
function nativeStartSession(){
  if (!NativeMedia) return;
  const t = track(state.player.trackId); if (!t) return;
  nativeSessionOn = true;
  let art = null;
  try{ art = artCanvas(320).toDataURL("image/png"); }catch(e){}
  NativeMedia.startSession({
    title: t.title, artist: t.artist || "BeatClip", playing: true,
    durationMs: Math.round((t.dur || 0) * 1000),
    art,
  }).then(() => nativeSync(true)).catch(() => {});
}
function nativeStopSession(){
  if (NativeMedia && nativeSessionOn){ nativeSessionOn = false; NativeMedia.stopSession({}).catch(() => {}); }
}
function mimeFor(name){
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  return { mp3:"audio/mpeg", m4a:"audio/mp4", mp4:"audio/mp4", aac:"audio/aac", ogg:"audio/ogg",
           oga:"audio/ogg", opus:"audio/ogg", wav:"audio/wav", flac:"audio/flac", webm:"audio/webm" }[ext] || "application/octet-stream";
}
/* Dateien uebernehmen, die aus einer anderen App nach BeatClip geteilt wurden */
async function importSharedFiles(){
  if (!NativeMedia) return;
  let files;
  try{ files = (await NativeMedia.getSharedFiles()).files || []; }catch(e){ return; }
  if (!files.length) return;
  for (const f of files){
    try{
      const chunks = [];
      let offset = 0;
      for(;;){
        const r = await NativeMedia.readSharedFile({ name: f.name, offset });
        const bin = atob(r.data), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        chunks.push(u8);
        offset += u8.length;
        if (r.eof || offset >= r.size) break;
      }
      const blob = new Blob(chunks, { type: mimeFor(f.name) });
      await importFiles([ new File([blob], f.name, { type: blob.type }) ]);
      await NativeMedia.deleteSharedFile({ name: f.name });
    }catch(e){ toast(`„${f.name}“ konnte nicht uebernommen werden`, true); }
  }
}
async function checkMediaStatus(){
  if (!NativeMedia){ toast("Nur in der nativen App verfuegbar", true); return; }
  try{
    const perm = await NativeMedia.notificationPermission();
    const st = await NativeMedia.getStatus();
    const shared = Array.isArray(st.shared) ? st.shared.length : (st.shared || 0);
    openSheet('<div class="grab"></div><h2>🔔 Wiedergabe-Status</h2>' +
      '<div class="kv"><span class="k">Benachrichtigungen</span><span class="v" style="font-size:13px">' +
        (perm.granted ? "erlaubt ✅" : (perm.permanentlyDenied ? "dauerhaft abgelehnt ❌" : "nicht gesetzt ⚠️")) + '</span></div>' +
      '<div class="kv"><span class="k">Hintergrund-Dienst</span><span class="v" style="font-size:13px">' +
        (st.serviceRunning ? "aktiv ✅" : "inaktiv") + '</span></div>' +
      '<div class="kv"><span class="k">Geteilte Dateien</span><span class="v" style="font-size:13px">' + shared + '</span></div>' +
      (perm.granted ? "" :
        '<div class="infoBlock">Ohne Benachrichtigungen zeigt ' + NATIVE_OS + ' die Medienleiste moeglicherweise nicht an. Abspielen funktioniert trotzdem; unter Einstellungen → Apps → BeatClip kannst du Benachrichtigungen erlauben.</div>') +
      '<div class="sheetbtns"><button class="btn" data-act="sheet-close">Schliessen</button>' +
      '<button class="btn primary" data-act="media-perm">Erlaubnis anfragen</button></div>');
  }catch(e){ toast("Status nicht abrufbar", true); }
}
async function askMediaPermission(){
  if (!NativeMedia) return;
  try{
    const p = await NativeMedia.notificationPermission();
    toast(p.granted ? "Benachrichtigungen erlaubt ✅" : "Keine Berechtigung – Medienleiste evtl. versteckt", !p.granted);
  }catch(e){}
  closeSheet();
}
function setupNativeBridge(){
  if (!NativeMedia) return;
  NativeMedia.addListener("mediaAction", ev => {
    switch (ev.action){
      case "play":  audio.play().catch(() => {}); break;
      case "pause": audio.pause(); break;
      case "next":  nextTrack(true); break;
      case "prev":  prevTrack(); break;
      case "seek": {
        const s = span();
        if (s && typeof ev.positionMs === "number"){
          audio.currentTime = clamp(ev.positionMs/1000, s.start, s.end); armEndWatchdog();
        }
        break;
      }
      case "stop":
        audio.pause(); state.player.playing = false; renderMini(); refreshCurrent();
        nativeStopSession();
        break;
    }
    nativeSync(true);
  });
  // Android meldet die Benachrichtigungs-Erlaubnis -> Benachrichtigung nachziehen
  window.beatclipPermissionGranted = () => { if (state.player.trackId) nativeSync(true); importSharedFiles(); };
  // iOS (wie Android-Warmstart): "Offnen in -> BeatClip" kann die App treffen,
  // waehrend die Web-UI schon laeuft -> beim Zurueckkehren Posteingang abholen.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") importSharedFiles();
  });
  importSharedFiles();
}
/* ═══════════════════════════════════════════════════════════════════════
   Teil 2: UI (Screens, Waveform-Editor, Navigation, Aktionen, Init)
   ═══════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── Navigation ──────────────────────────────── */
const TABS = ["home","playlists","library","set"];
const RENDER = { home:renderHome, playlists:renderPlaylists, pl:renderPlDetail,
  library:renderLibrary, set:renderSet, player:renderPlayer, about:renderAbout };
function go(screen, push){
  if (push !== false && screen !== state.screen) state.stack.push(state.screen);
  state.screen = screen;
  $$(".screen").forEach(s => s.classList.remove("active"));
  $("#s-"+screen).classList.add("active");
  $$(".nav").forEach(n => n.classList.toggle("active", n.dataset.nav === (TABS.includes(screen) ? screen : null)));
  $("#btnBack").hidden = TABS.includes(screen);
  updateAppBar();
  RENDER[screen]();
  $("#s-"+screen).scrollTop = 0;
  history.replaceState(null, "", "#" + screen);
}
function back(){ const prev = state.stack.pop() || "home"; go(prev, false); }
function refreshCurrent(){ RENDER[state.screen](); }
function renderCurrent(){ refreshCurrent(); }
function updateAppBar(){
  $("#abFolder").textContent = "📁 " + state.tracks.size + " Titel" + (state.db.ok ? " offline" : "");
}
$$(".nav").forEach(n => n.addEventListener("click", () => go(n.dataset.nav, false)));

/* ─────────────────────────── Sheet / Dialoge ─────────────────────────── */
function openSheet(html, keepChannelExports){ if (!keepChannelExports) clearChannelExports();
  $("#sheet").innerHTML = html; $("#sheet").classList.add("open");
  $("#overlay").classList.add("open"); }
function closeSheet(){ $("#sheet").classList.remove("open"); $("#overlay").classList.remove("open");
  state.ui.editTrack = null; clearChannelExports(); }
$("#overlay").addEventListener("click", closeSheet);

/* ─────────────────────────── Screen: START ───────────────────────────── */
function renderHome(){
  const tracks = Array.from(state.tracks.values());
  $("#abSub").textContent = state.db.ok ? "Offline-Player mit Schnittfunktion"
    : "Warnung: Speicher nicht verfuegbar (privater Modus?)";
  updateAppBar();
  let html = '<div class="pad">';
  if (!state.db.ok) html += '<div class="warnbox err">IndexedDB ist blockiert (Safari privater Modus?). ' +
    'App im normalen Modus oeffnen, dann funktionieren Import und gespeicherte Schnitte.</div>';
  if (state.player.trackId){
    const t = track(state.player.trackId), s = span(), c = currentItem();
    html += '<div class="sectionHeading">Laeuft gerade <span class="line"></span></div>' +
      '<div class="panel"><div class="row64" data-act="go-player">' +
      '<div class="cover36">' + t.icon + '</div>' +
      '<div class="rowInfo"><div class="rowTitle">' + esc(t.title) + '</div>' +
      '<div class="rowSub">' + esc(t.artist) + " · " + (c?.it.cut ? "Schnitt " + mmssPrecise(s.start) + "-" + mmssPrecise(s.end) : "ganzer Titel") + '</div></div>' +
      '<div class="rowRight"><span class="dot ' + (state.player.playing?"dotPlay":"") + '"></span></div>' +
      '</div></div>';
  }
  if (!tracks.length){
    html += '<div class="panel" style="margin-top:14px"><div class="empty">' +
      '<span class="big">🎵</span>Noch keine Musik auf diesem Geraet.<br>' +
      'Audiodateien importieren - sie bleiben lokal im Speicher des Handys.' +
      '<div class="btnrow">' +
      '<button class="btn primary" data-act="pick-files">⬇ Audiodateien waehlen</button>' +
      '<button class="btn" data-act="demo-tracks">Demo-Titel erzeugen</button>' +
      '</div></div></div>';
  }
  html += '<div class="sectionHeading">Playlists <span class="line"></span></div><div class="grid">';
  state.playlists.forEach(pl => {
    const cuts = pl.items.filter(i => i.cut).length;
    html += '<div class="card" data-act="open-pl" data-pl="' + pl.id + '">' +
      '<div class="cover">' + pl.cover + '</div>' +
      '<div class="name">' + esc(pl.name) + '</div>' +
      '<div class="meta">' + pl.items.length + " Titel" + (cuts ? " · ✂ " + cuts : "") + '</div>' +
      '</div>';
  });
  html += '</div>';
  const recent = tracks.slice().sort((a,b) => (b.lastPlay||b.added) - (a.lastPlay||a.added)).slice(0,5);
  if (recent.length){
    html += '<div class="sectionHeading">Zuletzt gespielt <span class="line"></span></div><div class="panel">';
    recent.forEach((t,i) => {
      html += (i ? '<div class="sep"></div>' : "") + '<div class="row64">' +
        '<div class="cover36">' + t.icon + '</div>' +
        '<div class="rowInfo"><div class="rowTitle">' + esc(t.title) + '</div>' +
        '<div class="rowSub">' + esc(t.artist) + " · " + mmss(t.dur) + " · " + timeAgo(t.lastPlay||t.added) + '</div></div>' +
        '<div class="rowRight">' +
        '<button class="iconBtn" data-act="play-single" data-t="' + t.id + '" title="Abspielen">▶</button>' +
        '<button class="iconBtn" data-act="edit-cut" data-t="' + t.id + '" title="Schnitt setzen">✂</button>' +
        '</div></div>';
    });
    html += '</div>';
  }
  html += '<div class="infoBlock">💡 <b>Schnittfunktion:</b> Jeder Titel in einer Playlist hat eigene ' +
    '<b>Start-</b> und <b>Endmarken</b> - abgespielt wird nur der Abschnitt dazwischen. ' +
    '<b>Bluetooth:</b> Die Wiedergabe laeuft ueber die System-Audioausgabe - verbinde deinen ' +
    'Lautsprecher in den Android-/iOS-Einstellungen, die App leitet die Musik automatisch um (⚙️ → Bluetooth).</div></div>';
  $("#s-home").innerHTML = html;
}

/* ─────────────────────────── Screen: PLAYLISTEN ──────────────────────── */
function renderPlaylists(){
  let html = '<div class="pad" style="padding-top:14px">' +
    '<div class="toprow"><div><div class="pageTitle">Playlists</div>' +
    '<div class="pageSub">' + state.playlists.length + " Listen · " +
    state.playlists.reduce((a,p)=>a+p.items.length,0) + " Eintraege</div></div>" +
    '<button class="btn small primary" data-act="new-pl">+ Neue Playlist</button></div>' +
    '<div class="sectionHeading">Alle Playlists <span class="line"></span></div><div class="panel">';
  state.playlists.forEach((pl,i) => {
    const cuts = pl.items.filter(x => x.cut).length;
    const total = pl.items.reduce((a,x) => { const t = track(x.trackId); return a + (t ? (x.cut ? x.cut.end-x.cut.start : t.dur) : 0); }, 0);
    html += (i ? '<div class="sep"></div>' : "") + '<div class="row64" data-act="open-pl" data-pl="' + pl.id + '">' +
      '<div class="cover36">' + pl.cover + '</div>' +
      '<div class="rowInfo"><div class="rowTitle">' + esc(pl.name) + '</div>' +
      '<div class="rowSub">' + pl.items.length + " Titel · " + mmss(total) + " · ✂ " + cuts + " geschnitten</div></div>" +
      '<div class="rowRight">' +
      '<button class="iconBtn" data-act="play-pl" data-pl="' + pl.id + '" title="Playlist abspielen">▶</button><span>›</span>' +
      '</div></div>';
  });
  html += '</div></div>';
  $("#s-playlists").innerHTML = html;
}

/* ─────────────────────────── Screen: PLAYLIST-DETAIL ─────────────────── */
function renderPlDetail(){
  const pl = playlist(state.ui.activePl) || state.playlists[0];
  state.ui.activePl = pl.id;
  let html = '<div class="pad" style="padding-top:6px">' +
    '<div class="toprow">' +
    '<div class="rowInfo"><div class="pageTitle">' + pl.cover + " " + esc(pl.name) + '</div>' +
    '<div class="pageSub">' + pl.items.length + ' Titel · Titel antippen spielt nur den markierten Abschnitt</div></div>' +
    '<button class="btn small primary" data-act="play-pl" data-pl="' + pl.id + '">▶ Alle</button>' +
    '</div>' +
    '<div class="chipRow" style="margin-top:12px">' +
    '<span class="chip ' + (state.ui.plSort==="title"?"on":"") + '" data-act="pl-sort" data-s="title">Reihenfolge</span>' +
    '<span class="chip ' + (state.ui.plSort==="cut"?"on":"") + '" data-act="pl-sort" data-s="cut">Zuerst: mit Schnitt</span>' +
    '<span class="chip" data-act="add-track" data-pl="' + pl.id + '">+ Titel hinzufuegen</span>' +
    '<span class="chip" data-act="pl-menu" data-pl="' + pl.id + '">⋯</span>' +
    '</div><div class="mono plReorderHint">' +
    (state.ui.plSort === "title" ? 'Titel am Ziehgriff verschieben.' : 'Zum Verschieben zuerst „Reihenfolge“ auswählen.') +
    '</div><div class="panel">';
  if (!pl.items.length){
    html += '<div class="empty"><span class="big">🎶</span>Diese Playlist ist noch leer.<br>' +
      '"+ Titel hinzufuegen" waehlt aus deiner Bibliothek.</div>';
  }
  let items = pl.items.slice();
  if (state.ui.plSort === "cut") items.sort((a,b) => (b.cut?1:0)-(a.cut?1:0));
  items.forEach((it,i) => {
    const t = track(it.trackId); if (!t) return;
    const isCur = state.player.trackId === t.id;
    html += (i ? '<div class="sep"></div>' : "") + '<div class="row64 plTrackRow" data-item="' + it.id + '">' +
      '<div class="num">' + (i+1) + '</div>' +
      '<div class="rowInfo" data-act="play-item" data-pl="' + pl.id + '" data-i="' + it.id + '">' +
      '<div class="rowTitle" style="' + (isCur?"color:var(--accent)":"") + '">' + esc(t.title) + '</div>' +
      '<div class="rowSub">' + esc(t.artist) + " · " + mmss(t.dur) + " · " + esc(t.fmt) + '</div>' +
      '<div style="margin-top:5px">' + (it.cut
        ? '<span class="pill pillCut">✂ ' + mmss(it.cut.end-it.cut.start) + " von " + mmss(t.dur) + '</span>'
        : '<span class="pill pillFull">ganz</span>') + '</div>' +
      (it.cut ? '<div class="mono" style="margin-top:3px">✂ ' + mmssPrecise(it.cut.start) + " → " + mmssPrecise(it.cut.end) + '</div>' : "") +
      '</div>' +
      '<div class="rowRight">' +
      '<button type="button" class="iconBtn reorderHandle" data-reorder-pl="' + pl.id + '" data-reorder-item="' + it.id +
      '" aria-label="Titel verschieben" title="' + (state.ui.plSort === "title" ? "Titel verschieben" : "Zur Reihenfolge-Ansicht wechseln") +
      '"' + (state.ui.plSort === "title" ? "" : " disabled") + '>⠿</button>' +
      '<button class="iconBtn" data-act="edit-cut" data-t="' + t.id + '" data-pl="' + pl.id + '" title="Schnitt bearbeiten">✂</button>' +
      '<button class="iconBtn" data-act="track-menu" data-t="' + t.id + '" data-i="' + it.id + '" data-pl="' + pl.id + '" title="Mehr">⋯</button>' +
      '</div></div>';
  });
  html += '</div></div>';
  $("#s-pl").innerHTML = html;
}

/* ─────────────────────────── Screen: BIBLIOTHEK ──────────────────────── */
function renderLibrary(){
  const q = state.ui.libQ.toLowerCase();
  const all = Array.from(state.tracks.values());
  const list = all.filter(t => !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));
  const bytes = all.reduce((a,t) => a + (t.size||0), 0);
  const recordingActive = recorderState.recorder?.state === "recording";
  const recordingBusy = recordingActive || recorderState.requesting || recorderState.saving;
  const recordingStatus = recorderState.requesting ? "Mikrofonzugriff wird angefragt…" :
    recorderState.saving ? "Aufnahme wird in der Bibliothek gespeichert…" :
    recordingActive ? "Aufnahme läuft · " + mmss((Date.now()-recorderState.startedAt)/1000) : "";
  let html = '<div class="pad" style="padding-top:14px">' +
    '<div class="toprow libraryTop"><div class="libraryHeading"><div class="pageTitle">Bibliothek</div>' +
    '<div class="pageSub">' + all.length + " Dateien · " + fmtBytes(bytes) + ' offline gespeichert</div></div>' +
    '<div class="rowRight libraryActions"><button class="btn small" data-act="' + (recordingActive ? "record-stop" : "record-start") +
    '" id="recordBtn"' + (recorderState.requesting || recorderState.saving ||
      (!recordingActive && state.ui.importing) ? " disabled" : "") + '>' +
    (recorderState.requesting ? "Mikrofon…" : recorderState.saving ? "Speichere…" : recordingActive ? "■ Aufnahme beenden" : "🎙 Aufnahme") + '</button>' +
    '<button class="btn small" data-act="pick-files">⬇ Import</button></div></div>' +
    '<div class="recordingStatus" id="recordingStatus"' + (recordingBusy ? "" : " hidden") + '>' +
    esc(recordingStatus) + '</div>';
  if (state.ui.importing){
    const p = Math.round(state.ui.importDone/Math.max(1,state.ui.importTotal)*100);
    html += '<div class="panel" style="margin-top:12px;padding:12px">' +
      '<div class="rowTitle"><span class="spin"></span> Importiere ' + state.ui.importDone + "/" + state.ui.importTotal + "…</div>" +
      '<div class="progress"><i style="width:' + p + '%"></i></div></div>';
  }
  if (all.length) html += '<div class="search" style="margin-top:12px">🔍<input id="libQ" placeholder="Titel oder Interpret…" value="' + esc(state.ui.libQ) + '"></div>';
  if (!all.length){
    html += '<div class="panel" style="margin-top:12px"><div class="empty">' +
      '<span class="big">📁</span>Leere Bibliothek. Dateien bleiben <b>nur auf diesem Geraet</b> - ' +
      'kein Konto, kein Streaming.<br>Auf dem Handy: Dateien-App → Audio teilen → "In BeatClip oeffnen" ' +
      '(installiert) oder hier "⬇ Import".<div class="btnrow">' +
      '<button class="btn primary" data-act="pick-files">⬇ Audiodateien waehlen</button>' +
      '<button class="btn" data-act="demo-tracks">Demo-Titel erzeugen</button></div></div></div>';
  } else if (!list.length){
    html += '<div class="panel" style="margin-top:12px"><div class="empty">Keine Treffer fuer "' + esc(state.ui.libQ) + '".</div></div>';
  } else {
    html += '<div class="panel" style="margin-top:10px">';
    list.forEach((t,i) => {
      html += (i ? '<div class="sep"></div>' : "") + '<div class="row64">' +
        '<div class="cover36">' + t.icon + '</div>' +
        '<div class="rowInfo"><div class="rowTitle">' + esc(t.title) + '</div>' +
        '<div class="rowSub">' + esc(t.artist) + (t.album ? " · " + esc(t.album) : "") + '</div>' +
        '<div class="mono" style="margin-top:3px">' + esc(t.fmt) + " · " + fmtBytes(t.size||0) + " · " + mmss(t.dur) + '</div>' +
        '<canvas class="spark" data-t="' + t.id + '" height="22"></canvas></div>' +
        '<div class="rowRight">' +
        '<button class="iconBtn" data-act="play-single" data-t="' + t.id + '" title="Abspielen">▶</button>' +
        '<button class="iconBtn" data-act="lib-menu" data-t="' + t.id + '" title="Mehr">⋯</button>' +
        '</div></div>';
    });
    html += '</div>';
  }
  html += '</div>';
  $("#s-library").innerHTML = html;
  // Mini-Waveforms (echte Peaks) unter jedem Bibliotheks-Titel
  $$("#s-library canvas.spark").forEach(cv => {
    const w = Math.max(60, cv.clientWidth || 150), h = 22;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.floor(w*dpr); cv.height = Math.floor(h*dpr);
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.body);
    ctx.fillStyle = css.getPropertyValue("--wave-in").trim() || "#00b8a9";
    const peaks = peaksFor(cv.dataset.t), bw = 2, gap = 1, n = Math.max(20, Math.floor(w/bw));
    for (let i = 0; i < n; i++){
      const p = peaks[Math.floor(i/n*peaks.length)] || .1;
      const bh = Math.max(1, p*(h-2));
      ctx.fillRect(i*bw, (h-bh)/2, bw-gap, bh);
    }
  });
  const inp = $("#libQ");
  if (inp){
    inp.addEventListener("input", () => { state.ui.libQ = inp.value; });
    inp.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault();
      const pos = inp.selectionStart; renderLibrary();
      const n = $("#libQ"); if (n){ n.focus(); n.setSelectionRange(pos, pos); } } });
  }
}

/* ─────────────────────────── Screen: EINSTELLUNGEN ───────────────────── */
function renderSet(){
  const s = state.settings;
  let html = '<div class="pad" style="padding-top:14px">' +
    '<div class="pageTitle">Einstellungen</div>' +
    '<div class="sectionHeading">🔊 Bluetooth & Audiogerat <span class="line"></span></div>' +
    '<div class="panel">' +
    '<div class="btCard"><span class="ico">📶</span><div class="txt">' +
    '<b>Ausgabe: ' + esc(state.bt.label) + '</b>' +
    '<p>Verbinde deinen Bluetooth-Lautsprecher in den Systemeinstellungen des Handys ' +
    '(Android: Schnelleinstellungen → Media-Ausgabe · iPhone: Kontrollzentrum → AirPlay). ' +
    'BeatClip nutzt die System-Audioausgabe - die Musik laeuft automatisch ueber den ' +
    'Lautsprecher, auch bei gesperrtem Bildschirm.</p>' +
    '<div class="btnrow"><button class="btn" data-act="bt-test">▶ Kurz testen</button></div>' +
    '</div></div>' +
    '<div class="sep"></div>' +
    '<div class="kv"><span class="k">Aktuelles Audiogerat</span><span class="v" id="btState">-</span></div>' +
    '</div>' +
    '<div class="sectionHeading">Wiedergabe <span class="line"></span></div>' +
    '<div class="panel">' +
    '<div class="kv"><span class="k">Wiederholen</span><span class="v">' +
    '<button class="btn small" data-act="cycle-repeat">' + (s.repeat === "all" ? "🔁 Alle" : s.repeat === "one" ? "🔂 Eins" : "⏹ Aus") + '</button></span></div>' +
    '<div class="sep"></div>' +
    '<div class="kv"><span class="k">Zufallswiedergabe</span><div class="toggle ' + (s.shuffle?"on":"") + '" data-act="tgl" data-k="shuffle"></div></div>' +
    '<div class="sep"></div>' +
    '<div class="kv"><span class="k">Ausblenden an Schnittkanten</span><span class="v">' + s.fade.toFixed(1) + ' s ' +
    '<button class="btn small" data-act="fade-step" style="margin-left:8px">aendern</button></span></div>' +
    '<div class="sep"></div>' +
    '<div class="kv"><span class="k">Sleep-Timer</span><span class="v">' +
    '<button class="btn small" data-act="sleep">' + (s.sleepMin ? s.sleepMin + " min" : "aus") + '</button></span></div>' +
    '</div>' +
    '<div class="sectionHeading">Speicher <span class="line"></span></div>' +
    '<div class="panel">' +
    '<div class="kv"><span class="k">Lokaler Speicher</span><span class="v" id="quotaV">…</span></div>' +
    '<div class="sep"></div>' +
    '<div class="kv"><span class="k">Persistente Speicherung</span><span class="v">' +
    '<button class="btn small" data-act="persist">anfragen</button></span></div>' +
    '<div class="sep"></div>' +
    '<div class="kv"><span class="k">Alle Schnitte loeschen</span><button class="btn small danger" data-act="clear-cuts">Loeschen</button></div>' +
    '</div>' +
    '<div class="sectionHeading">Erscheinung <span class="line"></span></div>' +
    '<div class="panel">' +
    '<div class="kv"><span class="k">Design</span><button class="btn small" data-act="theme">' + (s.theme === "dark" ? "🌙 Dunkel" : "☀️ Hell") + '</button></div>' +
    '</div>' +
    '<div class="sectionHeading">' + (NATIVE ? (NATIVE_OS === "iOS" ? "Wiedergabe & Now Playing" : "Wiedergabe & Benachrichtigung") : "Installation") + ' <span class="line"></span></div>' +
    '<div class="panel">' +
    (NATIVE
      ? '<div class="kv"><span class="k">App-Version</span><span class="v" style="font-size:13px">' + NATIVE_OS + '-App v' + APP_VER + ' (Build ' + APP_BUILD + ')</span></div>' +
        '<div class="sep"></div>' +
        '<div class="kv"><span class="k">' + (NATIVE_OS === "iOS" ? "Now-Playing-Status" : "Medien-Benachrichtigung") + '</span><button class="btn small" data-act="media-status">pruefen</button></span></div>' +
        '<div class="kv" style="font-size:12px;opacity:.75"><span class="k">' + (NATIVE_OS === "iOS"
            ? 'Titel, Cover und Tasten erscheinen in "Now Playing" (Kontrollzentrum, Sperrbildschirm, AirPlay); Audiodateien uebergibst du per "Offnen in -> BeatClip".'
            : 'Titel, Tasten und Bluetooth-Steuerung erscheinen auf dem Sperrbildschirm; Audiodateien kannst du aus jeder App nach BeatClip teilen.') + '</span></div>'
      : '<div class="kv"><span class="k">Als App installieren</span><span class="v">' +
        '<button class="btn small primary" data-act="install">⤓ Installieren</button></span></div>' +
        '<div class="sep"></div>' +
        '<div class="kv"><span class="k">Installations-Anleitung</span><button class="btn small" data-act="how-install">zeigen</button></div>') +
    '</div>' +
    '<div class="btnrow"><button class="btn" data-act="go-about">ℹ️ Ueber BeatClip</button></div>' +
    '</div>';
  $("#s-set").innerHTML = html;
  updateStoreInfo(); updateBtState();
}
async function updateStoreInfo(){
  const el = $("#quotaV"); if (!el) return;
  try{
    const est = await navigator.storage.estimate();
    el.textContent = fmtBytes(est.usage||0) + " / " + fmtBytes(est.quota||0);
  }catch(e){ el.textContent = "unbekannt"; }
}
function updateBtState(){
  const el = $("#btState"); if (!el) return;
  el.textContent = state.bt.label + " (App folgt dem System)";
}

/* ─────────────────────────── Screen: PLAYER ──────────────────────────── */
function renderPlayer(){
  const t = track(state.player.trackId) || Array.from(state.tracks.values())[0];
  if (!t){ $("#s-player").innerHTML = '<div class="empty" style="padding-top:60px">Kein Titel ausgewaehlt.</div>'; return; }
  const c = currentItem(); const cut = c ? c.it.cut : null;
  const s = span() || { start:0, end:t.dur||0, len:t.dur||1, dur:t.dur||0 };
  const nid = state.queue[(state.qIndex+1) % Math.max(1,state.queue.length)];
  const nItem = state.playlists.flatMap(p=>p.items).find(i => i.id === nid);
  const nt = nItem ? track(nItem.trackId) : null;
  let html =
    '<div class="playerHead">' +
    '<button class="iconBtn" data-act="back" title="Zurueck">←</button>' +
    '<div class="spacer"></div>' +
    '<span class="pill ' + (cut?"pillCut":"pillFull") + '">' + (cut ? "✂ Schnitt aktiv" : "ganzer Titel") + '</span>' +
    '<div class="spacer"></div>' +
    '<button class="iconBtn" data-act="edit-cut" data-t="' + t.id + '" title="Schnitt bearbeiten">✂</button>' +
    '</div>' +
    '<div class="artWrap">' + t.icon + '<div class="cutTag">' +
    (cut ? mmssPrecise(cut.start) + " – " + mmssPrecise(cut.end) + " · " + mmss(cut.end-cut.start)
         : "kompletter Titel · " + mmss(t.dur)) + '</div></div>' +
    '<div class="pTitle" id="pTitle">' + esc(t.title) + '</div>' +
    '<div class="pArtist" id="pArtist">' + esc(t.artist) + (t.album ? " · " + esc(t.album) : "") + '</div>' +
    '<div class="pTimeline" id="pTimeline">' +
    '<canvas id="pWave"></canvas>' +
    '<div class="handle" id="hStart"><i></i><span>S</span></div>' +
    '<div class="handle" id="hEnd"><i></i><span>E</span></div>' +
    '<div class="playhead" id="pHead"></div>' +
    '</div>' +
    '<div class="pTimes"><span id="pPos">0:00</span><span id="pLen">-</span></div>' +
    '<div class="pControls">' +
    '<button class="ctlBtn ' + (state.settings.shuffle?"on":"") + '" data-act="tgl-shuffle" title="Zufall">🔀</button>' +
    '<button class="ctlBtn" data-act="prev" title="Zurueck">⏮</button>' +
    '<button class="ctlBtn big" id="btnPlay" data-act="toggle-play">' + (state.player.playing ? "⏸" : "▶") + '</button>' +
    '<button class="ctlBtn" data-act="next" title="Weiter">⏭</button>' +
    '<button class="ctlBtn ' + (state.settings.repeat!=="off"?"on":"") + '" data-act="cycle-repeat" title="Wiederholen">' + (state.settings.repeat==="one"?"🔂":"🔁") + '</button>' +
    '</div>' +
    '<div class="skipRow">' +
    '<button class="btn" data-act="seek-start">⏮ Zum Schnittanfang</button>' +
    '<button class="btn" data-act="seek-end">Zum Schnittende ⏭</button>' +
    '</div>' +
    '<div class="volRow">🔈<input type="range" id="vol" min="0" max="100" value="' + Math.round(state.settings.volume*100) + '">🔊' +
    '<span class="mono" id="volVal">' + Math.round(state.settings.volume*100) + ' %</span></div>' +
    '<div class="nextUp panel"><div class="row64" data-act="next">' +
    '<div class="cover36">' + (nt ? nt.icon : "🎵") + '</div>' +
    '<div class="rowInfo"><div class="rowSub" style="margin:0 0 2px">Als Naechstes' + (nItem?.cut?" (Schnitt)":"") + '</div>' +
    '<div class="rowTitle">' + (nt ? esc(nt.title) : "-") + '</div>' +
    '<div class="rowSub">' + (nt ? esc(nt.artist) + " · " + (nt.cut ? mmss(nt.cut.end-nt.cut.start) : mmss(nt.dur)) : "") + '</div></div>' +
    '<div class="rowRight">▶</div></div></div>';
  $("#s-player").innerHTML = html;
  requestAnimationFrame(() => { drawPlayerTimeline(); updatePlayerUI(); });
  const tl = $("#pTimeline");
  tl.addEventListener("pointerdown", e => {
    const r = tl.getBoundingClientRect();
    const hEl = e.target.closest(".handle");
    if (hEl && c){
      state.ui.drag = { el:hEl.id, trackId:t.id, itemLocalId:c.it.id, pl:c.pl.id, scope:"player" };
    } else {
      const frac = clamp((e.clientX - r.left)/r.width, 0, 1);
      const sec = frac * (audio.duration || t.dur || 0);
      const sp = span();
      audio.currentTime = clamp(sec, sp.start, sp.end);
      armEndWatchdog(); drawPlayerTimeline(); updatePlayerUI();
    }
  });
  const vol = $("#vol");
  vol.addEventListener("input", () => {
    state.settings.volume = +vol.value/100; audio.volume = state.settings.volume;
    $("#volVal").textContent = vol.value + " %"; saveSettings();
  });
}
function updatePlayerUI(){
  const s = span(); if (!s) return;
  const t = track(state.player.trackId); if (!t) return;
  const posEl = $("#pPos"); if (!posEl) return;
  posEl.textContent = mmssPrecise(audio.currentTime);
  $("#pLen").textContent = mmss(s.len) + " von " + mmss(audio.duration || t.dur);
  const dur = audio.duration || t.dur || 1;
  $("#pHead").style.left = clamp(audio.currentTime/dur*100, 0, 100) + "%";
  const bp = $("#btnPlay"); if (bp) bp.textContent = audio.paused ? "▶" : "⏸";
}
function drawPlayerTimeline(){
  const cv = $("#pWave"), tl = $("#pTimeline"); if (!cv || !tl) return;
  const s = span();
  drawWave(cv, tl.clientWidth, tl.clientHeight, state.player.trackId, s);
  const dur = (audio.duration && isFinite(audio.duration)) ? audio.duration : (s.dur || 1);
  $("#hStart").style.left = (s.start/dur*100) + "%";
  $("#hEnd").style.left = (s.end/dur*100) + "%";
  $("#pHead").style.left = clamp(audio.currentTime/dur*100, 0, 100) + "%";
}

/* ─────────────────────────── Waveform zeichnen ───────────────────────── */
function peaksFor(trackId){
  const t = track(trackId);
  if (t && t.peaks && t.peaks.length) return t.peaks;
  let h = 2166136261; for (const ch of trackId){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h/4294967296; };
  const out = []; let v = .45;
  for (let i = 0; i < 1000; i++){ v = clamp(v + (rnd()-.5)*.34, .07, 1);
    out.push(clamp(v + (i%12<2 ? .14 : 0), .05, 1)); }
  return out;
}
function drawWave(canvas, w, h, trackId, s){
  if (!trackId || !w || !s) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w*dpr); canvas.height = Math.floor(h*dpr);
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,w,h);
  const t = track(trackId);
  const dur = (audio.duration && isFinite(audio.duration)) ? audio.duration : (t && t.dur) || 1;
  const css = getComputedStyle(document.body);
  const colOut = css.getPropertyValue("--wave-out").trim();
  const colIn  = css.getPropertyValue("--wave-in").trim();
  const peaks = peaksFor(trackId);
  const bw = 3, gap = 1, n = Math.max(8, Math.floor(w/bw));
  for (let i = 0; i < n; i++){
    const x = i*bw;
    const sec = x/w*dur;
    const inCut = sec >= s.start && sec <= s.end;
    ctx.fillStyle = inCut ? colIn : colOut;
    const p = peaks[Math.floor(i/n*peaks.length)] || .1;
    const bh = p*(h-8);
    ctx.fillRect(x, (h-bh)/2, bw-gap, bh);
  }
  ctx.fillStyle = "rgba(0,0,0,.35)";
  if (s.start > 0) ctx.fillRect(0, 0, (s.start/dur)*w, h);
  if (s.end < dur) ctx.fillRect((s.end/dur)*w, 0, w - (s.end/dur)*w, h);
}

/* ─────────────────────────── Sheet: SCHNITT-EDITOR ───────────────────── */
async function openCutEditor(trackId, plId){
  const t = track(trackId); if (!t) return;
  let pl = plId ? playlist(plId) : (currentItem() ? currentItem().pl : null);
  let it = pl ? pl.items.find(i => i.trackId === trackId) : null;
  if (!it){
    const found = state.playlists.flatMap(p => p.items.map(i => ({p,i}))).find(x => x.i.trackId === trackId);
    if (found){ pl = found.p; it = found.i; }
  }
  if (!it){
    pl = state.playlists[0];
    it = { id:uid(), trackId, cut:null };
    pl.items.push(it); await savePlaylist(pl);
  }
  if (!it.cut) it.cut = { start:0, end:t.dur || audio.duration || 0 };
  state.ui.editTrack = trackId; state.ui.editPl = pl.id; state.ui.editItem = it.id;
  const dur = it.cut.end - it.cut.start;
  openSheet(
    '<div class="grab"></div>' +
    '<h2>✂ Schnitt: ' + esc(t.title) + '</h2>' +
    '<div class="sub">' + esc(t.artist) + " · Laenge " + mmss(t.dur) + " · Playlist: " + esc(pl.name) +
      ' · <span id="sheetBuild">v' + APP_VER + " Build " + APP_BUILD + '</span></div>' +
    '<div class="waveWrap" id="wWaveWrap">' +
    '<canvas id="wWave"></canvas>' +
    '<div class="handle" id="hStart"><i></i><span>S</span></div>' +
    '<div class="handle" id="hEnd"><i></i><span>E</span></div>' +
    '<div class="playhead" id="wHead"></div>' +
    '</div>' +
    '<div class="cutInfo">' +
    '<div class="cutBox start"><div class="lbl">Start</div><div class="val" id="cStart">' + mmssPrecise(it.cut.start) + '</div></div>' +
    '<div class="cutBox dur"><div class="lbl">Dauer</div><div class="val" id="cDur">' + mmss(dur) + '</div></div>' +
    '<div class="cutBox end"><div class="lbl">Ende</div><div class="val" id="cEnd">' + mmssPrecise(it.cut.end) + '</div></div>' +
    '</div>' +
    '<div class="nudge">' +
    '<button data-act="nudge" data-d="-5">−5 s</button>' +
    '<button data-act="nudge" data-d="-1">−1 s</button>' +
    '<button data-act="nudge-sel" data-f="start" class="' + (state.ui.nudgeFocus==="start"?"sel":"") + '">↔ Start</button>' +
    '<button data-act="nudge-sel" data-f="end" class="' + (state.ui.nudgeFocus==="end"?"sel":"") + '">Ende ↔</button>' +
    '<button data-act="nudge" data-d="1">+1 s</button>' +
    '<button data-act="nudge" data-d="5">+5 s</button>' +
    '</div>' +
    '<div class="mono" style="text-align:center;margin-top:8px">Griffe S/E ziehen · Flaeche antippen = Abspielposition</div>' +
    '<div class="btnrow" style="margin-bottom:0">' +
    '<button class="btn" data-act="cut-play">▶ Ab Schnittmitte</button>' +
    '<button class="btn" data-act="cut-reset">Schnitt loeschen</button>' +
    '</div>' +
    '<div class="sheetbtns" style="margin-top:10px">' +
    '<button class="btn" data-act="sheet-close">Abbrechen</button>' +
    '<button class="btn primary" data-act="cut-save">Schnitt speichern</button>' +
    '</div>');
  requestAnimationFrame(() => { drawEditorWave(); updateEditorHead(); });
  $("#wWaveWrap").addEventListener("pointerdown", e => {
    const wrap = $("#wWaveWrap"), r = wrap.getBoundingClientRect();
    const hEl = e.target.closest(".handle");
    if (hEl){
      state.ui.drag = { el:hEl.id, trackId, itemLocalId:it.id, pl:pl.id, scope:"sheet" };
    } else {
      const sec = clamp((e.clientX-r.left)/r.width, 0, 1) * (audio.duration || t.dur || 0);
      if (state.player.trackId === trackId){ audio.currentTime = sec; armEndWatchdog(); }
      updateEditorHead();
    }
  });
}
function editedItem(){
  return state.playlists.flatMap(p => p.items).find(i => i.id === state.ui.editItem);
}
function drawEditorWave(){
  const wrap = $("#wWaveWrap"); if (!wrap) return;
  const t = track(state.ui.editTrack); if (!t) return;
  const it = editedItem(); if (!it) return;
  drawWave($("#wWave"), wrap.clientWidth, wrap.clientHeight, state.ui.editTrack,
    { start:it.cut.start, end:it.cut.end, dur:t.dur });
}
function updateEditorHead(){
  const it = editedItem(); if (!it) return;
  const t = track(state.ui.editTrack);
  const wrap = $("#wWaveWrap"); if (!wrap) return;
  const dur = t.dur || 1;
  $("#hStart").style.left = (it.cut.start/dur*100) + "%";
  $("#hEnd").style.left = (it.cut.end/dur*100) + "%";
  const cur = state.player.trackId === state.ui.editTrack ? audio.currentTime : -1;
  $("#wHead").style.display = cur >= 0 ? "block" : "none";
  if (cur >= 0) $("#wHead").style.left = clamp(cur/dur*100, 0, 100) + "%";
  $("#cStart").textContent = mmssPrecise(it.cut.start);
  $("#cEnd").textContent = mmssPrecise(it.cut.end);
  $("#cDur").textContent = mmssPrecise(it.cut.end - it.cut.start);
  drawEditorWave();
}

function clearPlaylistDropTarget(){
  $$(".plTrackRow").forEach(row => row.classList.remove("isDragging","dropBefore","dropAfter"));
}
function finishPlaylistReorder(cancelled){
  const d = state.ui.reorder;
  if (!d) return;
  state.ui.reorder = null;
  clearPlaylistDropTarget();
  if (!d.moved) return;
  state.ui.dragged = true;
  setTimeout(() => state.ui.dragged = false, 300);
  if (cancelled || !d.targetItem || d.targetItem === d.itemId) return;

  const pl = playlist(d.pl);
  if (!pl || state.ui.plSort !== "title") return;
  const currentId = currentItem()?.pl.id === pl.id ? state.queue[state.qIndex] : null;
  const originalItems = pl.items.slice();
  const sourceIndex = pl.items.findIndex(item => item.id === d.itemId);
  const targetIndex = pl.items.findIndex(item => item.id === d.targetItem);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [item] = pl.items.splice(sourceIndex, 1);
  const updatedTargetIndex = pl.items.findIndex(entry => entry.id === d.targetItem);
  pl.items.splice(updatedTargetIndex + (d.after ? 1 : 0), 0, item);
  Promise.resolve(savePlaylist(pl)).then(() => {
    if (currentId){
      state.queue = pl.items.map(entry => entry.id);
      state.qIndex = state.queue.indexOf(currentId);
    }
    refreshCurrent();
    toast("Reihenfolge gespeichert");
  }).catch(err => {
    pl.items = originalItems;
    console.error(err);
    refreshCurrent();
    toast("Reihenfolge konnte nicht gespeichert werden: " + err.message, true);
  });
}

document.addEventListener("pointerdown", e => {
  const handle = e.target.closest(".reorderHandle");
  if (!handle || handle.disabled || state.ui.plSort !== "title" || state.ui.drag) return;
  e.preventDefault();
  state.ui.reorder = {
    pl:handle.dataset.reorderPl, itemId:handle.dataset.reorderItem,
    pointerId:e.pointerId, startX:e.clientX, startY:e.clientY,
    targetItem:null, after:false, moved:false,
  };
  handle.setPointerCapture(e.pointerId);
});
document.addEventListener("pointermove", e => {
  const d = state.ui.reorder;
  if (!d || e.pointerId !== d.pointerId) return;
  if (!d.moved && Math.hypot(e.clientX-d.startX,e.clientY-d.startY) < 6) return;
  d.moved = true;
  const pointTarget = document.elementFromPoint(e.clientX,e.clientY);
  const panel = pointTarget?.closest("#s-pl .panel");
  const rows = panel ? Array.from(panel.querySelectorAll(".plTrackRow")) : [];
  const row = rows.find(entry => e.clientY <
    entry.getBoundingClientRect().top + entry.getBoundingClientRect().height/2) || rows[rows.length-1];
  d.targetItem = row ? row.dataset.item : null;
  d.after = !!row && row === rows[rows.length-1] &&
    e.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height/2;
  clearPlaylistDropTarget();
  const source = $(`#s-pl .plTrackRow[data-item="${d.itemId}"]`);
  if (source) source.classList.add("isDragging");
  if (row && d.targetItem) row.classList.add(d.after ? "dropAfter" : "dropBefore");
});
document.addEventListener("pointerup", e => {
  if (state.ui.reorder?.pointerId !== e.pointerId) return;
  finishPlaylistReorder(false);
});
document.addEventListener("pointercancel", e => {
  if (state.ui.reorder?.pointerId !== e.pointerId) return;
  finishPlaylistReorder(true);
});

/* Globales Zeiger-Ziehen fuer alle Griffe */
document.addEventListener("pointermove", e => {
  const d = state.ui.drag; if (!d) return;
  const host = d.scope === "player" ? $("#pTimeline") : $("#wWaveWrap");
  if (!host) return;
  const r = host.getBoundingClientRect();
  const frac = clamp((e.clientX - r.left)/r.width, 0, 1);
  const t = track(d.trackId); const dur = (audio.duration && isFinite(audio.duration) ? audio.duration : (t && t.dur)) || 0;
  const sec = Math.round(frac*dur*10)/10;
  const all = state.playlists.flatMap(p => p.items).find(i => i.id === d.itemLocalId);
  if (!all) return;
  if (!all.cut) all.cut = { start:0, end:dur };
  if (d.el === "hStart") all.cut.start = clamp(sec, 0, all.cut.end - 2);
  else                   all.cut.end   = clamp(sec, all.cut.start + 2, dur);
  d.moved = true;
  if (d.scope === "player"){
    if (state.player.trackId === d.trackId)
      audio.currentTime = clamp(audio.currentTime, all.cut.start, all.cut.end);
    drawPlayerTimeline(); updatePlayerUI();
  } else updateEditorHead();
  renderMini(true);
});
document.addEventListener("pointerup", async () => {
  const d = state.ui.drag; if (!d) return;
  state.ui.drag = null;
  if (d.moved){
    state.ui.dragged = true; setTimeout(() => state.ui.dragged = false, 300);
    const pl = playlist(d.pl); if (pl) await savePlaylist(pl);
    const it = state.playlists.flatMap(p=>p.items).find(i => i.id === d.itemLocalId);
    if (it && it.cut) toast("✂ " + mmssPrecise(it.cut.start) + "-" + mmssPrecise(it.cut.end) + " (" + mmss(it.cut.end-it.cut.start) + ")");
    armEndWatchdog();
    refreshCurrent();
  }
});

/* ─────────────────────────── Weitere Sheets ──────────────────────────── */
function openTrackMenu(trackId, itemLocalId, plId){
  const t = track(trackId); if (!t) return;
  const pl = playlist(plId);
  openSheet('<div class="grab"></div><h2>' + esc(t.title) + '</h2>' +
    '<div class="sub">' + esc(t.artist) + " · " + esc(t.fmt) + " · " + fmtBytes(t.size||0) + " · " + mmss(t.dur) + '</div>' +
    '<div class="menuitem" data-act="edit-cut" data-t="' + trackId + '" data-pl="' + (plId||"") + '">✂ Schnitt bearbeiten</div>' +
    '<div class="menuitem" data-act="extract-channels" data-t="' + trackId + '">🎚 Stereo-Kanäle extrahieren</div>' +
    (itemLocalId ? '<div class="menuitem" data-act="cut-remove" data-i="' + itemLocalId + '" data-pl="' + plId + '">⊘ Schnitt entfernen (ganz abspielen)</div>' : '') +
    '<div class="menuitem" data-act="add-to-pl-t" data-t="' + trackId + '">＋ Andere Playlists</div>' +
    (pl ? '<div class="menuitem dngr" data-act="pl-remove" data-i="' + itemLocalId + '" data-pl="' + plId + '">🗑 Aus Playlist entfernen</div>' : '') +
    '<div class="menuitem dngr" data-act="file-remove" data-t="' + trackId + '">⚠ Datei vom Geraet loeschen</div>' +
    '<div class="sheetbtns"><button class="btn" data-act="sheet-close">Schliessen</button></div>');
}
function openAddToPl(){
  const rows = state.playlists.map(p => {
    const has = p.items.some(i => i.trackId === state.ui.pickerTrack);
    return '<div class="menuitem" data-act="pl-add-pick" data-pl="' + p.id + '">' +
      p.cover + " " + esc(p.name) + ' <span class="spacer"></span>' +
      (has ? '<span class="pill pillOn">drin</span>' : "hinzufuegen") + '</div>';
  }).join("");
  const t = track(state.ui.pickerTrack);
  openSheet('<div class="grab"></div><h2>Zu Playlist hinzufuegen</h2>' +
    '<div class="sub">' + (t ? esc(t.title) : "Titel") + '</div>' + rows +
    '<div class="sheetbtns"><button class="btn" data-act="sheet-close">Fertig</button></div>');
}
function openPlAddTrack(plId){
  const pl = playlist(plId);
  const inPl = new Set(pl.items.map(i => i.trackId));
  const rows = Array.from(state.tracks.values()).filter(t => !inPl.has(t.id)).map(t =>
    '<div class="menuitem" data-act="pl-add-track" data-pl="' + plId + '" data-t="' + t.id + '">' +
    t.icon + " " + esc(t.title) + ' <span class="spacer"></span><span class="mono">' + mmss(t.dur) + '</span></div>').join("");
  openSheet('<div class="grab"></div><h2>Titel zu "' + esc(pl.name) + '"</h2>' +
    '<div class="sub">' + (rows ? "Aus deiner Bibliothek waehlen" : "Bibliothek ist leer - erst Dateien importieren.") + '</div>' +
    (rows || '<div class="btnrow"><button class="btn primary" data-act="pick-files">⬇ Importieren</button></div>') +
    '<div class="sheetbtns"><button class="btn" data-act="sheet-close">Fertig</button></div>');
}
function openNewPl(){
  openSheet('<div class="grab"></div><h2>Neue Playlist</h2><div class="sub">Name und Symbol waehlen</div>' +
    '<div class="search" style="margin-bottom:12px">🎶<input id="npName" placeholder="z. B. Fruehstuecks-Hooks"></div>' +
    '<div class="chipRow">' + ["🎧","☀️","🔥","🌙","🏃","🎉","🧠","🌧️"].map((e,i) =>
      '<span class="chip ' + (i===0?"on":"") + '" data-act="np-icon" data-e="' + e + '">' + e + '</span>').join("") + '</div>' +
    '<div class="sheetbtns"><button class="btn" data-act="sheet-close">Abbrechen</button>' +
    '<button class="btn primary" data-act="np-create">Anlegen</button></div>');
}
function isIOS(){
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function openHowInstall(){
  openSheet('<div class="grab"></div><h2>⤓ Als App installieren</h2>' +
    '<div class="sub">BeatClip laeuft offline - wie eine echte App aus dem Store.</div>' +
    '<div class="sectionHeading">' + (isIOS() ? "iPhone / iPad (Safari)" : "Android (Chrome)") + ' <span class="line"></span></div>' +
    (isIOS() ?
      '<div class="stepline"><span class="num">1</span><span>In <b>Safari</b> auf das <b>Teilen</b>-Symbol tippen</span></div>' +
      '<div class="stepline"><span class="num">2</span><span>"<b>Zum Startbildschirm hinzufuegen</b>" waehlen</span></div>' +
      '<div class="stepline"><span class="num">3</span><span>Bestaetigen - Icon erscheint auf dem Startbildschirm</span></div>'
      :
      '<div class="stepline"><span class="num">1</span><span>Menu <b>⋮</b> oben rechts in Chrome oeffnen</span></div>' +
      '<div class="stepline"><span class="num">2</span><span>"<b>App installieren</b>" / "Zum Startbildschirm hinzufuegen"</span></div>' +
      '<div class="stepline"><span class="num">3</span><span>Bestaetigen - BeatClip startet randlos wie eine App</span></div>') +
    '<div class="infoBlock">Nach der Installation: Dateien-App → Audiodatei → Teilen/Oeffnen mit → BeatClip.</div>' +
    '<div class="sheetbtns"><button class="btn primary" data-act="sheet-close">Verstanden</button></div>');
}
function openPlMenu(plId){
  const pl = playlist(plId);
  openSheet('<div class="grab"></div><h2>' + esc(pl.name) + '</h2>' +
    '<div class="menuitem" data-act="pl-rename" data-pl="' + plId + '">✏️ Umbenennen</div>' +
    '<div class="menuitem dngr" data-act="pl-delete" data-pl="' + plId + '">🗑 Playlist loeschen</div>' +
    '<div class="sheetbtns"><button class="btn" data-act="sheet-close">Schliessen</button></div>');
}

/* ─────────────────────────── Mini-Player ─────────────────────────────── */
function renderMini(){
  const m = $("#mini"), t = track(state.player.trackId);
  if (!t){ m.hidden = true; return; }
  m.hidden = false;
  const s = span(), c = currentItem();
  $("#miniCover").textContent = t.icon;
  $("#miniTitle").textContent = t.title;
  $("#miniSub").textContent = (c && c.it.cut)
    ? "✂ " + mmssPrecise(s.start) + "-" + mmssPrecise(s.end) + " · " + mmss(s.len)
    : t.artist + " · " + mmss(t.dur);
  $("#miniPlay").textContent = state.player.playing ? "⏸" : "▶";
  const frac = clamp((audio.currentTime - s.start)/s.len, 0, 1);
  $("#miniBarFill").style.width = (frac*100) + "%";
}

/* ─────────────────────────── Ueber ───────────────────────────────────── */
function renderAbout(){
  $("#s-about").innerHTML = '<div class="pad" style="padding-top:6px">' +
    '<div class="aboutBlock"><div class="logoTile">🎧</div>' +
    '<div class="aboutTitle">BeatClip</div><div class="aboutVer">v' + APP_VER + ' · Build ' + APP_BUILD + ' · ' + (NATIVE ? NATIVE_OS + '-App' : 'PWA (Android + iOS)') + ' · Offline</div>' +
    '<div class="aboutText">Spielt lokal gespeicherte Audiodateien. Jeder Titel in einer ' +
    'Playlist hat eigene Start- und Endmarken - abgespielt wird nur der Abschnitt dazwischen. ' +
    'Musik geht per Bluetooth an deinen Lautsprecher. Mikrofonaufnahmen und Kanal-Export sind ebenfalls möglich.</div></div>' +
    '<div class="sectionHeading">Plattform-Hinweise <span class="line"></span></div>' +
    '<div class="panel" style="padding:12px 14px">' +
    '<div class="stepline"><span class="num">🤖</span><span><b>Android:</b> ' +
    (NATIVE ? 'Natives App-Paket (Capacitor) mit Hintergrund-Dienst: Titel/Cover in der Medien-' +
      'Benachrichtigung und auf dem Sperrbildschirm, Bluetooth-Knopfe (A2DP/AVRCP) steuern Play/Weiter/Zurueck. ' +
      'Audiodateien aus anderen Apps werden per "Teilen" automatisch uebernommen.'
      : 'Chrome oeffnet die App randlos, Bluetooth-Ausgabe folgt der System-Media-Ausgabe (A2DP). ' +
      'Media Session liefert Titel/Cover auf den Sperrbildschirm, BT-Fernbedienungen steuern Play/Weiter/Zurueck.') +
    '</span></div>' +
    '<div class="stepline"><span class="num">🍏</span><span>' +
    (NATIVE_OS === "iOS"
      ? '<b>iOS/iPadOS:</b> Natives App-Paket (Capacitor) mit AVAudioSession: Wiedergabe laeuft auch bei ' +
        'gesperrtem Bildschirm und im Hintergrund. Titel/Cover erscheinen in "Now Playing" (Kontrollzentrum, ' +
        'Sperrbildschirm, Lockscreen), Bluetooth-/Headset-Knopfe steuern Play/Weiter/Zurueck. Audiodateien aus ' +
        'der Dateien-App per "Offnen in → BeatClip" uebernehmen. Lautsprecher ueber AirPlay waehlbar. ' +
        'Formate: MP3, AAC/M4A, WAV, ALAC, FLAC.'
      : '"Zum Startbildschirm hinzufuegen" installiert als App. Wiedergabe laeuft auch bei gesperrtem ' +
        'Bildschirm; Lautsprecher waehlbar ueber Kontrollzentrum → AirPlay. Formate: MP3, AAC/M4A, WAV ' +
        '(FLAC je nach Browser).') +
    '</span></div>' +
    '<div class="stepline"><span class="num">🔊</span><span>Unterstuetzte Formate im Browser: ' +
    'MP3, M4A/AAC, OGG/Opus, WAV; FLAC je nach Geraet.</span></div>' +
    '</div>' +
    '<div class="infoBlock">Alle Dateien und Schnitte bleiben ausschliesslich lokal auf diesem Geraet ' +
    '(IndexedDB, optionale persistente Speicherung). Kein Konto, keine Netzwerkuebertragung. ' +
    'Aufnahmen werden erst nach dem Stoppen in der Bibliothek gespeichert; Stereo-Kanäle lassen sich als WAV, MP3 oder (in der nativen App) als M4A speichern.</div>' +
    '</div>';
}

/* ─────────────────────── Aktionen (data-act) ─────────────────────────── */
async function handle(act, el){
  const ds = el.dataset;
  switch (act){
    case "theme":
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      applyTheme(); saveSettings(); refreshCurrent(); break;
    case "back": back(); break;
    case "go-player": go("player"); break;
    case "go-about": go("about"); break;
    case "open-pl": state.ui.activePl = ds.pl; go("pl"); break;
    case "pl-sort": state.ui.plSort = ds.s; renderPlDetail(); break;
    case "pl-menu": openPlMenu(ds.pl); break;
    case "pl-rename": { const pl = playlist(ds.pl);
      const n = prompt("Name der Playlist:", pl.name);
      if (n && n.trim()){ pl.name = n.trim(); await savePlaylist(pl); toast("Umbenannt"); refreshCurrent(); }
      closeSheet(); break; }
    case "pl-delete": { const pl = playlist(ds.pl);
      if (state.playlists.length <= 1){ toast("Mindestens eine Playlist muss bleiben", true); closeSheet(); break; }
      if (!confirm("Playlist '" + pl.name + "' wirklich loeschen?")) { closeSheet(); break; }
      state.playlists = state.playlists.filter(p => p.id !== ds.pl);
      await idbDel("playlists", ds.pl);
      closeSheet(); toast("Playlist geloescht"); go("playlists", false); break; }
    case "play-single": {
      let found = state.playlists.flatMap(p => p.items.map(i => ({pl:p, it:i}))).find(x => x.it.trackId === ds.t);
      if (!found){ const pl = state.playlists[0]; found = { pl, it:{ id:uid(), trackId:ds.t, cut:null } };
        pl.items.push(found.it); await savePlaylist(pl); }
      playItem(found.it.id, found.pl.id); break; }
    case "play-item": playItem(ds.i, ds.pl); break;
    case "play-pl": { const p = playlist(ds.pl);
      if (!p.items.length){ toast("'" + p.name + "' ist leer - erst Titel hinzufuegen", true); break; }
      playQueue(p.id, p.items[0].id); break; }
    case "play-next": nextTrack(true); break;
    case "toggle-play": togglePlay(); break;
    case "next": nextTrack(true); break;
    case "prev": prevTrack(); break;
    case "tgl-shuffle": state.settings.shuffle = !state.settings.shuffle; saveSettings(); refreshCurrent(); break;
    case "cycle-repeat": { const r = state.settings.repeat;
      state.settings.repeat = r === "all" ? "one" : r === "one" ? "off" : "all";
      saveSettings(); refreshCurrent(); break; }
    case "seek-start": { const s = span(); if (s){ audio.currentTime = s.start; armEndWatchdog(); } break; }
    case "seek-end": { const s = span(); if (s){ audio.currentTime = Math.max(s.start, s.end - .2); armEndWatchdog(); } break; }
    case "edit-cut": closeSheet(); openCutEditor(ds.t, ds.pl || (currentItem() ? currentItem().pl.id : null)); break;
    case "track-menu": openTrackMenu(ds.t, ds.i, ds.pl); break;
    case "lib-menu": state.ui.pickerTrack = ds.t; openTrackMenu(ds.t, null, null); break;
    case "extract-channels": closeSheet(); await extractChannels(ds.t); break;
    case "share-channel": {
      if (state.ui.exportBusy) break;
      if (channelExportFormat === "m4a"){ toast("M4A nur ueber \u2B07 Speichern sichern \u2013 Teilen geht hier mit WAV oder MP3", true); break; }
      const job = exportJob;
      try{
        const file = await exportFile(Number(ds.index), exportStatus);
        if (!file){ toast("Exportdatei nicht mehr verfuegbar", true); break; }
        if (!exportAlive(job)) break;
        if (typeof navigator.share !== "function"){ toast("Teilen wird auf diesem Gerät nicht unterstützt", true); break; }
        exportStatus("Teilen wird vorbereitet…", null);
        await navigator.share({ files:[file], title:file.name });
      }catch(error){
        if (error !== EXPORT_ABORT && error.name !== "AbortError"){
          console.error("Datei konnte nicht geteilt werden:", error);
          toast("Datei konnte nicht geteilt werden:" + error.message, true);
        }
      }finally{
        if (exportAlive(job)) exportStatus(null);
      }
      break;
    }
    case "export-format": {
      if (state.ui.exportBusy) break;
      const f = ds.fmt;
      if (!EXPORT_FORMATS[f]) break;
      if (f === "m4a" && !nativeM4aAvailable()){ toast("M4A ist nur in der nativen BeatClip-App verfuegbar", true); break; }
      channelExportFormat = f;
      renderChannelExportSheet();
      break;
    }
    case "save-channel": await saveChannelExport(Number(ds.index)); break;
    case "record-start": await startRecording(); break;
    case "record-stop": stopRecording(); break;
    case "add-to-pl-t": state.ui.pickerTrack = ds.t; openAddToPl(); break;
    case "add-track": openPlAddTrack(ds.pl); break;
    case "pl-add-pick": { const pl = playlist(ds.pl);
      const tid = state.ui.pickerTrack; if (!tid) { closeSheet(); break; }
      if (!pl.items.some(i => i.trackId === tid)){
        pl.items.push({ id:uid(), trackId:tid, cut:null }); await savePlaylist(pl);
        toast("➕ → " + pl.name);
      } closeSheet(); refreshCurrent(); break; }
    case "pl-add-track": { const pl = playlist(ds.pl);
      pl.items.push({ id:uid(), trackId:ds.t, cut:null }); await savePlaylist(pl);
      closeSheet(); toast("Hinzugefuegt"); refreshCurrent(); break; }
    case "cut-remove": { const pl = playlist(ds.pl); const it = pl.items.find(i => i.id === ds.i);
      if (it){ it.cut = null; await savePlaylist(pl); toast("Schnitt entfernt - ganzer Titel"); }
      closeSheet(); refreshCurrent(); renderMini(); break; }
    case "pl-remove": { const pl = playlist(ds.pl);
      pl.items = pl.items.filter(i => i.id !== ds.i); await savePlaylist(pl);
      closeSheet(); toast("Aus Playlist entfernt"); refreshCurrent(); break; }
    case "file-remove": {
      if (!confirm("Titel samt Audiodatei vom Geraet loeschen?")) { closeSheet(); break; }
      state.playlists.forEach(p => p.items = p.items.filter(i => i.trackId !== ds.t));
      await Promise.all(state.playlists.map(savePlaylist));
      await idbDel("tracks", ds.t); await idbDel("blobs", ds.t);
      if (urlCache.has(ds.t)){ URL.revokeObjectURL(urlCache.get(ds.t)); urlCache.delete(ds.t); }
      if (state.player.trackId === ds.t){ audio.pause(); audio.removeAttribute("src");
        state.player.trackId = null; state.player.playing = false; }
      state.tracks.delete(ds.t);
      closeSheet(); toast("Vom Geraet geloescht"); refreshCurrent(); renderMini(); break; }
    case "clear-cuts": {
      if (!confirm("Alle Schnitte aller Playlists entfernen?")) break;
      let n = 0;
      for (const p of state.playlists){ let dirty = false;
        p.items.forEach(i => { if (i.cut){ i.cut = null; n++; dirty = true; } });
        if (dirty) await savePlaylist(p); }
      toast(n + " Schnitte geloescht"); refreshCurrent(); renderMini(); break; }
    case "tgl": state.settings[ds.k] = !state.settings[ds.k]; saveSettings(); renderSet(); break;
    case "fade-step": state.settings.fade = (state.settings.fade + .5) > 4 ? 0 : +(state.settings.fade + .5).toFixed(1);
      saveSettings(); renderSet(); toast("Blendzeit: " + state.settings.fade + " s"); break;
    case "sleep": { const opts = [0,15,30,45,60];
      state.settings.sleepMin = opts[(opts.indexOf(state.settings.sleepMin)+1) % opts.length];
      saveSettings(); renderSet();
      toast(state.settings.sleepMin ? "Sleep-Timer: " + state.settings.sleepMin + " min" : "Sleep-Timer aus"); break; }
    case "new-pl": openNewPl(); break;
    case "np-icon": state.ui.npIcon = ds.e;
      $$("[data-act=np-icon]").forEach(c => c.classList.toggle("on", c.dataset.e === ds.e)); break;
    case "np-create": {
      const name = ($("#npName") ? $("#npName").value.trim() : "") || "Neue Playlist";
      const pl = { id:uid(), name, cover:state.ui.npIcon || "🎧", order:state.playlists.length, items:[] };
      state.playlists.push(pl); await savePlaylist(pl);
      closeSheet(); toast("Playlist '" + name + "' angelegt"); renderPlaylists(); break; }
    case "pick-files": $("#filePick").click(); break;
    case "demo-tracks": importDemoTracks(); break;
    case "bt-test": { if (!state.player.trackId){ toast("Erst einen Titel abspielen, dann erkennt die App das Audiogerat", true); break; }
      togglePlay(); toast("▶ Laeuft - Lautsprecher in den Systemeinstellungen waehlen"); break; }
    case "persist": {
      if (!navigator.storage || !navigator.storage.persist){ toast("nicht unterstuetzt", true); break; }
      let p = await navigator.storage.persist();
      toast(p ? "✅ Persistente Speicherung aktiv" : "Anfrage abgelehnt", !p); break; }
    case "fab-cut": {
      const target = state.player.trackId || state.ui.pickerTrack ||
        (state.playlists.flatMap(p=>p.items)[0] ? state.playlists.flatMap(p=>p.items)[0].trackId : null);
      if (!target){ toast("Kein Titel vorhanden - erst importieren", true); break; }
      openCutEditor(target, currentItem() ? currentItem().pl.id : state.ui.activePl); break; }
    case "how-install": openHowInstall(); break;
    case "install": doInstall(); break;
    case "media-status": checkMediaStatus(); break;
    case "media-perm": askMediaPermission(); break;
    case "sheet-close": closeSheet(); refreshCurrent(); break;
    case "cut-save": {
      const it = editedItem(); const pl = playlist(state.ui.editPl);
      if (it && pl){ await savePlaylist(pl);
        toast("✂ Schnitt gespeichert: " + mmssPrecise(it.cut.start) + "-" + mmssPrecise(it.cut.end));
        if (state.player.trackId === it.trackId){
          audio.currentTime = clamp(audio.currentTime, it.cut.start, it.cut.end); armEndWatchdog(); }
      }
      closeSheet(); refreshCurrent(); renderMini(); break; }
    case "cut-reset": { const it = editedItem(); const t = track(state.ui.editTrack);
      it.cut = { start:0, end:t.dur || audio.duration || 0 }; updateEditorHead();
      toast("Schnitt zurueckgesetzt (ganzer Titel)"); break; }
    case "cut-play": {
      const it = editedItem(); const t = track(state.ui.editTrack);
      const mid = it.cut ? (it.cut.start + it.cut.end)/2 : 0;
      if (state.player.trackId !== t.id){
        const url = await blobURL(t.id);
        if (!url){ toast("Datei fehlt", true); break; }
        audio.src = url; state.player.trackId = t.id;
        const found = state.playlists.flatMap(p => p.items.map(i => ({pl:p, it:i}))).find(x => x.it.id === state.ui.editItem);
        if (found){ state.queue = found.pl.items.map(i => i.id); state.qIndex = state.queue.indexOf(found.it.id); }
        await new Promise(res => { audio.addEventListener("loadedmetadata", res, { once:true }); setTimeout(res, 1200); });
      }
      audio.currentTime = clamp(mid, 0, audio.duration);
      await audio.play(); armEndWatchdog(); setupIOSAudioSession(); updateMediaSession();
      renderMini(); refreshCurrent(); break; }
    case "nudge": {
      const it = editedItem(); const t = track(state.ui.editTrack); const d = +ds.d;
      const dur = t.dur || audio.duration || 0;
      if (state.ui.nudgeFocus === "start") it.cut.start = clamp(it.cut.start + d, 0, it.cut.end - 2);
      else it.cut.end = clamp(it.cut.end + d, it.cut.start + 2, dur);
      updateEditorHead(); break; }
    case "nudge-sel": state.ui.nudgeFocus = ds.f;
      $$("[data-act=nudge-sel]").forEach(b => b.classList.toggle("sel", b.dataset.f === ds.f)); break;
  }
}

/* ─────────────────────── PWA: Service Worker + Install ───────────────── */
async function registerSW(){
  if (NATIVE) return;                 // native Shell liefert die Assets selbst aus
  if (!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("sw.js", { scope:"./" });
  }catch(e){ console.warn("SW nicht registriert:", e); }
}
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferredInstall = e;
  $("#btnInstall").hidden = false;
});
async function doInstall(){
  if (deferredInstall){
    deferredInstall.prompt();
    const ch = await deferredInstall.userChoice;
    if (ch.outcome === "accepted"){ toast("App wird installiert 🎉"); $("#btnInstall").hidden = true; }
    deferredInstall = null;
  } else openHowInstall();
}
window.addEventListener("appinstalled", () => { toast("BeatClip installiert ✅"); $("#btnInstall").hidden = true; });
function applyTheme(){
  document.body.dataset.theme = state.settings.theme;
  $("#btnTheme").textContent = state.settings.theme === "dark" ? "🌙" : "☀️";
}

/* ─────────────────────── Events / Init ───────────────────────────────── */
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  if (state.ui.drag || state.ui.reorder || state.ui.dragged) return;
  e.stopPropagation();
  Promise.resolve(handle(el.dataset.act, el)).catch(err => { console.error(err); toast("Fehler: " + err.message, true); });
});
$("#filePick").addEventListener("change", e => {
  if (e.target.files && e.target.files.length) importFiles(e.target.files);
  e.target.value = "";
});
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
});
document.addEventListener("keydown", e => {
  if (e.target.matches("input,textarea")) return;
  if (e.code === "Space"){ e.preventDefault(); togglePlay(); }
  if (e.code === "ArrowRight") nextTrack(true);
  if (e.code === "ArrowLeft") prevTrack();
});

(async function init(){
  applyTheme();
  refreshBtInfo();
  await loadAll();
  await registerSW();
  setupNativeBridge();
  if (NATIVE){
    $("#btnInstall").hidden = true;
    // Hardware-Zuruecktaste: erst Blaetter/Sheets schliessen, dann beenden
    window.beatclipBack = () => {
      if (document.querySelector(".sheet.open")){ closeSheet(); return true; }
      if (!TABS.includes(state.screen)){ back(); return true; }
      return false;
    };
  }
  const startHash = (location.hash||"").replace("#","");
  go(["home","playlists","library","set","about"].includes(startHash) ? startHash : "home", false);
  requestAnimationFrame(loop);
})();
