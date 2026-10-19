/* PNG-Erzeugung und -Einlesung ohne Fremdabhaengigkeiten + das BeatClip-Symbol.
   Wird von tools/make_icons.js, tools/make_android_assets.js und tools/make_ios_assets.js genutzt.
   Alle Launcher-/Store-Icons werden aus der Master-Vorlage Music_Player_full.png gerastert. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf){
  const table = [];
  for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba){
  const raw = Buffer.alloc((width*4 + 1) * height);
  for (let y = 0; y < height; y++){
    raw[y*(width*4+1)] = 0;
    rgba.copy(raw, y*(width*4+1)+1, y*width*4, (y+1)*width*4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/* ── PNG lesen (nur 8-Bit RGB/RGBA, nicht interlaced – so ist Music_Player_full.png gebaut) ── */
function readPng(file){
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Keine PNG-Datei: " + file);
  let pos = 8, ihdr = null, idat = [];
  while (pos + 8 <= buf.length){
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos+4, pos+8);
    const data = buf.subarray(pos+8, pos+8+len);
    if (type === "IHDR")
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || (ihdr.color !== 6 && ihdr.color !== 2) || ihdr.interlace !== 0)
    throw new Error("Nur 8-Bit RGB/RGBA PNGs ohne Interlacing unterstuetzt: " + file);
  const ch = ihdr.color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch;
  const out = Buffer.alloc(ihdr.w * ihdr.h * 4);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < ihdr.h; y++){
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++){
      const a = x >= ch ? cur[x-ch] : 0, b = prev[x], c = x >= ch ? prev[x-ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4){
        const pp = a + b - c, pa = Math.abs(pp-a), pb = Math.abs(pp-b), pc = Math.abs(pp-c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    cur.copy(prev);
    for (let x = 0; x < ihdr.w; x++){
      const i = (y*ihdr.w + x)*4;
      out[i]   = cur[x*ch];
      out[i+1] = cur[x*ch+1];
      out[i+2] = cur[x*ch+2];
      out[i+3] = ch === 4 ? cur[x*ch+3] : 255;
    }
  }
  return { width: ihdr.w, height: ihdr.h, rgba: out };
}

/* Box-Filter (Flaechenmittel) – geeignet zum Herunterskalieren des Masters. */
function scaleImage(img, w, h){
  const out = Buffer.alloc(w*h*4);
  const xR = img.width / w, yR = img.height / h;
  for (let y = 0; y < h; y++){
    const y0 = Math.floor(y*yR), y1 = Math.min(img.height, Math.max(y0+1, Math.ceil((y+1)*yR)));
    for (let x = 0; x < w; x++){
      const x0 = Math.floor(x*xR), x1 = Math.min(img.width, Math.max(x0+1, Math.ceil((x+1)*xR)));
      let r=0, g=0, b=0, a=0, n=0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++){
          const i = (sy*img.width + sx)*4;
          r += img.rgba[i]; g += img.rgba[i+1]; b += img.rgba[i+2]; a += img.rgba[i+3]; n++;
        }
      const j = (y*w + x)*4;
      out[j] = Math.round(r/n); out[j+1] = Math.round(g/n); out[j+2] = Math.round(b/n); out[j+3] = Math.round(a/n);
    }
  }
  return { width: w, height: h, rgba: out };
}

const lerp = (a,b,t) => a + (b-a)*t;

/* Hintergrund-Verlauf identisch zur WOL-App: vertikaler Teal-Verlauf
   (oben #38a790, unten #287767), siehe WOL res/drawable-nodpi/ic_launcher_background.png */
const BG_TOP = [56,167,144], BG_BOTTOM = [40,119,103];

/* ── Master-Vorlage: Music_Player_full.png (weisse Note auf Teal-Verlauf) ── */
let _master = null;
function masterIcon(){
  if (_master) return _master;
  const m = readPng(path.join(__dirname, "..", "Music_Player_full.png"));
  // Master ist fast opak (Alpha 115..255); fuer saubere Kanten auf den
  // Referenz-Verlauf kompositieren -> vollstaendig opakes Vollflaechen-Icon.
  const { width: w, height: h, rgba } = m;
  for (let y = 0; y < h; y++){
    const t = h > 1 ? y/(h-1) : 0;
    for (let x = 0; x < w; x++){
      const i = (y*w + x)*4, a = rgba[i+3];
      if (a === 255) continue;
      const inv = 255 - a;
      rgba[i]   = Math.round((rgba[i]*a   + lerp(BG_TOP[0],BG_BOTTOM[0],t)*inv) / 255);
      rgba[i+1] = Math.round((rgba[i+1]*a + lerp(BG_TOP[1],BG_BOTTOM[1],t)*inv) / 255);
      rgba[i+2] = Math.round((rgba[i+2]*a + lerp(BG_TOP[2],BG_BOTTOM[2],t)*inv) / 255);
      rgba[i+3] = 255;
    }
  }
  _master = m;
  return _master;
}

