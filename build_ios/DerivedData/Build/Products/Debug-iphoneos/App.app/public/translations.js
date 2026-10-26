"use strict";
/* ═══════════════════════════════════════════════════════════════════════
   BeatClip – Mehrsprachigkeit (Pendant zur WOL-App: wol_app/translations.py
   + wol_app/locales/*.json)

   • JSON-Locale-Dateien in app/locales/ (en, de, fr, es)
     – flache Punkt-Keys, alphabetisch sortiert, z. B. "set.theme"
   • Fallback-Kette in tr(): aktuelle Sprache → Englisch → Key selbst
   • Platzhalter: t("toast.imported", { count: 3 })  →  "{count}" im Text
   • Sprache wird in den Einstellungen persistiert und kann zur Laufzeit
     gewechselt werden (setLanguage + Neurender der Screens)
   ═══════════════════════════════════════════════════════════════════════ */
const Translations = (() => {

  /* Unterstützte Sprachen: Code → natives Display-Name (wie in der WOL-App) */
  const LANGUAGES = { en: "English", de: "Deutsch", fr: "Français", es: "Español" };

  let currentLanguage = "en";
  let translations = {};
  let englishTranslations = null;

  /* Locale-JSON laden (SW cached locales/*.json; offline → Cache-Fallback) */
  async function loadLocaleDict(language){
    try{
      const res = await fetch("locales/" + language + ".json");
      if (!res.ok) return {};
      const dict = await res.json();
      return (dict && typeof dict === "object") ? dict : {};
    }catch(e){
      console.warn("Locale-Datei '" + language + ".json' konnte nicht geladen werden:", e);
      return {};
    }
  }

  /* Sprache laden; fehlt sie, fällt sie auf Englisch zurück (wie WOL). */
  async function load(language){
    if (!englishTranslations) englishTranslations = await loadLocaleDict("en");
    currentLanguage = (language in LANGUAGES) ? language : "en";
    if (currentLanguage === "en"){
      translations = englishTranslations;
      return;
    }
    const dict = await loadLocaleDict(currentLanguage);
    translations = Object.keys(dict).length ? dict : englishTranslations;
  }

  /* Systemsprache ermitteln (Browser/Capacitor-WebView liefert navigator.language) */
  function detectLanguage(){
    const prefs = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || "en"];
    for (const pref of prefs){
      const code = String(pref).slice(0, 2).toLowerCase();
      if (code in LANGUAGES) return code;
    }
    return "en";
  }

  /* Übersetzung mit Fallback-Kette + {placeholder}-Ersetzung (wie WOL tr()) */
  function tr(key, params){
    let value = translations[key];
    if (value === undefined && currentLanguage !== "en" && englishTranslations)
      value = englishTranslations[key];
    if (value === undefined) return key;
    if (params)
      value = String(value).replace(/\{(\w+)\}/g,
        (m, name) => (name in params) ? String(params[name]) : m);
    return value;
  }

  /* Statische HTML-Texte übersetzen (data-i18n / data-i18n-title / data-i18n-aria
     in index.html) plus <html lang>, Dokumenttitel und Meta-Description. */
  function applyStaticTexts(){
    document.documentElement.lang = currentLanguage;
    document.title = tr("app.title");
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", tr("app.description"));
    document.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = tr(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.title = tr(el.dataset.i18nTitle);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(el => {
      el.setAttribute("aria-label", tr(el.dataset.i18nAria));
    });
  }

  return {
    /* Initialisierung: bevorzugte Sprache (aus Settings) oder Systemsprache */
    async init(preferred){
      const lang = (preferred && preferred in LANGUAGES) ? preferred : detectLanguage();
      await load(lang);
      applyStaticTexts();
      return currentLanguage;
    },
    /* Sprache zur Laufzeit wechseln (wie Translations.set_language() in WOL) */
    async setLanguage(language){
      await load(language);
      applyStaticTexts();
    },
    getLanguage: () => currentLanguage,
    availableLanguages: () => Object.assign({}, LANGUAGES),
    tr,
    applyStaticTexts,
  };
})();

/* Kurzer Zugriff überall in app.js – entspricht Translations.tr(...) der WOL-App.
   Großes T, weil in app.js viele Scope-Variablen "t" für Tracks existieren. */
const T = (key, params) => Translations.tr(key, params);
