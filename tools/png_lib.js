/* PNG-Erzeugung ohne Fremdabhaengigkeiten + das BeatClip-Symbol.
   Wird von tools/make_icons.js und tools/make_android_assets.js genutzt. */
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
const lerp = (a,b,t) => a + (b-a)*t;

/**
 * Icon als RGBA-Puffer.
 *  opts: { rounded:boolean, radius:number, glyphScale:number, background:"gradient"|"flat"|"transparent", pad:number }
 */
function drawIcon(size, opts = {}){
  const rounded = opts.rounded !== false;
  const radius = opts.radius != null ? opts.radius : size*0.22;
  const pad = opts.pad || 0;
  const glyphScale = opts.glyphScale || 1;
  const bg = opts.background || "gradient";
  const buf = Buffer.alloc(size*size*4);
  const c1 = [0,184,169], c2 = [14,116,144];
  const inSize = (size - pad*2) * glyphScale;
  const cx0 = pad + (size - pad*2)/2 - inSize/2;
  const cy0 = pad + (size - pad*2)/2 - inSize/2;

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
        const t = (x+y)/(size*2);
        buf[i]   = lerp(c1[0],c2[0],t);
        buf[i+1] = lerp(c1[1],c2[1],t);
        buf[i+2] = lerp(c1[2],c2[2],t);
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
  const off = drawIcon(logoSize, { rounded:true, radius:logoSize*0.22 });
  const ox = Math.floor((w-logoSize)/2), oy = Math.floor((h-logoSize)/2);
  for (let y = 0; y < logoSize; y++){
    const ty = oy + y; if (ty < 0 || ty >= h) continue;
    off.copy(buf, (ty*w + ox)*4, y*logoSize*4, (y+1)*logoSize*4);
  }
  return buf;
}

module.exports = { png, drawIcon, drawSplash };
