/**
 * Home Channel HLS - Lightweight Internationalization (i18n) Engine
 * Supports runtime language switching, DOM data-i18n translation, and string interpolation.
 */

class I18nManager {
  constructor() {
    this.currentLang = localStorage.getItem('channel_lang') || (navigator.language && navigator.language.startsWith('es') ? 'es' : 'en');
    this.translations = {};
    this.supportedLanguages = [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Español' }
    ];
    this.loaded = false;
  }

  async init() {
    try {
      await this.loadLanguage(this.currentLang);
    } catch (e) {
      console.warn('[i18n] Failed to load preferred language, falling back to English:', e.message);
      if (this.currentLang !== 'en') {
        await this.loadLanguage('en');
        this.currentLang = 'en';
      }
    }
    this.loaded = true;
    this.apply();
  }

  async loadLanguage(lang) {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading locale ${lang}`);
    this.translations = await res.json();
    this.currentLang = lang;
    localStorage.setItem('channel_lang', lang);
  }

  async setLanguage(lang) {
    if (lang === this.currentLang && this.loaded) return;
    await this.loadLanguage(lang);
    this.apply();
    // Update all switcher buttons in DOM
    document.querySelectorAll('.lang-switcher .lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
    window.dispatchEvent(new CustomEvent('channel:languageChanged', { detail: { lang } }));
  }

  t(keyPath, params = {}) {
    const parts = keyPath.split('.');
    let value = this.translations;
    for (const p of parts) {
      if (value && typeof value === 'object' && p in value) {
        value = value[p];
      } else {
        value = null;
        break;
      }
    }

    if (typeof value !== 'string') {
      return keyPath;
    }

    return value.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
  }

  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key);
      }
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', this.t(key));
      }
    });

    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', this.t(key));
      }
    });
  }

  renderSwitcher(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="lang-switcher">
        <span class="lang-icon">🌐</span>
        <button type="button" class="lang-btn ${this.currentLang === 'en' ? 'active' : ''}" data-lang="en">EN</button>
        <button type="button" class="lang-btn ${this.currentLang === 'es' ? 'active' : ''}" data-lang="es">ES</button>
      </div>
    `;

    container.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lang = e.currentTarget.getAttribute('data-lang');
        this.setLanguage(lang);
      });
    });
  }
}

export const i18n = new I18nManager();
if (typeof window !== 'undefined') {
  window.i18n = i18n;
  document.addEventListener('DOMContentLoaded', () => i18n.init());
}
