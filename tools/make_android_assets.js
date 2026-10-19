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
const { png, iconFromMaster, drawSplash } = require("./png_lib");

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
  // Launcher-Symbole (klassisch): Vollflaechen-Icon aus Music_Player_full.png,
  // Maskierung uebernimmt der Launcher; Runde Version mit Kreis-Maske.
  write(path.join(res, `mipmap-${d.dir}`, "ic_launcher.png"),
    png(d.launcher, d.launcher, iconFromMaster(d.launcher)));
  write(path.join(res, `mipmap-${d.dir}`, "ic_launcher_round.png"),
    png(d.launcher, d.launcher, iconFromMaster(d.launcher, { mask: "circle" })));

  // Adaptive Icons: weisse Note (aus dem Master freigestellt) in der Safe-Area,
  // Hintergrund = Verlauf-Drawable ic_launcher_bg.xml (passt zum Master-Verlauf).
  // Die Ebene liegt auf einem 108-dp-Canvas, sichtbar sind nur die mittleren 72 dp;
  // glyphFill 0.468 (= 0.60 um 22 % verkleinert) entspricht der Referenz-Kachel.
  // keepOffset: die im Master bewusst nach links/unten gerueckte Note beibehalten.
  write(path.join(res, `mipmap-${d.dir}`, "ic_launcher_foreground.png"),
    png(d.adaptive, d.adaptive, iconFromMaster(d.adaptive, { glyphOnly: true, glyphFill: 0.468, keepOffset: true })));

  // Splash (Hoch- und Querformat)
  const [sw, sh] = d.splash;
  const logo = Math.round(Math.min(sw, sh) * 0.34);
  write(path.join(res, `drawable-port-${d.dir}`, "splash.png"), png(sw, sh, drawSplash(sw, sh, logo)));
  write(path.join(res, `drawable-land-${d.dir}`, "splash.png"), png(sh, sw, drawSplash(sh, sw, logo)));
}

// Grosses Store-Asset
const store = path.join(__dirname, "..", "store");
write(path.join(store, "icon-512.png"), png(512, 512, iconFromMaster(512)));

console.log("Android-Ressourcen erzeugt:", DENSITIES.map(d => d.dir).join(", "));
