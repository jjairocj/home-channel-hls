# 08. Internationalization & Adding Languages

Home Channel HLS includes a lightweight, zero-dependency internationalization engine that enables anyone to localize the application into their native language.

---

## How It Works

1. **Locale Dictionaries:** Stored as JSON files in `public/locales/<lang_code>.json`.
2. **Dynamic UI Translation:** Elements in the HTML marked with `data-i18n="section.key"` are translated automatically.
3. **Client-Side Switcher:** Language preference is stored in `localStorage` and can be switched at runtime from the top bar.

---

## Contributing a New Language

To add a new language (e.g., French `fr.json`):

1. Navigate to the `public/locales/` directory.
2. Copy `en.json` to `fr.json`:
   ```bash
   cp public/locales/en.json public/locales/fr.json
   ```
3. Translate the string values while keeping the JSON keys identical:
   ```json
   {
     "app": {
       "title": "Home Channel HLS",
       "status": {
         "on_air": "EN DIRECT"
       }
     }
   }
   ```
4. Add the language code to `this.supportedLanguages` in `public/shared/i18n.js` if you want it included in the official language selector toggle.
5. Submit a pull request to share it with the community!
