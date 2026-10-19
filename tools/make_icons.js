/* Erzeugt die Web-Icons der App (PWA) in app/icons/ – gerastert aus Music_Player_full.png:
     icon-192.png, icon-512.png        - Vollflaeche ("any", Browser maskiert selbst)
     icon-maskable-512.png             - randlos, Symbol in der Safe-Area
   Aufruf:  node tools/make_icons.js
*/
const fs = require("fs");
const path = require("path");
const { png, iconFromMaster } = require("./png_lib");

const out = path.join(__dirname, "..", "app", "icons");
fs.mkdirSync(out, { recursive: true });

fs.writeFileSync(path.join(out, "icon-192.png"),
  png(192, 192, iconFromMaster(192)));
fs.writeFileSync(path.join(out, "icon-512.png"),
  png(512, 512, iconFromMaster(512)));
// Maskable: Vollflaechen-Icon; die Note fuellt nur ~54 % der Kante und bleibt
// damit in der mittleren Safe-Area (66 % Kreis).
fs.writeFileSync(path.join(out, "icon-maskable-512.png"),
  png(512, 512, iconFromMaster(512)));

console.log("Web-Icons erzeugt:", fs.readdirSync(out).join(", "));
