(function () {
  "use strict";

  var STORAGE_KEY = "themeMode";
  var THEME_ATTR = "data-theme";
  var VALID = { light: true, dark: true };
  var root = document.documentElement;

  function normalizeTheme(theme) {
    return VALID[theme] ? theme : "light";
  }

  function getStoredTheme() {
    try {
      return normalizeTheme(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return "light";
    }
  }

  function getCurrentTheme() {
    return normalizeTheme(root.getAttribute(THEME_ATTR));
  }

  function uiLang() {
    try {
      if (window.I18n && typeof window.I18n.getLang === "function") {
        return window.I18n.getLang();
      }
    } catch (e) {}
    var l = root.getAttribute("lang") || "";
    return String(l).toLowerCase().indexOf("en") === 0 ? "en" : "zh";
  }

  function tLabel(zh, en) {
    return uiLang() === "en" ? en : zh;
  }

  function updateToggleVisual(button, theme) {
    var normalized = normalizeTheme(theme);
    var icon = button.querySelector("[data-theme-icon]");
    var label = button.querySelector("[data-theme-label]");
    var toDark = normalized !== "dark";
    var isDark = normalized === "dark";

    var hint = toDark
      ? tLabel("切换到夜间模式", "Switch to dark mode")
      : tLabel("切换到亮色模式", "Switch to light mode");
    button.setAttribute("aria-label", hint);
    button.setAttribute("title", hint);

    // Show the theme currently in use (not the one we'd switch to).
    if (icon) {
      icon.className = isDark ? "fas fa-moon" : "fas fa-sun";
    }
    if (label) {
      label.textContent = isDark ? tLabel("夜间", "Dark") : tLabel("亮色", "Light");
    }
  }

  function updateAllToggles(theme) {
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      updateToggleVisual(toggles[i], theme);
    }
  }

  function applyTheme(theme, options) {
    var opts = options || {};
    var persist = opts.persist !== false;
    var broadcast = opts.broadcast !== false;
    var normalized = normalizeTheme(theme);

    root.setAttribute(THEME_ATTR, normalized);
    root.style.colorScheme = normalized;
    updateAllToggles(normalized);

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, normalized);
      } catch (e) {}
    }

    if (broadcast) {
      try {
        window.dispatchEvent(
          new CustomEvent("theme:change", { detail: { theme: normalized } })
        );
      } catch (e) {}
    }

    return normalized;
  }

  function bindToggle(button) {
    if (!button || button.dataset.themeBound === "1") return;
    button.dataset.themeBound = "1";
    button.addEventListener("click", function () {
      ThemeManager.toggleTheme();
    });
    updateToggleVisual(button, getCurrentTheme());
  }

  function createToggleButton(className) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className + " theme-icon-only";
    button.setAttribute("data-theme-toggle", "");
    button.innerHTML = '<i class="fas fa-moon" data-theme-icon></i>';
    return button;
  }

  function ensureAutoToggle() {
    if (document.querySelector("[data-theme-toggle]")) return;

    var navLinks = document.querySelector(".header .nav-links");
    if (navLinks) {
      var inlineBtn = createToggleButton("theme-auto-inline-toggle");
      navLinks.insertBefore(inlineBtn, navLinks.firstChild);
      bindToggle(inlineBtn);
      return;
    }

    var adminActions =
      document.querySelector(".admin-header-system") ||
      document.querySelector(".header-content .actions");
    if (adminActions) {
      var adminBtn = createToggleButton("theme-admin-toggle");
      adminActions.insertBefore(adminBtn, adminActions.firstChild);
      bindToggle(adminBtn);
      return;
    }

    if (document.body && document.body.dataset.disableThemeToggle === "true") {
      return;
    }

    var floatingBtn = createToggleButton("theme-floating-toggle");
    document.body.appendChild(floatingBtn);
    bindToggle(floatingBtn);
  }

  function initDom() {
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      bindToggle(toggles[i]);
    }
    ensureAutoToggle();
    updateAllToggles(getCurrentTheme());
  }

  var ThemeManager = {
    getTheme: getCurrentTheme,
    setTheme: function (theme) {
      return applyTheme(theme, { persist: true, broadcast: true });
    },
    toggleTheme: function () {
      var next = getCurrentTheme() === "dark" ? "light" : "dark";
      return applyTheme(next, { persist: true, broadcast: true });
    },
  };

  window.ThemeManager = ThemeManager;

  // Always default to light if user has no saved preference.
  applyTheme(getStoredTheme(), { persist: false, broadcast: false });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDom, { once: true });
  } else {
    initDom();
  }

  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(getStoredTheme(), { persist: false, broadcast: false });
  });
})();

