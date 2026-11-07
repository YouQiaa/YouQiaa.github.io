/* Wait For UR · 等一个家 —— 页面逻辑
   仅使用真实接口数据；无内容时如实显示为空，不做假数据兜底。 */

(function () {
  "use strict";

  const STORE = {
    fav: "wfu-favs",
    paw: "wfu-paw"
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    pets: [],
    userPets: [],
    adopted: [],
    area: "user",
    tag: "all",
    view: "list",
    favs: new Set(readJSON(STORE.fav, [])),
    me: null,
    stats: null
  };

  const LOG = (...args) => {
    if (window.__WFU_DEBUG) console.log("[wfu]", ...args);
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api/${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) {
      const message = data?.error || `请求失败（${res.status}）`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"'`]/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
      "`": "&#96;"
    })[ch]);
  }

  function formatDays(days) {
    if (!days || days <= 0) return "今天刚到";
    if (days < 30) return `${days} 天`;
    if (days < 365) return `${Math.floor(days / 30)} 个月`;
    return `${(days / 365).toFixed(1)} 年`;
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60e3);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return `${Math.floor(days / 30)} 个月前`;
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const theme = {
    render() {
      const pressed = document.documentElement.dataset.theme === "dark";
      $$("[data-theme-toggle]").forEach((btn) => {
        btn.setAttribute("aria-pressed", String(pressed));
        btn.setAttribute("aria-label", pressed ? "切换到日间模式" : "切换到夜间模式");
      });
    },
    init() {
      theme.render();
      $$("[data-theme-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
          document.documentElement.dataset.theme = next;
          try {
            localStorage.setItem("wfu-theme", next);
          } catch {}
          theme.render();
        });
      });
    }
  };
