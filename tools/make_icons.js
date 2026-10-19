/* Erzeugt die Web-Icons der App (PWA) in app/icons/:
     icon-192.png, icon-512.png        - abgerundete Kachel (Android/iOS-Browser)
     icon-maskable-512.png             - randlos, Symbol in der Safe-Area
   Aufruf:  node tools/make_icons.js
*/
const fs = require("fs");
const path = require("path");
const { png, drawIcon } = require("./png_lib");

const out = path.join(__dirname, "..", "app", "icons");
fs.mkdirSync(out, { recursive: true });

fs.writeFileSync(path.join(out, "icon-192.png"),
  png(192, 192, drawIcon(192, { rounded: true, radius: 192*0.22 })));
fs.writeFileSync(path.join(out, "icon-512.png"),
  png(512, 512, drawIcon(512, { rounded: true, radius: 512*0.22 })));
fs.writeFileSync(path.join(out, "icon-maskable-512.png"),
  png(512, 512, drawIcon(512, { rounded: false, radius: 0, pad: 512*0.20 })));

console.log("Web-Icons erzeugt:", fs.readdirSync(out).join(", "));
