#!/usr/bin/env node
// BeatClip – hält die projektinterne Ziel-Abhängigkeit App -> Pods-App aktuell.
//
// ios/App/App.xcodeproj enthält eine Abhängigkeit auf das Target "Pods-App" aus dem Pods-Projekt
// (ios/App/Pods/Pods.xcodeproj). CocoaPods integriert Pods normalerweise nur über das Workspace
// (App.xcworkspace); wer trotzdem App.xcodeproj direkt in Xcode öffnet, bekam
//   error: Unable to resolve module dependency: 'Capacitor' / 'BeatclipMedia'
// weil dann kein Pods-Target mitgebaut wird. Mit der Abhängigkeit funktionieren beide Wege.
// Dieses Skript passt die im .xcodeproj hinterlegte Ziel-ID an, falls `pod install` sie ändert.
//
// Aufruf: node tools/ios_pods_dependency.js

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appProjPath = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');
const podsProjPath = path.join(root, 'ios/App/Pods/Pods.xcodeproj/project.pbxproj');

if (!fs.existsSync(podsProjPath)) {
  console.error('Pods-Projekt fehlt: ios/App/Pods – vorher `npx cap sync ios` und `pod install` in ios/App/ laufen lassen.');
  process.exit(1);
}

// 1) Aktuelle Ziel-ID des Targets "Pods-App" im Pods-Projekt.
const podsSrc = fs.readFileSync(podsProjPath, 'utf8');
let want = null;
for (const m of podsSrc.matchAll(/([0-9A-F]{24,32})\s*\/\* ([^*]+) \*\/ = \{\n\t{3}isa = PBXNativeTarget;/g)) {
  if (m[2] === 'Pods-App') { want = m[1]; break; }
}
if (!want) {
  console.error('Target "Pods-App" nicht in ios/App/Pods/Pods.xcodeproj gefunden.');
  process.exit(1);
}

// 2) Abhängigkeit im App-Projekt: PBXContainerItemProxy mit proxyType = 1, remoteInfo Pods-App.
let src = fs.readFileSync(appProjPath, 'utf8');
const sec = src.match(/\/\* Begin PBXContainerItemProxy section \*\/([\s\S]*?)\/\* End PBXContainerItemProxy section \*\//);
if (!sec) {
  console.error('PBXContainerItemProxy fehlt in ios/App/App.xcodeproj – Abhängigkeit App -> Pods-App fehlt.');
  process.exit(1);
}
const entry = [...sec[1].matchAll(/([0-9A-F]{24,32}\s*\/\* PBXContainerItemProxy \*\/ = \{[\s\S]*?\};)/g)]
  .map(m => m[0])
  .find(t => /proxyType = 1;/.test(t) && /remoteInfo = "?Pods-App"?;/.test(t));
if (!entry) {
  console.error('Die Abhängigkeit App -> Pods-App fehlt in ios/App/App.xcodeproj (project.pbxproj).');
  process.exit(1);
}

const have = entry.match(/remoteGlobalIDString = ([0-9A-F]{24,32});/)[1];
if (have === want) {
  console.log('App -> Pods-App Abhängigkeit aktuell (' + want + ').');
  process.exit(0);
}
src = src.replace(entry, entry.replace(have, want));
fs.writeFileSync(appProjPath, src);
console.log('App -> Pods-App Abhängigkeit aktualisiert: ' + have + ' -> ' + want);