/* Weisse Note als freigestelltes RGBA (Alpha aus Weissgrad, zugeschnitten).
   Teal-Hintergrund: min(R,G,B) <= 56; weisse Note: 255. */
let _glyph = null;
function masterGlyph(){
  if (_glyph) return _glyph;
  const m = masterIcon();
  const { width: w, height: h, rgba } = m;
  const alpha = new Uint8Array(w*h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < w*h; i++){
    const v = Math.min(rgba[i*4], rgba[i*4+1], rgba[i*4+2]);
    const a = v <= 60 ? 0 : Math.min(255, Math.round((v-60)*255/195));
    alpha[i] = a;
    if (a > 8){
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const gw = maxX - minX + 1, gh = maxY - minY + 1;
  const out = Buffer.alloc(gw*gh*4);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++){
      const i = (y*gw + x)*4;
      out[i] = 255; out[i+1] = 255; out[i+2] = 255;
      out[i+3] = alpha[(y+minY)*w + (x+minX)];
    }
  _glyph = { width: gw, height: gh, minX: minX, minY: minY, rgba: out };
  return _glyph;
}

/**
 * Icon aus der Master-Vorlage als RGBA-Puffer fuer png().
 *  opts: { mask:"none"|"rounded"|"circle", radius:number,
 *          glyphOnly:boolean, glyphFill:number, keepOffset:boolean }
 *  glyphOnly=true: nur die weisse Note (transparente Ebene fuer adaptive Icons),
 *  glyphFill: Gewuenschte Symbolhoehe als Anteil der Canvas-Kante,
 *  keepOffset=true: die Position der Note im Master bleibt erhalten (bewusst
 *             platzierte Asymmetrie) statt sie zu zentrieren.
 */
function iconFromMaster(size, opts = {}){
  const mask = opts.mask || "none";
  const radius = opts.radius != null ? opts.radius : size*0.22;
  const buf = Buffer.alloc(size*size*4);
  if (opts.glyphOnly){
    const target = Math.max(1, Math.round(size * (opts.glyphFill != null ? opts.glyphFill : 0.60)));
    if (opts.keepOffset){
      // Freigestellte Note auf glyphFill skaliert, aber an der Position im Master
      // platziert (bewusste Asymmetrie): Offset relativ zur Master-Kante beibehalten.
      const m = masterIcon();
      const g = masterGlyph();
      const s = target / g.height;
      const gw = Math.max(1, Math.round(g.width * s)), gh = Math.max(1, Math.round(g.height * s));
      const scaled = scaleImage(g, gw, gh);
      const relX = (g.minX + g.width/2 - m.width/2) / m.width;
      const relY = (g.minY + g.height/2 - m.height/2) / m.height;
      const px = Math.round(size/2 + relX*size - gw/2);
      const py = Math.round(size/2 + relY*size - gh/2);
      for (let y = 0; y < gh; y++){
        const ty = py + y; if (ty < 0 || ty >= size) continue;
        for (let x = 0; x < gw; x++){
          const tx = px + x; if (tx < 0 || tx >= size) continue;
          const i = (y*gw + x)*4, j = (ty*size + tx)*4;
          if (scaled.rgba[i+3] > buf[j+3]){
            buf[j] = 255; buf[j+1] = 255; buf[j+2] = 255; buf[j+3] = scaled.rgba[i+3];
          }
        }
      }
    } else {
      const glyph = masterGlyph();
      const s = target / glyph.height;
      const gw = Math.max(1, Math.round(glyph.width * s)), gh = Math.max(1, Math.round(glyph.height * s));
      const scaled = scaleImage(glyph, gw, gh);
      const ox = Math.floor((size - gw)/2), oy = Math.floor((size - gh)/2);
      for (let y = 0; y < gh; y++){
        const ty = oy + y; if (ty < 0 || ty >= size) continue;
        scaled.rgba.copy(buf, (ty*size + ox)*4, y*gw*4, (y+1)*gw*4);
      }
      // Ueberall weisse Pixel: RGB bereits weiss; nur Alpha aus Quelle erhalten.
    }
  } else {
    const full = scaleImage(masterIcon(), size, size);
    full.rgba.copy(buf);
  }
  if (mask !== "none"){
    const r = mask === "circle" ? size/2 : radius;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++){
        const ccx = Math.min(Math.max(x, r), size-1-r);
        const ccy = Math.min(Math.max(y, r), size-1-r);
        if (Math.hypot(x-ccx, y-ccy) > r){ buf[(y*size+x)*4+3] = 0; }
      }
  }
  return buf;
}

