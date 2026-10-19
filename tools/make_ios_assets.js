/* iOS-Ressourcen fuer das Capacitor-Projekt (ios/App) – reine Node-Skripte,
   keine Bildbibliothek: AppIcon.appiconset (Ein-1024er-Format, Xcode 14+)
   und Splash.imageset (dunkler Grund, Logo mittig).

   Aufruf:  node tools/make_ios_assets.js
   Danach einmal  npx cap sync ios  (aendert nichts an den Assets, kopiert nur Web-UI). */
const fs = require("fs");
const path = require("path");
const { png, drawIcon, drawSplash } = require("./png_lib");

const assets = path.join(__dirname, "..", "ios", "App", "App", "Assets.xcassets");

function write(file, buf){
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  console.log("  +", path.relative(path.join(__dirname, ".."), file));
}

/* ── App-Symbol: modernes Ein-1024er-Format (Xcode erzeugt alle Groessen) ──
   Volle Flaeche ohne abgerundete Ecken: iOS maskiert die Vorlage selbst und
   verlangt ein opakes Bild (kein Alpha-Kanal). Kulisse = vertikaler Teal-Verlauf
   wie bei der WOL-App. */
const appiconDir = path.join(assets, "AppIcon.appiconset");
fs.rmSync(path.join(appiconDir, "AppIcon-512@2x.png"), { force: true });
write(path.join(appiconDir, "AppIcon-1024.png"),
  png(1024, 1024, drawIcon(1024, { rounded: false, radius: 0 })));
fs.writeFileSync(path.join(appiconDir, "Contents.json"), JSON.stringify({
  images: [ { filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" } ],
  info: { author: "xcode", version: 1 },
}, null, 2) + "\n");

/* ── Splash-Bild (Splash.imageset, "universal": iPhone + iPad) ── */
const splashDir = path.join(assets, "Splash.imageset");
// Dateinamen uebernehmen, die Contents.json bereits referenziert; echte Groessen
// sind egal, weil das SplashScreen-Plugin (launchEditMode: adaptive) skaliert.
for (const [file, w] of [["splash-2732x2732-2.png", 957], ["splash-2732x2732-1.png", 1914], ["splash-2732x2732.png", 2871]]){
  const h = Math.round(w * 9 / 16);
  write(path.join(splashDir, file), png(w, h, drawSplash(w, h, Math.round(h * 0.34))));
}
fs.writeFileSync(path.join(splashDir, "Contents.json"), JSON.stringify({
  images: [
    { idiom: "universal", filename: "splash-2732x2732-2.png", scale: "1x" },
    { idiom: "universal", filename: "splash-2732x2732-1.png", scale: "2x" },
    { idiom: "universal", filename: "splash-2732x2732.png",  scale: "3x" },
  ],
  info: { version: 1, author: "xcode" },
}, null, 2) + "\n");

console.log("iOS-Ressourcen erzeugt (AppIcon + Splash).");
