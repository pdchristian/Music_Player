#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   check_translations.js – Pendant zu check_translations.py der WOL-App.

   Prüft die Mehrsprachigkeit des BeatClip:
   1. Verwendete Keys in app/app.js (T("...")) und app/index.html
      (data-i18n / data-i18n-title / data-i18n-aria) – plus die Keys, die
      als reine Schluessel-Werte in EXPORT_FORMATS hinterlegt sind.
   2. Jede Locale-Datei in app/locales/*.json:
      - fehlt ein Key, den der Code benutzt?  -> MISSING
      - existiert ein Key, den der Code nicht benutzt?  -> UNUSED
      - ist der Key nicht alphabetisch sortiert?  -> SORT
      - JSON-Syntaxfehler  -> ERROR

   Aufruf:  node tools/check_translations.js
   Exit-Code 0 = alles ok, 1 = Probleme gefunden.
   ═══════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "app", "app.js");
const INDEX_HTML = path.join(ROOT, "app", "index.html");
const LOCALE_DIR = path.join(ROOT, "app", "locales");

function collectUsedKeys(){
  const used = new Map(); // key -> [fundstellen]
  const add = (key, where) => {
    if (!used.has(key)) used.set(key, []);
    used.get(key).push(where);
  };

  const js = fs.readFileSync(APP_JS, "utf8");
  for (const m of js.matchAll(/(?<![A-Za-z0-9_$.])T\(\s*"([a-z0-9_.]+)"/g))
    add(m[1], "app.js:" + lineOf(js, m.index));
  /* Labels, die nur als Schluessel gespeichert und spaeter mit T(meta.desc)
     aufgeloest werden (EXPORT_FORMATS in app.js): */
  for (const m of js.matchAll(/desc:\s*"(export\.[a-z0-9_.]+)"/g))
    add(m[1], "app.js:" + lineOf(js, m.index));
  /* Statustexte der Lautstaerke-Bruecke: waStateKey() liefert den Key, T() folgt
     erst am Aufrufort in renderSet(). */
  for (const m of js.matchAll(/"(set\.wa_state[a-z_]*)"/g))
    add(m[1], "app.js:" + lineOf(js, m.index));

  const html = fs.readFileSync(INDEX_HTML, "utf8");
  for (const m of html.matchAll(/data-i18n(?:-title|-aria)?="([a-z0-9_.]+)"/g))
    add(m[1], "index.html:" + lineOf(html, m.index));
  /* Titel/Meta werden zur Laufzeit gesetzt, nicht per data-i18n: */
  add("app.title", "translations.js");
  add("app.description", "translations.js");

  return used;
}

function lineOf(text, index){
  return text.slice(0, index).split("\n").length;
}

function main(){
  const used = collectUsedKeys();
  const usedKeys = new Set(used.keys());
  const files = fs.readdirSync(LOCALE_DIR).filter(f => f.endsWith(".json")).sort();
  if (!files.length){
    console.error("FEHLER: keine Locale-Dateien in app/locales/ gefunden");
    process.exit(1);
  }

  let problems = 0;
  const allKeySets = new Map();

  for (const file of files){
    const lang = file.replace(/\.json$/, "");
    const full = path.join(LOCALE_DIR, file);
    let dict;
    try{
      dict = JSON.parse(fs.readFileSync(full, "utf8"));
    }catch(e){
      console.error(`\n[ERROR] ${file}: gueltiges JSON fehlt/kaputt: ${e.message}`);
      problems++;
      continue;
    }
    const keys = Object.keys(dict);
    allKeySets.set(lang, new Set(keys));

    const missing = [...usedKeys].filter(k => !(k in dict)).sort();
    const unused  = keys.filter(k => !usedKeys.has(k)).sort();
    const notSorted = keys.filter((k, i) => i > 0 && keys[i-1].localeCompare(k) > 0);

    console.log(`\n[${lang}] ${keys.length} Keys, verwendet: ${usedKeys.size}`);
    if (missing.length){
      problems++;
      console.log(`  FEHLEND (${missing.length}):`);
      for (const k of missing) console.log(`    - ${k}   (benutzt in: ${used.get(k)[0]})`);
    }
    if (unused.length){
      console.log(`  UNGENUTZT (${unused.length}):`);
      for (const k of unused) console.log(`    - ${k}`);
    }
    if (notSorted.length){
      problems++;
      console.log(`  NICHT ALPHABETISCH SORTIERT (${notSorted.length}): ${notSorted.slice(0, 10).join(", ")}${notSorted.length > 10 ? " ..." : ""}`);
    }
    if (!missing.length && !unused.length && !notSorted.length) console.log("  OK");
  }

  /* Key-Mengen zwischen den Sprachen abgleichen (Fallback EN -> Schluessel): */
  const langs = [...allKeySets.keys()];
  const base = allKeySets.get("en") || allKeySets.get(langs[0]);
  for (const lang of langs){
    const set = allKeySets.get(lang);
    const diff = [...base].filter(k => !set.has(k)).sort();
    if (diff.length){
      problems++;
      console.log(`\n[CROSS] ${lang}.json fehlen Keys aus ${langs[0] === lang ? "?" : "Basis"}: ${diff.join(", ")}`);
    }
  }

  console.log(`\n${problems === 0 ? "OK – alle Uebersetzungen konsistent." : problems + " Problem(e) gefunden."}`);
  process.exit(problems ? 1 : 0);
}

main();
