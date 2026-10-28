# Internationalization & Translations / Internacionalización y Traducciones

This directory contains translation dictionaries for **Home Channel HLS**.

## How to add a new language / Cómo agregar un nuevo idioma

Adding support for a new language is as simple as creating a JSON file:

1. Duplicate `en.json` (or `es.json`).
2. Name it with your 2-letter ISO 639-1 language code (e.g., `fr.json` for French, `pt.json` for Portuguese, `de.json` for German, `it.json` for Italian, `ja.json` for Japanese).
3. Translate the string values while keeping the JSON keys untouched.
4. Place the file in this folder (`public/locales/<lang>.json`).
5. The language switcher will automatically detect and allow users to select your language!

---

## Estructura de Claves / Key Structure

- `app`: Channel branding, titles, and high-level states (ON AIR, OFF AIR).
- `nav`: Sidebar and top navigation links.
- `live`: Live player monitor, stream metrics, clock sync, and manual controls.
- `programming`: EPG grid, rule composer, and slot controls.
- `shows`: Media catalog, series management, and episode ordering.
- `commercials`: Commercial breaks, bumpers, and interstitial rotation.
- `transcoder`: Background FFmpeg transcode queue and progress.
- `upload`: Legal media file ingest and browser chunked uploader.
- `audience`: Real-time viewer metrics and analytics.
- `common`: Reusable buttons, dialogs, and standard actions.