/* Begrenzungsbox des Notensymbols in Anteilen des Symbol-Kastens (inSize):
   Breite 0.4385, Hoehe 0.545 — daraus folgt glyphFill -> inSize. */
const GLYPH_H = 0.775 - 0.23;
/* Symbolhoehe als Anteil der Canvas-Kante. Orientiert sich am WOL-/Watcher-Icon
   (dort fuellt das Symbol rund 72 % Breite bzw. 80 % Hoehe). */
const GLYPH_FILL = 0.82;
/* Adaptive Icon-Ebene: 108-dp-Canvas, von dem Launcher nur die mittleren 72 dp zeigen. */
const ADAPTIVE_VISIBLE = 72/108;

/**
 * Icon als RGBA-Puffer.
 *  opts: { rounded:boolean, radius:number, glyphFill:number,
 *          background:"gradient"|"flat"|"transparent" }
 *  glyphFill: gewuenschte Symbolhoehe in Prozent der Canvas-Kante
 *             (adaptive Icon-Ebenen brauchen einen kleineren Wert, weil Launcher
 *              nur die mittleren 72/108 dp zeigen).
 */
function drawIcon(size, opts = {}){
  const rounded = opts.rounded !== false;
  const radius = opts.radius != null ? opts.radius : size*0.22;
  const glyphFill = opts.glyphFill != null ? opts.glyphFill : GLYPH_FILL;
  const bg = opts.background || "gradient";
  const buf = Buffer.alloc(size*size*4);
  const inSize = glyphFill*size / GLYPH_H;
  const cx0 = size/2 - inSize/2;
  const cy0 = size/2 - inSize/2;

  const x0 = cx0 + inSize*0.40, x2 = cx0 + inSize*0.62;
  const yTop = cy0 + inSize*0.26, yHead = cy0 + inSize*0.66;
  const w = inSize*0.045, hr = inSize*0.115;
  const head = (x,y,cx,cy,r) => (x-cx)*(x-cx) + (y-cy)*(y-cy) <= r*r;
  const bar  = (x,y,a0,a1,b0,b1) => x >= a0 && x <= a1 && y >= b0 && y <= b1;
  const isGlyph = (x,y) =>
    head(x, y, x0, yHead, hr) ||
    head(x, y, x2, yHead - inSize*0.04, hr*0.9) ||
    bar(x, y, x0 - w/2, x0 + w/2, yTop, yHead) ||
    bar(x, y, x2 - w/2, x2 + w/2, yTop - inSize*0.03, yHead - inSize*0.04) ||
    bar(x, y, x0 - w/2, x2 + w/2, yTop - inSize*0.03, yTop + inSize*0.05);

  for (let y = 0; y < size; y++){
    for (let x = 0; x < size; x++){
      const i = (y*size+x)*4;
      if (rounded && radius > 0){
        const ccx = Math.min(Math.max(x, radius), size-radius);
        const ccy = Math.min(Math.max(y, radius), size-radius);
        if (Math.hypot(x-ccx, y-ccy) > radius){ buf[i+3] = 0; continue; }
      }
      if (bg === "transparent"){ buf[i+3] = 0; }
      else if (bg === "flat"){ buf[i]=15; buf[i+1]=17; buf[i+2]=21; buf[i+3]=255; }
      else {
        const t = size > 1 ? y/(size-1) : 0;
        buf[i]   = lerp(BG_TOP[0],BG_BOTTOM[0],t);
        buf[i+1] = lerp(BG_TOP[1],BG_BOTTOM[1],t);
        buf[i+2] = lerp(BG_TOP[2],BG_BOTTOM[2],t);
        buf[i+3] = 255;
      }
      if (isGlyph(x,y)){ buf[i]=255; buf[i+1]=255; buf[i+2]=255; buf[i+3]=255; }
    }
  }
  return buf;
}

/** Splash: dunkler Grund, Logo mittig, optional Wortmarie als Freiflaeche darunter. */
function drawSplash(w, h, logoSize){
  const buf = Buffer.alloc(w*h*4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++){
      const i = (y*w+x)*4;
      buf[i]=15; buf[i+1]=17; buf[i+2]=21; buf[i+3]=255;
    }
  const off = iconFromMaster(logoSize, { mask: "rounded", radius: logoSize*0.22 });
  const ox = Math.floor((w-logoSize)/2), oy = Math.floor((h-logoSize)/2);
  for (let y = 0; y < logoSize; y++){
    const ty = oy + y; if (ty < 0 || ty >= h) continue;
    off.copy(buf, (ty*w + ox)*4, y*logoSize*4, (y+1)*logoSize*4);
  }
  return buf;
}

module.exports = { png, readPng, scaleImage, drawIcon, drawSplash, iconFromMaster, GLYPH_FILL, ADAPTIVE_VISIBLE };