(function () {
  "use strict";

  var STORAGE_KEY = "kvUiDesignSettings";
  var LEGACY_LOGIN_MODE_KEY = "loginBackgroundMode";
  var LEGACY_LOGIN_URL_KEY = "loginBackgroundUrl";
  var API_ENDPOINT = "/api/ui-config";
  var EFFECT_STYLES = {
    none: true,
    feather: true,
    dandelion: true,
    petal: true,
    snow: true,
    firefly: true,
    texture: true,
  };

  var DEFAULTS = {
    version: 1,
    baseColor: "#fafaf8",
    globalBackgroundUrl: "",
    loginBackgroundMode: "follow-global",
    loginBackgroundUrl: "",
    cardOpacity: 86,
    cardBlur: 14,
    effectStyle: "firefly",
    effectIntensity: 22,
    optimizeMobile: true,
    brandName: "",
    brandLogoUrl: "",
  };

  var root = document.documentElement;
  var settings = null;
  var layers = { image: null, canvas: null, noise: null };
  var render = {
    ctx: null,
    rafId: 0,
    width: 0,
    height: 0,
    lastTs: 0,
    style: "none",
    intensity: 0,
    mobile: false,
    maxFps: 30,
    symbols: [],
    particles: [],
  };

  var pointer = { x: 0, y: 0, dx: 0, dy: 0, active: false };
  var shockwaves = [];
  var TWO_PI = Math.PI * 2;

  if (typeof window !== "undefined") {
    window.addEventListener("pointermove", function (e) {
      if (render.style === "none" || render.style === "texture") return;
      var x = e.clientX;
      var y = e.clientY;
      pointer.dx = x - pointer.x;
      pointer.dy = y - pointer.y;
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
    }, { passive: true });

    window.addEventListener("pointerdown", function (e) {
      if (render.style === "none" || render.style === "texture") return;
      shockwaves.push({
        x: e.clientX,
        y: e.clientY,
        life: 1,
        radius: 18
      });
    }, { passive: true });
  }

  function cloneSettings(input) {
    return Object.assign({}, input || {});
  }

  function clampNumber(value, min, max) {
    var numeric = Number(value);
    if (!isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function normalizeHexColor(value) {
    var text = String(value || "").trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) {
      return DEFAULTS.baseColor;
    }
    if (text.length === 4) {
      return (
        "#" +
        text[1] +
        text[1] +
        text[2] +
        text[2] +
        text[3] +
        text[3]
      ).toLowerCase();
    }
    return text.toLowerCase();
  }

  function sanitizeUrl(url) {
    var text = String(url || "").trim();
    if (!text) return "";
    if (/^(https?:)?\/\//i.test(text)) return text;
    if (/^\//.test(text)) return text;
    return "";
  }

  function normalizeSettings(raw) {
    var next = Object.assign({}, DEFAULTS, raw || {});
    next.baseColor = normalizeHexColor(next.baseColor);
    next.globalBackgroundUrl = sanitizeUrl(next.globalBackgroundUrl);
    next.loginBackgroundMode =
      next.loginBackgroundMode === "custom" ? "custom" : "follow-global";
    next.loginBackgroundUrl = sanitizeUrl(next.loginBackgroundUrl);
    next.cardOpacity = Math.round(clampNumber(next.cardOpacity, 0, 100));
    next.cardBlur = Math.round(clampNumber(next.cardBlur, 0, 32));
    next.effectStyle = EFFECT_STYLES[next.effectStyle]
      ? next.effectStyle
      : DEFAULTS.effectStyle;
    next.effectIntensity = Math.round(clampNumber(next.effectIntensity, 0, 100));
    next.optimizeMobile = next.optimizeMobile !== false;
    next.brandName = String(next.brandName == null ? "" : next.brandName)
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 60);
    next.brandLogoUrl = sanitizeUrl(next.brandLogoUrl);
    return next;
  }

  function saveLocalSettings(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {}
  }

  function readSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeSettings(DEFAULTS);
      return normalizeSettings(JSON.parse(raw));
    } catch (e) {
      return normalizeSettings(DEFAULTS);
    }
  }

  function extractConfigPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    var fromData =
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? payload.data
        : null;

    var candidate =
      payload.config ||
      payload.settings ||
      (fromData && (fromData.config || fromData.settings)) ||
      null;

    if (!candidate && !("success" in payload) && !("error" in payload)) {
      candidate = payload;
    }

    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    return candidate;
  }

  function extractErrorMessage(payload, fallback) {
    if (!payload || typeof payload !== "object") return fallback;
    if (typeof payload.error === "string" && payload.error) return payload.error;
    if (payload.error && typeof payload.error === "object") {
      if (typeof payload.error.message === "string" && payload.error.message) {
        return payload.error.message;
      }
      if (typeof payload.error.detail === "string" && payload.error.detail) {
        return payload.error.detail;
      }
    }
    if (typeof payload.message === "string" && payload.message) return payload.message;
    return fallback;
  }

  function requestUiConfig(method, config) {
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("Fetch API is not available"));
    }

    var url =
      method === "GET"
        ? API_ENDPOINT + (API_ENDPOINT.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now()
        : API_ENDPOINT;

    var init = {
      method: method,
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    };

    if (method !== "GET" && config) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({ config: config });
    }

    return fetch(url, init).then(function (response) {
      return response
        .text()
        .then(function (raw) {
          var payload = {};
          if (raw) {
            try {
              payload = JSON.parse(raw);
            } catch (e) {
              payload = {};
            }
          }

          if (!response.ok) {
            var fallback = "Request failed (" + response.status + ")";
            throw new Error(extractErrorMessage(payload, fallback));
          }

          if (payload && payload.success === false) {
            throw new Error(extractErrorMessage(payload, "Request failed"));
          }

          return payload;
        })
        .catch(function (error) {
          if (error instanceof Error) throw error;
          throw new Error(String(error || "Request failed"));
        });
    });
  }

  function syncFromServer(options) {
    var opts = options || {};
    var silent = opts.silent !== false;
    var applyLocalOnFailure = opts.applyLocalOnFailure === true;

    return requestUiConfig("GET")
      .then(function (payload) {
        var remote = extractConfigPayload(payload);
        if (!remote) {
          return {
            success: false,
            source: "local",
            settings: cloneSettings(settings || readSettings()),
            error: "Server returned invalid ui config payload",
          };
        }

        var normalized = normalizeSettings(remote);
        saveLocalSettings(normalized);
        applySettings(normalized, { persist: false, silent: silent });
        return {
          success: true,
          source: "server",
          binding: payload && payload.binding ? String(payload.binding) : "",
          settings: cloneSettings(normalized),
        };
      })
      .catch(function (error) {
        try {
          console.warn("[ui-config] GET /api/ui-config failed:", error);
        } catch (e) {}
        if (applyLocalOnFailure) {
          var local = readSettings();
          applySettings(local, { persist: false, silent: silent });
        }

        if (opts.throwOnError) {
          throw error;
        }

        return {
          success: false,
          source: "local",
          settings: cloneSettings(settings || readSettings()),
          error: error && error.message ? error.message : String(error),
        };
      });
  }

  function saveToServer(partial, options) {
    var opts = options || {};
    var merged = Object.assign({}, settings || DEFAULTS, partial || {});
    var localApplied = applySettings(merged, {
      persist: true,
      silent: !!opts.silent,
    });

    return requestUiConfig("POST", localApplied)
      .then(function (payload) {
        var remote = extractConfigPayload(payload) || localApplied;
        var normalized = normalizeSettings(remote);
        var binding = payload && payload.binding ? String(payload.binding) : "";
        saveLocalSettings(normalized);
        applySettings(normalized, { persist: false, silent: !!opts.silent });
        return requestUiConfig("GET")
          .then(function (verifyPayload) {
            var verifyRemote = extractConfigPayload(verifyPayload);
            if (!verifyRemote) {
              throw new Error("服务端回读配置格式异常");
            }
            var verified = normalizeSettings(verifyRemote);
            saveLocalSettings(verified);
            applySettings(verified, { persist: false, silent: !!opts.silent });

            var isMatch = JSON.stringify(verified) === JSON.stringify(normalized);
            if (!isMatch) {
              return {
                success: false,
                source: "local",
                binding:
                  binding ||
                  (verifyPayload && verifyPayload.binding
                    ? String(verifyPayload.binding)
                    : ""),
                settings: cloneSettings(verified),
                error: "保存后回读校验未通过，请检查 KV 绑定与 Functions 日志。",
              };
            }

            return {
              success: true,
              source: "server",
              binding:
                binding ||
                (verifyPayload && verifyPayload.binding
                  ? String(verifyPayload.binding)
                  : ""),
              settings: cloneSettings(verified),
            };
          })
          .catch(function (verifyError) {
            return {
              success: false,
              source: "local",
              binding: binding,
              settings: cloneSettings(localApplied),
              error:
                "保存后读取校验失败：" +
                (verifyError && verifyError.message
                  ? verifyError.message
                  : String(verifyError)),
            };
          });
      })
      .catch(function (error) {
        try {
          console.error("[ui-config] POST /api/ui-config failed:", error);
        } catch (e) {}
        if (opts.throwOnError) {
          throw error;
        }
        return {
          success: false,
          source: "local",
          binding: "",
          settings: cloneSettings(localApplied),
          error: error && error.message ? error.message : String(error),
        };
      });
  }

  function migrateLegacySettings() {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return null;
      var legacyMode = String(localStorage.getItem(LEGACY_LOGIN_MODE_KEY) || "")
        .trim()
        .toLowerCase();
      var legacyUrl = sanitizeUrl(localStorage.getItem(LEGACY_LOGIN_URL_KEY));
      if (!legacyMode && !legacyUrl) return null;

      var migrated = normalizeSettings(DEFAULTS);
      if (legacyMode === "image" && legacyUrl) {
        migrated.loginBackgroundMode = "custom";
        migrated.loginBackgroundUrl = legacyUrl;
      }
      saveLocalSettings(migrated);
      return migrated;
    } catch (e) {
      return null;
    }
  }

  function isLoginPage() {
    var pathname = String(window.location.pathname || "").toLowerCase();
    return /(^|\/)login(\.html)?$/.test(pathname);
  }

  function isMobileDevice() {
    var byWidth =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 768px)").matches
        : window.innerWidth <= 768;
    var byTouch = Number(navigator.maxTouchPoints || 0) > 0;
    return byWidth || byTouch;
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function ensureLayer(tagName, className) {
    var node = document.createElement(tagName);
    node.className = className;
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  function ensureLayers() {
    if (!document.body) return false;

    if (!layers.image) layers.image = ensureLayer("div", "ui-bg-image-layer");
    if (!layers.canvas) layers.canvas = ensureLayer("canvas", "ui-bg-canvas-layer");
    if (!layers.noise) layers.noise = ensureLayer("div", "ui-bg-noise-layer");

    if (!document.body.contains(layers.image)) {
      document.body.insertBefore(layers.image, document.body.firstChild);
    }
    if (!document.body.contains(layers.canvas)) {
      document.body.insertBefore(layers.canvas, layers.image.nextSibling);
    }
    if (!document.body.contains(layers.noise)) {
      document.body.insertBefore(layers.noise, layers.canvas.nextSibling);
    }

    if (!render.ctx) {
      render.ctx = layers.canvas.getContext("2d", { alpha: true });
    }

    ensureCanvasSize();
    return true;
  }

  function ensureCanvasSize() {
    if (!layers.canvas || !render.ctx) return;
    var width = Math.max(window.innerWidth || 0, 1);
    var height = Math.max(window.innerHeight || 0, 1);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pixelWidth = Math.max(1, Math.floor(width * dpr));
    var pixelHeight = Math.max(1, Math.floor(height * dpr));

    if (layers.canvas.width !== pixelWidth || layers.canvas.height !== pixelHeight) {
      layers.canvas.width = pixelWidth;
      layers.canvas.height = pixelHeight;
      layers.canvas.style.width = width + "px";
      layers.canvas.style.height = height + "px";
      render.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    render.width = width;
    render.height = height;
  }

  function clearCanvas() {
    if (!render.ctx) return;
    render.ctx.clearRect(0, 0, render.width || 0, render.height || 0);
  }

  function stopRender(shouldClear) {
    if (render.rafId) {
      cancelAnimationFrame(render.rafId);
      render.rafId = 0;
    }
    render.lastTs = 0;
    if (shouldClear) clearCanvas();
  }

  function getEffectNodeCount(intensity, mobile) {
    var count = Math.round(10 + (intensity / 100) * 60);
    if (mobile) count = Math.max(8, Math.round(count * 0.45));
    return count;
  }

  function createParticle(index, style, intensity) {
    var seed = ((index * 9301 + 49297) % 233280) / 233280;
    var depth = 0.55 + ((index * 17) % 45) / 100;
    var speedMultiplier = (style === "dandelion" || style === "firefly") ? 0.35 : 0.85;
    return {
      x: seed * render.width,
      y: (((index * 47) % 100) / 100) * render.height,
      vx: (seed - 0.5) * 0.18,
      vy: (0.18 + intensity / 120) * depth * speedMultiplier,
      size: (5 + intensity * 0.18) * depth,
      phase: seed * TWO_PI,
      spin: index % 2 === 0 ? 1 : -1,
      opacity: (intensity / 100) * depth * 0.8,
      depth: depth,
      seed: seed,
      angle: seed * TWO_PI,
    };
  }

  function buildAmbientParticles(style, intensity, mobile) {
    var count = getEffectNodeCount(intensity, mobile);
    var list = [];
    var i = 0;
    for (i = 0; i < count; i += 1) {
      list.push(createParticle(i, style, intensity));
    }
    render.particles = list;
    shockwaves = [];
  }

  function updateAmbientParticles(deltaSec) {
    var i = 0;
    var wave = null;
    var activeWaves = [];

    // Update shockwaves
    for (i = 0; i < shockwaves.length; i += 1) {
      wave = shockwaves[i];
      wave.life -= deltaSec / 0.7;
      wave.radius += deltaSec * 180;
      if (wave.life > 0) {
        activeWaves.push(wave);
      }
    }
    shockwaves = activeWaves;

    var width = render.width;
    var height = render.height;
    var particle = null;
    var deltaFrames = deltaSec / 0.01667;

    for (i = 0; i < render.particles.length; i += 1) {
      particle = render.particles[i];
      particle.phase += 0.012 * deltaFrames;
      particle.vx += Math.sin(performance.now() / 900 + particle.phase) * 0.006 * particle.depth;
      particle.vy += 0.002 * deltaFrames;

      // Apply pointer wind
      if (pointer.active) {
        var dx = particle.x - pointer.x;
        var dy = particle.y - pointer.y;
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 180) {
          var force = (1 - distance / 180) * (render.intensity / 100);
          particle.vx += (pointer.dx * 0.018 + dx * 0.002) * force;
          particle.vy += (pointer.dy * 0.012 + dy * 0.001) * force;
        }
      }

      // Apply shockwaves
      var w = 0;
      for (w = 0; w < shockwaves.length; w += 1) {
        wave = shockwaves[w];
        var sDx = particle.x - wave.x;
        var sDy = particle.y - wave.y;
        var sDist = Math.sqrt(sDx * sDx + sDy * sDy);
        if (sDist < wave.radius && sDist < 240 && sDist > 0) {
          var sForce = (1 - sDist / wave.radius) * wave.life * (render.intensity / 35);
          particle.vx += (sDx / sDist) * sForce;
          particle.vy += (sDy / sDist) * sForce;
        }
      }

      // Move particle
      particle.x += particle.vx * deltaFrames;
      particle.y += particle.vy * deltaFrames;
      particle.angle += particle.spin * 0.012 * deltaFrames;

      // Friction
      particle.vx *= 0.985;
      particle.vy *= 0.995;

      // Wrap particle
      if (particle.y > height + particle.size * 3) {
        resetParticleTop(particle, width);
      }
      if (particle.x < -particle.size * 4) {
        particle.x = width + particle.size;
      }
      if (particle.x > width + particle.size * 4) {
        particle.x = -particle.size;
      }
    }

    // Decay pointer velocity
    pointer.dx *= 0.85;
    pointer.dy *= 0.85;
  }

  function resetParticleTop(particle, width) {
    particle.x = ((particle.seed * 997 + particle.phase) % 1) * width;
    particle.y = -particle.size * 3;
    particle.vx = (particle.seed - 0.5) * 0.22;
    particle.vy = (0.18 + render.intensity / 120) * particle.depth;
  }

  function drawAmbientParticles() {
    var ctx = render.ctx;
    var i = 0;
    var particle = null;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < render.particles.length; i += 1) {
      particle = render.particles[i];
      drawAmbientParticle(ctx, particle, render.style);
    }
    ctx.restore();
  }

  function drawAmbientParticle(ctx, particle, style) {
    if (style === "feather") drawDreamyFeather(ctx, particle);
    if (style === "dandelion") drawDreamyDandelion(ctx, particle);
    if (style === "petal") drawDreamyPetal(ctx, particle);
    if (style === "snow") drawDreamySnow(ctx, particle);
    if (style === "firefly") drawDreamyFirefly(ctx, particle);
  }

  function drawGlowDot(ctx, x, y, radius, color) {
    var glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.8);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.8, 0, TWO_PI);
    ctx.fill();
  }

  function drawDreamyFeather(ctx, particle) {
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.angle);
    ctx.globalAlpha = particle.opacity;
    var length = particle.size * 2.4;
    var width = particle.size * 0.58;
    var gradient = ctx.createLinearGradient(0, -length, 0, length);
    gradient.addColorStop(0, "rgba(255,255,255,0.18)");
    gradient.addColorStop(0.5, "rgba(255,252,242,0.72)");
    gradient.addColorStop(1, "rgba(190,178,160,0.2)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -length);
    ctx.quadraticCurveTo(width, -length * 0.3, 0, length);
    ctx.quadraticCurveTo(-width * 0.8, -length * 0.15, 0, -length);
    ctx.fill();
    ctx.strokeStyle = "rgba(150,135,112,0.34)";
    ctx.beginPath();
    ctx.moveTo(0, -length * 0.82);
    ctx.quadraticCurveTo(-width * 0.1, 0, 0, length * 0.9);
    ctx.stroke();
    ctx.restore();
  }

  function drawDreamyDandelion(ctx, particle) {
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.angle * 0.35);
    ctx.globalAlpha = particle.opacity;
    ctx.strokeStyle = "rgba(255,255,245,0.72)";
    ctx.lineWidth = 0.8;
    var index = 0;
    for (index = 0; index < 7; index += 1) {
      var angle = (index / 7) * TWO_PI;
      var endX = Math.cos(angle) * particle.size * 0.95;
      var endY = Math.sin(angle) * particle.size * 0.95;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      drawGlowDot(ctx, endX, endY, particle.size * 0.17, "rgba(255,255,255,0.82)");
    }
    drawGlowDot(ctx, 0, 0, particle.size * 0.16, "rgba(225,210,170,0.72)");
    ctx.restore();
  }

  function drawDreamyPetal(ctx, particle) {
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.angle);
    ctx.globalAlpha = particle.opacity;
    var gradient = ctx.createRadialGradient(0, 0, 1, 0, 0, particle.size * 1.6);
    gradient.addColorStop(0, "rgba(255,205,205,0.82)");
    gradient.addColorStop(1, "rgba(220,90,125,0.18)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -particle.size * 1.4);
    ctx.bezierCurveTo(particle.size, -particle.size, particle.size, particle.size, 0, particle.size * 1.5);
    ctx.bezierCurveTo(-particle.size, particle.size, -particle.size, -particle.size, 0, -particle.size * 1.4);
    ctx.fill();
    ctx.restore();
  }

  function drawDreamySnow(ctx, particle) {
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.angle);
    ctx.globalAlpha = particle.opacity;
    ctx.strokeStyle = "rgba(235,248,255,0.8)";
    ctx.lineWidth = 0.9;
    var index = 0;
    for (index = 0; index < 6; index += 1) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, particle.size);
      ctx.stroke();
    }
    drawGlowDot(ctx, 0, 0, particle.size * 0.42, "rgba(255,255,255,0.52)");
    ctx.restore();
  }

  function drawDreamyFirefly(ctx, particle) {
    var pulse = 0.55 + Math.sin(performance.now() / 260 + particle.phase) * 0.35;
    ctx.save();
    ctx.globalAlpha = particle.opacity * pulse;
    drawGlowDot(ctx, particle.x, particle.y, particle.size * 0.9, "rgba(210,255,120,0.42)");
    drawGlowDot(ctx, particle.x, particle.y, particle.size * 0.28, "rgba(255,255,190,0.92)");
    ctx.restore();
  }

  function startRender(style, intensity, mobile) {
    stopRender(true);

    if (style === "math") style = "dandelion";
    if (style === "particle") style = "firefly";

    render.style = style;
    render.intensity = intensity;
    render.mobile = mobile;
    render.maxFps = mobile ? 14 : 30;

    if (!render.ctx || style === "none" || style === "texture" || prefersReducedMotion()) {
      return;
    }

    buildAmbientParticles(style, intensity, mobile);

    render.rafId = requestAnimationFrame(function frame(ts) {
      render.rafId = requestAnimationFrame(frame);
      if (document.hidden) return;

      var minDelta = 1000 / render.maxFps;
      if (render.lastTs && ts - render.lastTs < minDelta) return;
      var deltaSec = render.lastTs ? (ts - render.lastTs) / 1000 : minDelta / 1000;
      render.lastTs = ts;
      if (deltaSec > 0.08) deltaSec = 0.08;

      clearCanvas();

      updateAmbientParticles(deltaSec);
      drawAmbientParticles();
    });
  }

  function applyCompatibilityVars(next, darkMode) {
    var opacity = clampNumber(next.cardOpacity, 0, 100) / 100;
    var blur = Math.round(clampNumber(next.cardBlur, 0, 32));
    var transparentCards = opacity <= 0.001;
    var useBackdropFilter = blur > 0 && !transparentCards;
    var surfaceAlpha = transparentCards
      ? 0
      : darkMode
        ? Math.max(0.5, Math.min(0.94, opacity))
        : Math.max(0.28, Math.min(0.98, opacity));
    var surface1Alpha = transparentCards
      ? 0
      : darkMode
        ? Math.min(0.98, surfaceAlpha + 0.08)
        : Math.min(0.99, surfaceAlpha + 0.07);
    var surface2Alpha = transparentCards
      ? 0
      : darkMode
        ? Math.max(0.44, surfaceAlpha - 0.05)
        : Math.max(0.44, surfaceAlpha - 0.08);
    var surface3Alpha = transparentCards
      ? 0
      : darkMode
        ? Math.max(0.36, surfaceAlpha - 0.1)
        : Math.max(0.34, surfaceAlpha - 0.17);
    var inputBorder = darkMode
      ? "rgba(56, 52, 46, 0.72)"
      : "rgba(229, 221, 207, 0.9)";
    var border = darkMode
      ? "rgba(56, 52, 46, 0.6)"
      : "rgba(229, 221, 207, 0.7)";
    var cardBg = darkMode
      ? "rgba(38, 35, 32, " + surfaceAlpha.toFixed(2) + ")"
      : "rgba(255, 255, 255, " + surfaceAlpha.toFixed(2) + ")";
    var surface1 = darkMode
      ? "rgba(32, 30, 27, " + surface1Alpha.toFixed(2) + ")"
      : "rgba(255, 255, 255, " + surface1Alpha.toFixed(2) + ")";
    var surface2 = darkMode
      ? "rgba(32, 30, 27, " + surface2Alpha.toFixed(2) + ")"
      : "rgba(255, 255, 255, " + surface2Alpha.toFixed(2) + ")";
    var surface3 = darkMode
      ? "rgba(38, 35, 32, " + surface3Alpha.toFixed(2) + ")"
      : "rgba(241, 236, 227, " + surface3Alpha.toFixed(2) + ")";
    var shadow = transparentCards
      ? "none"
      : darkMode
        ? "0 12px 32px rgba(0, 0, 0, 0.34)"
        : "0 10px 30px rgba(38, 34, 28, 0.09)";
    var shadowHover = transparentCards
      ? "none"
      : darkMode
        ? "0 18px 38px rgba(0, 0, 0, 0.42)"
        : "0 16px 34px rgba(38, 34, 28, 0.14)";
    var wfShadow = transparentCards
      ? "none"
      : darkMode
        ? "0 14px 34px rgba(0, 0, 0, 0.38)"
        : "0 10px 28px rgba(38, 34, 28, 0.12)";
    var wfShadowSoft = transparentCards
      ? "none"
      : darkMode
        ? "0 10px 24px rgba(0, 0, 0, 0.3)"
        : "0 6px 18px rgba(38, 34, 28, 0.1)";
    var uiShadowSoft = transparentCards
      ? "none"
      : "0 10px 30px rgba(38, 34, 28, 0.09)";
    var uiShadowSoftDark = transparentCards
      ? "none"
      : "0 14px 32px rgba(0, 0, 0, 0.34)";

    if (transparentCards) {
      root.setAttribute("data-ui-transparent-cards", "true");
    } else {
      root.removeAttribute("data-ui-transparent-cards");
    }

    root.style.setProperty("--ui-page-bg", transparentCards ? "transparent" : next.baseColor);
    root.style.setProperty("--ui-page-bg-dark", transparentCards ? "transparent" : "#1c1b19");
    root.style.setProperty("--ui-card-opacity", surfaceAlpha.toFixed(2));
    root.style.setProperty("--ui-card-blur", blur + "px");
    root.style.setProperty(
      "--ui-card-backdrop-filter",
      useBackdropFilter ? "blur(" + blur + "px) saturate(115%)" : "none"
    );
    root.style.setProperty("--ui-noise-opacity", "0");
    root.style.setProperty("--ui-shadow-soft", uiShadowSoft);
    root.style.setProperty("--ui-shadow-soft-dark", uiShadowSoftDark);
    root.style.setProperty("--bg-gradient", "none");
    root.style.setProperty("--bg", darkMode ? "var(--ui-page-bg-dark)" : "var(--ui-page-bg)");
    root.style.setProperty("--card-bg", cardBg);
    root.style.setProperty("--claude-panel", cardBg);
    root.style.setProperty("--claude-panel-soft", surface2);
    root.style.setProperty("--surface-1", surface1);
    root.style.setProperty("--surface-2", surface2);
    root.style.setProperty("--surface-3", surface3);
    root.style.setProperty("--surface-border", border);
    root.style.setProperty("--input-border", inputBorder);
    root.style.setProperty("--shadow", shadow);
    root.style.setProperty("--shadow-hover", shadowHover);

    root.style.setProperty("--wf-surface", cardBg);
    root.style.setProperty("--wf-border", border);
    root.style.setProperty("--wf-shadow", wfShadow);
    root.style.setProperty("--wf-shadow-soft", wfShadowSoft);
  }

  function resolveBackgroundUrl(next) {
    var globalUrl = sanitizeUrl(next.globalBackgroundUrl);
    if (isLoginPage() && next.loginBackgroundMode === "custom") {
      return sanitizeUrl(next.loginBackgroundUrl) || globalUrl;
    }
    return globalUrl;
  }

  function applyBackgroundLayers(next) {
    if (!ensureLayers()) return;
    var url = resolveBackgroundUrl(next);
    if (url) {
      layers.image.style.display = "block";
      layers.image.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
    } else {
      layers.image.style.display = "none";
      layers.image.style.backgroundImage = "none";
    }
  }

  function applyEffect(next) {
    if (!ensureLayers()) return;

    var style = next.effectStyle;
    var intensity = clampNumber(next.effectIntensity, 0, 100);
    var mobile = isMobileDevice();
    var optimizedMobile = next.optimizeMobile && mobile;

    if (style === "texture") {
      var noiseBase = 0.06 + intensity / 100 * 0.16;
      root.style.setProperty("--ui-noise-opacity", noiseBase.toFixed(3));
    } else {
      root.style.setProperty("--ui-noise-opacity", "0");
    }

    if (optimizedMobile && (style === "math" || style === "particle")) {
      intensity = Math.max(6, Math.round(intensity * 0.45));
      root.setAttribute("data-ui-mobile-optimized", "true");
    } else {
      root.removeAttribute("data-ui-mobile-optimized");
    }

    startRender(style, intensity, optimizedMobile);
  }

  function hideLegacyLoginLayers() {
    if (!document.body) return;
    document.body.classList.remove("has-bg-image");
    var legacyImageLayer = document.getElementById("bgImageLayer");
    var legacyOverlay = document.getElementById("bgOverlay");
    if (legacyImageLayer) legacyImageLayer.style.display = "none";
    if (legacyOverlay) legacyOverlay.style.display = "none";
  }

  function dispatchDesignChange(next, persisted) {
    try {
      window.dispatchEvent(
        new CustomEvent("ui:design-change", {
          detail: { settings: cloneSettings(next), persisted: !!persisted },
        })
      );
    } catch (e) {}
  }

  // Brand name applies only where a .brand-name element exists (home page);
  // the brand logo replaces every header logo image and links back home.
  function applyBrand(next) {
    var name = (next.brandName && next.brandName.trim()) || "Seraph's Pictures";
    var logoUrl = sanitizeUrl(next.brandLogoUrl);
    try {
      document.title = name;
    } catch (e) {}
    var nameEls = document.querySelectorAll(".brand-name");
    for (var i = 0; i < nameEls.length; i++) {
      nameEls[i].textContent = name;
    }
    var logoEls = document.querySelectorAll(".brand-logo, .header-logo");
    for (var j = 0; j < logoEls.length; j++) {
      var img = logoEls[j];
      if (logoUrl) img.setAttribute("src", logoUrl);
      img.style.cursor = "pointer";
      if (!img.getAttribute("data-brand-home")) {
        img.setAttribute("data-brand-home", "1");
        img.addEventListener("click", function () {
          window.location.href = "/";
        });
      }
    }
  }

  function applySettings(next, options) {
    var opts = options || {};
    var normalized = normalizeSettings(next || settings || DEFAULTS);
    var darkMode = root.getAttribute("data-theme") === "dark";
    settings = normalized;
    applyCompatibilityVars(settings, darkMode);
    applyBrand(settings);

    if (document.body) {
      if (isLoginPage()) document.body.classList.add("login-page");
      hideLegacyLoginLayers();
      applyBackgroundLayers(settings);
      applyEffect(settings);
    }

    if (opts.persist) {
      saveLocalSettings(settings);
    }
    if (!opts.silent) {
      dispatchDesignChange(settings, opts.persist);
    }
    return cloneSettings(settings);
  }

  function setSettings(partial, options) {
    var opts = options || {};
    var merged = Object.assign({}, settings || DEFAULTS, partial || {});
    return applySettings(merged, {
      persist: opts.persist !== false,
      silent: !!opts.silent,
    });
  }

  function previewSettings(partial) {
    var merged = Object.assign({}, settings || DEFAULTS, partial || {});
    return applySettings(merged, { persist: false, silent: true });
  }

  function resetSettings() {
    var fresh = normalizeSettings(DEFAULTS);
    saveLocalSettings(fresh);
    return applySettings(fresh, { persist: false, silent: false });
  }

  function restorePersisted() {
    var persisted = readSettings();
    return applySettings(persisted, { persist: false, silent: true });
  }

  function clearBackgrounds(options) {
    return setSettings(
      {
        globalBackgroundUrl: "",
        loginBackgroundMode: "follow-global",
        loginBackgroundUrl: "",
      },
      options
    );
  }

  function bindGlobalListeners() {
    window.addEventListener("theme:change", function () {
      applySettings(settings, { persist: false, silent: true });
    });

    window.addEventListener("storage", function (event) {
      if (event.key !== STORAGE_KEY) return;
      settings = readSettings();
      applySettings(settings, { persist: false, silent: true });
    });

    window.addEventListener("resize", function () {
      if (!ensureLayers()) return;
      ensureCanvasSize();
      if (render.style === "math" || render.style === "particle") {
        startRender(render.style, render.intensity, render.mobile);
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopRender(false);
      } else {
        applyEffect(settings);
      }
    });

    if (typeof window.matchMedia === "function") {
      var media = window.matchMedia("(max-width: 768px)");
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", function () {
          applyEffect(settings);
        });
      } else if (typeof media.addListener === "function") {
        media.addListener(function () {
          applyEffect(settings);
        });
      }
    }
  }

  function init() {
    if (!document.body) return;
    if (isLoginPage()) document.body.classList.add("login-page");
    ensureLayers();
    applySettings(settings, { persist: false, silent: true });
    if (window.I18n && typeof window.I18n.onChange === "function") {
      window.I18n.onChange(function () {
        updateAllToggles(getCurrentTheme());
      });
    }
  }

  var manager = {
    getSettings: function () {
      return cloneSettings(settings);
    },
    getDefaults: function () {
      return cloneSettings(DEFAULTS);
    },
    setSettings: setSettings,
    syncFromServer: syncFromServer,
    saveToServer: saveToServer,
    previewSettings: previewSettings,
    restorePersisted: restorePersisted,
    resetSettings: resetSettings,
    clearBackgrounds: clearBackgrounds,
    applySettings: function (next, options) {
      return applySettings(next, options || {});
    },
  };

  window.UIDesignManager = manager;

  settings = migrateLegacySettings() || readSettings();
  applySettings(settings, { persist: false, silent: true });
  bindGlobalListeners();
  syncFromServer({ silent: true, applyLocalOnFailure: false });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

// Auto-highlight active navigation link
(function() {
  "use strict";
  
  function highlightActiveNav() {
    var currentPath = window.location.pathname;
    var navLinks = document.querySelectorAll('.nav-links a, .action-link, .nav-btn');
    
    navLinks.forEach(function(link) {
      var href = link.getAttribute('href');
      if (!href) return;
      
      // Normalize paths
      var linkPath = href.startsWith('/') ? href : '/' + href;
      linkPath = linkPath.replace(/^\.\//, '/');
      
      // Check if current page matches
      var isActive = currentPath === linkPath || 
                     (linkPath !== '/' && currentPath.startsWith(linkPath));
      
      if (isActive) {
        link.classList.add('is-active', 'active');
      } else {
        link.classList.remove('is-active', 'active');
      }
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', highlightActiveNav);
  } else {
    highlightActiveNav();
  }
})();
