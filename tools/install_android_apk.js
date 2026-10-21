"use strict";

/* Installiert die gebaute APK per ADB und meldet die anschlissend auf dem Gert
   gemeldete Version (versionName/versionCode) – damit sofort erkennbar ist, ob der
   neue Stand wirklich laeuft. Bei Signaturkonflikt (Debug <-> Release) bricht das
   Skript mit Hinweis ab; --uninstall deinstalliert vorher ohne Rueckfrage
   (App-Daten gehen dabei verloren).

   Usage: node tools/install_android_apk.js <debug|release> [--uninstall]         */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PACKAGE = "com.beatclip.app";
const root = path.resolve(__dirname, "..");

const variant = process.argv[2];
if (variant !== "debug" && variant !== "release") {
  console.error("Usage: node tools/install_android_apk.js <debug|release> [--uninstall]");
  process.exit(1);
}
const forceUninstall = process.argv.slice(3).includes("--uninstall");

function findAdb(){
  const candidates = [
    process.env.ADB,
    path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"),
    "adb",
  ].filter(Boolean);
  return candidates.find(candidate => {
    if (path.isAbsolute(candidate)) return fs.existsSync(candidate);
    try { execFileSync(candidate, ["version"], { stdio: "ignore" }); return true; }
    catch { return false; }
  });
}
const adb = findAdb();
if (!adb) { console.error("adb nicht gefunden (Android SDK platform-tools)."); process.exit(1); }

const apk = path.join(root, "dist", "android", `BeatClip-${variant}.apk`);
if (!fs.existsSync(apk)) { console.error(`APK nicht gefunden: ${apk}`); process.exit(1); }

const run = args => {
  try { return execFileSync(adb, args, { encoding: "utf8" }).trim(); }
  catch (error) { return String(error.stderr || error.stdout || error.message).trim(); }
};
const versionOf = dump => {
  const match = dump.match(/versionCode=(\S+)[\s\S]*?versionName=([^\s]+)/);
  return match ? { code: match[1], name: match[2] } : null;
};

const devices = run(["devices"]).split(/\r?\n/).filter(line => /\tdevice$/.test(line));
if (devices.length !== 1) {
  console.error(`Erwartet genau ein Gert mit USB-Debugging, gefunden: ${devices.length}`);
  if (devices.length) console.error(devices.join("\n"));
  process.exit(1);
}
console.log("Gert: " + devices[0]);

const before = versionOf(run(["shell", "dumpsys", "package", PACKAGE]));
console.log(before ? `Vorher installiert: versionName ${before.name}, versionCode ${before.code}`
                   : "BeatClip ist noch nicht installiert.");

let result = run(["install", "-r", apk]);
if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(result)){
  if (!forceUninstall){
    console.error(result);
    console.error("Signaturkonflikt Debug vs. Release: die alte Fassung muss vorher runter\n" +
                  "(dabei gehen App-Daten verloren). Erneuter Aufruf mit --uninstall.");
    process.exit(1);
  }
  console.log("Signaturkonflikt – deinstalliere die alte Fassung (App-Daten gehen verloren)…");
  run(["uninstall", PACKAGE]);
  result = run(["install", "-r", apk]);
}
if (result) console.log(result);

const after = versionOf(run(["shell", "dumpsys", "package", PACKAGE]));
if (!after) { console.error("Fehler: BeatClip ist nach der Installation nicht als Paket sichtbar."); process.exit(1); }
if (before && before.code === after.code) {
  console.warn(`Achtung: versionCode unveraendert (${after.code}) – ist die APK wirklich neu gebaut?`);
}
console.log(`Installiert jetzt: versionName ${after.name}, versionCode ${after.code}`);
console.log(`In der App muss Einstellungen -> "App-Version" jetzt "(Build ${after.code})" zeigen.`);
