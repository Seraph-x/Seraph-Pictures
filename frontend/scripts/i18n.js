/*
 * Seraph's Pictures - shared lightweight i18n core.
 * Loaded in <head> on every legacy page, alongside theme.js.
 * Exposes window.I18n. Pages register their own dictionaries via I18n.register().
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'seraph-lang';
  var SUPPORTED = ['zh', 'en'];
  var HTML_LANG = { zh: 'zh-CN', en: 'en' };
  // Short label shown on a toggle button = the language currently in use.
  var TOGGLE_LABEL = { zh: '中', en: 'EN' };

  var dict = { zh: {}, en: {} };
  var listeners = [];

  function readSaved() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.indexOf(saved) !== -1 ? saved : null;
    } catch (e) {
      return null;
    }
  }

  // Default language follows the browser: Chinese stays Chinese, everything
  // else falls back to English. A manual choice saved in localStorage wins.
  function detectBrowserLang() {
    try {
      var nav = global.navigator || {};
      var primary = String(
        (nav.languages && nav.languages[0]) || nav.language || nav.userLanguage || ''
      ).toLowerCase();
      if (primary.indexOf('zh') === 0) return 'zh';
    } catch (e) {}
    return 'en';
  }

  var current = readSaved() || detectBrowserLang();

  function register(map) {
    if (!map) return;
    SUPPORTED.forEach(function (lang) {
      if (map[lang]) {
        var table = dict[lang];
        Object.keys(map[lang]).forEach(function (key) {
          table[key] = map[lang][key];
        });
      }
    });
    apply();
  }

  function t(key, params) {
    var table = dict[current] || {};
    var str;
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      str = table[key];
    } else {
      var base = dict[DEFAULT_LANG] || {};
      str = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : key;
    }
    if (params && typeof params === 'object') {
      str = str.replace(/\{(\w+)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : m;
      });
    }
    return str;
  }

  function applyToggle(el) {
    var labelHost = el.querySelector('[data-lang-label]');
    if (labelHost) {
      labelHost.textContent = TOGGLE_LABEL[current];
    } else if (el.children.length === 0) {
      el.textContent = TOGGLE_LABEL[current];
    }
    var hint = current === 'zh' ? '切换到英文' : 'Switch to Chinese';
    el.setAttribute('aria-label', hint);
    el.setAttribute('title', hint);
    el.setAttribute('data-current-lang', current);
  }

  function apply(root) {
    root = root || document;

    if (root === document || root === document.documentElement) {
      document.documentElement.setAttribute('lang', HTML_LANG[current]);
    }

    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    root.querySelectorAll('[data-i18n-value]').forEach(function (el) {
      el.setAttribute('value', t(el.getAttribute('data-i18n-value')));
    });

    root.querySelectorAll('[data-i18n-toggle]').forEach(applyToggle);
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1 || lang === current) {
      if (lang === current) apply();
      return;
    }
    current = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {}
    apply();
    listeners.forEach(function (cb) {
      try {
        cb(lang);
      } catch (e) {}
    });
  }

  function toggle() {
    setLang(current === 'zh' ? 'en' : 'zh');
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  function getLang() {
    return current;
  }

  // Delegate clicks on any [data-i18n-toggle] element to toggle the language,
  // so pages only need the markup, no wiring code.
  document.addEventListener('click', function (e) {
    var toggleEl = e.target.closest ? e.target.closest('[data-i18n-toggle]') : null;
    if (toggleEl) {
      e.preventDefault();
      toggle();
    }
  });

  global.I18n = {
    register: register,
    t: t,
    apply: apply,
    setLang: setLang,
    toggle: toggle,
    onChange: onChange,
    getLang: getLang,
    SUPPORTED: SUPPORTED,
    STORAGE_KEY: STORAGE_KEY
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      apply();
    });
  } else {
    apply();
  }
})(window);
