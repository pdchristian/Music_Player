"use strict";

const fs = require("fs");
const path = require("path");

const variant = process.argv[2];
if (variant !== "debug" && variant !== "release") {
  console.error("Usage: node tools/publish_android_apk.js <debug|release>");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const source = path.join(root, "android", "app", "build", "outputs", "apk", variant, `app-${variant}.apk`);
const destinationDir = path.join(root, "dist", "android");
const destination = path.join(destinationDir, `BeatClip-${variant}.apk`);

if (!fs.existsSync(source)) {
  console.error(`Built APK not found: ${source}`);
  process.exit(1);
}

fs.mkdirSync(destinationDir, { recursive: true });
fs.copyFileSync(source, destination);
console.log(`Published ${variant} APK: ${destination}`);
