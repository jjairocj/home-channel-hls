# 08. Internacionalización y Agregar Idiomas

Home Channel HLS incluye un motor de internacionalización ligero que permite a cualquier persona traducir la interfaz a su idioma nativo sin necesidad de compilar código.

---

## Cómo Funciona

1. **Diccionarios de Idioma:** Se almacenan como archivos JSON en `public/locales/<codigo_idioma>.json`.
2. **Traducción Dinámica del DOM:** Los elementos con atributos `data-i18n="seccion.clave"` se traducen automáticamente al cargar la página o al cambiar de idioma.
3. **Persistencia:** La preferencia de idioma se guarda en el navegador (`localStorage`) y se puede alternar en cualquier momento desde el selector superior `[EN | ES]`.

---

## Cómo Añadir un Nuevo Idioma

Para añadir un nuevo idioma (por ejemplo, Portugués `pt.json`):

1. Dirígete a la carpeta `public/locales/`.
2. Duplica `es.json` como `pt.json`:
   ```bash
   cp public/locales/es.json public/locales/pt.json
   ```
3. Traduce los textos manteniendo intactas las claves JSON:
   ```json
   {
     "app": {
       "title": "Home Channel HLS",
       "status": {
         "on_air": "NO AR"
       }
     }
   }
   ```
4. Agrega el nuevo código en `this.supportedLanguages` en `public/shared/i18n.js` si deseas que aparezca en el menú desplegable.
5. ¡Envía tu Pull Request para compartir la traducción con la comunidad!
