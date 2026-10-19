/* Erzeugt die Android-Ressourcen (Launcher-Icons, Splash) im Capacitor-Projekt.
   Mehrere Groessen je Dichte, damit der Startbildschirm scharf bleibt:
     mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png (+ _round)
     drawable-nodpi/ic_launcher_foreground.png   (adaptive Icon, Safe-Area)
     drawable-{port,land}-{mdpi..xxxhdpi}/splash.png
     store/icon-512.png                           (Store-Asset)
   Aufruf:  node tools/make_android_assets.js
*/
const fs = require("fs");
const path = require("path");
const { png, drawIcon, drawSplash } = require("./png_lib");

const res = path.join(__dirname, "..", "android", "app", "src", "main", "res");

const DENSITIES = [
  { dir: "mdpi",    launcher: 48,  adaptive: 108, splash: [320, 470] },
  { dir: "hdpi",    launcher: 72,  adaptive: 162, splash: [480, 640] },
  { dir: "xhdpi",   launcher: 96,  adaptive: 216, splash: [720, 960] },
  { dir: "xxhdpi",  launcher: 144, adaptive: 324, splash: [960, 1280] },
  { dir: "xxxhdpi", launcher: 192, adaptive: 432, splash: [1440, 1920] },
];

function write(file, buf){
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

for (const d of DENSITIES){
  // Launcher-Symbole (klassisch, abgerundete Kachel)
  write(path.join(res, `mipmap-${d.dir}`, "ic_launcher.png"),
    png(d.launcher, d.launcher, drawIcon(d.launcher, { rounded: true, radius: d.launcher*0.22 })));
  write(path.join(res, `mipmap-${d.dir}`, "ic_launcher_round.png"),
    png(d.launcher, d.launcher, drawIcon(d.launcher, { rounded: true, radius: d.launcher/2 })));

  // Adaptive Icons: weisses Notensymbol in der Safe-Area, Hintergrund = Verlauf-Drawable
  // (Layer selbst ist transparent, damit ic_launcher_bg.xml – der WOL-Verlauf – durchscheint
  //  und der monochrome Layer fuer Theme-Icons funktionieren kann)
  write(path.join(res, `mipmap-${d.dir}`, "ic_launcher_foreground.png"),
    png(d.adaptive, d.adaptive, drawIcon(d.adaptive, { rounded: false, radius: 0, pad: Math.round(d.adaptive*0.26), background: "transparent" })));

  // Splash (Hoch- und Querformat)
  const [sw, sh] = d.splash;
  const logo = Math.round(Math.min(sw, sh) * 0.34);
  write(path.join(res, `drawable-port-${d.dir}`, "splash.png"), png(sw, sh, drawSplash(sw, sh, logo)));
  write(path.join(res, `drawable-land-${d.dir}`, "splash.png"), png(sh, sw, drawSplash(sh, sw, logo)));
}

// Grosses Store-Asset
const store = path.join(__dirname, "..", "store");
write(path.join(store, "icon-512.png"), png(512, 512, drawIcon(512, { rounded: false, radius: 0, pad: 0 })));

console.log("Android-Ressourcen erzeugt:", DENSITIES.map(d => d.dir).join(", "));
