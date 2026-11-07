/* Wait For UR · 等一个家 —— 前端（全栈版） */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------------- 静态展示模式 ------------- */
  // GitHub Pages 这类纯静态托管跑不了 api/，启动时探测 /api/auth/me：
  // 拿不到 JSON 响应就进入展示模式，把依赖后端的功能置灰，
  // 顶部显示说明和「打开完整版」，避免访问者以为站点坏了。
  let staticMode = false;

  async function detectApi() {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!res.ok) return false;
      return (res.headers.get("content-type") || "").includes("application/json");
    } catch {
      return false;
    }
  }

  function requireLive(action) {
    if (!staticMode) return true;
    toast(`静态展示版不支持${action}，请点顶部「打开完整版」`);
    const bar = $("#staticBar");
    if (bar) {
      bar.classList.remove("is-pulse");
      void bar.offsetWidth;
      bar.classList.add("is-pulse");
    }
    return false;
  }

  function enterStaticMode() {
    staticMode = true;
    document.body.classList.add("is-static");

    const bar = $("#staticBar");
    if (bar) {
      bar.hidden = false;
      const link = $("#liveSiteLink");
      if (link && bar.dataset.liveUrl) link.href = bar.dataset.liveUrl;
    }

    ["#authBtn", "#mobileMineBtn", "#userMenuBtn", "#logoutBtn", "#matchBtn"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.classList.add("is-disabled");
      el.setAttribute("aria-disabled", "true");
    });
    if ($("#authBtn")) $("#authBtn").title = "静态展示版：登录请到完整版站点";

    const empty = $("#emptyState");
    if (empty) {
      empty.hidden = false;
      empty.textContent = "这是静态展示版，宠物和互动数据都在完整版里。点顶部「打开完整版」去看正在等的那几只。";
    }
    const count = $("#resultCount");
    if (count) count.textContent = "静态展示 · 暂无实时数据";
    const wallEmpty = $("#wallEmpty");
    if (wallEmpty) wallEmpty.hidden = false;
  }

  /* ---------------- toast ---------------- */
  const toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.setAttribute("role", "status");
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  }

  /* ---------------- api ---------------- */
  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin"
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok) throw new Error((data && data.error) || "网络出了点小状况");
    return data;
  }

  /* ---------------- state ---------------- */
  let me = null;
  let favIds = new Set();
  let area = "user"; // user | adopted
  let activeTag = "all";
  let view = "list"; // list | map
  let currentPets = [];
  let editingPet = null;

  const PATS_KEY = "wfu-pats";
  let patMap = {};
  try {
    patMap = JSON.parse(sessionStorage.getItem(PATS_KEY)) || {};
  } catch {
    patMap = {};
  }

  /* ---------------- theme ---------------- */
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("wfu-theme", t);
    } catch {}
    $$("[data-theme-toggle]").forEach((btn) => {
      const dark = t === "dark";
      btn.setAttribute("aria-pressed", String(dark));
      btn.setAttribute("aria-label", dark ? "切换到日间模式" : "切换到夜间模式");
    });
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = t === "dark" ? "#14131A" : "#F6F3EA";
  }
  $$("[data-theme-toggle]").forEach((btn) =>
    btn.addEventListener("click", () => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    })
  );

  /* ---------------- paw cursor ---------------- */
  const pawToggle = $("#pawToggle");
  function applyPaw(on) {
    document.documentElement.classList.toggle("paw-cursor", on);
    if (pawToggle) pawToggle.checked = on;
    try {
      localStorage.setItem("wfu-paw", on ? "1" : "0");
    } catch {}
  }
  if (pawToggle) {
    let saved = null;
    try {
      saved = localStorage.getItem("wfu-paw");
    } catch {}
    applyPaw(saved === "1");
    pawToggle.addEventListener("change", () => applyPaw(pawToggle.checked));
  }

  /* ---------------- auth UI ---------------- */
  const authDialog = $("#authDialog");
  const loginForm = $("#loginForm");
  const regForm = $("#regForm");

  function openAuth(tab = "login") {
    if (!requireLive("登录 / 注册")) return;
    if (!authDialog) return;
    switchAuthTab(tab);
    if (!authDialog.open) authDialog.showModal();
  }

  function switchAuthTab(tab) {
    const isLogin = tab === "login";
    $("#authTabLogin").setAttribute("aria-selected", String(isLogin));
    $("#authTabReg").setAttribute("aria-selected", String(!isLogin));
    loginForm.hidden = !isLogin;
    regForm.hidden = isLogin;
  }

  if (authDialog) {
    $("#authTabLogin").addEventListener("click", () => switchAuthTab("login"));
    $("#authTabReg").addEventListener("click", () => switchAuthTab("reg"));

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $("#loginErr");
      errEl.textContent = "";
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: {
            email: loginForm.email.value,
            password: loginForm.password.value
          }
        });
        me = data.user;
        authDialog.close();
        loginForm.reset();
        await afterAuthChange();
        toast(`欢迎回来，${me.nickname}`);
      } catch (err2) {
        errEl.textContent = err2.message;
      }
    });

    /* 发送邮箱验证码：60 秒倒计时；未配置邮件服务时服务端回传 devCode 自动填入（测试模式） */
    const sendCodeBtn = $("#sendCodeBtn");
    let codeCountdown = 0;
    let codeTimer = null;
    function tickCodeBtn() {
      if (codeCountdown <= 0) {
        clearInterval(codeTimer);
        codeTimer = null;
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = "发送验证码";
        return;
      }
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = `${codeCountdown}s 后重发`;
      codeCountdown -= 1;
    }
    sendCodeBtn.addEventListener("click", async () => {
      const errEl = $("#regErr");
      errEl.textContent = "";
      const email = regForm.email.value.trim();
      if (!email) {
        errEl.textContent = "先填邮箱，再收验证码";
        return;
      }
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = "发送中…";
      try {
        const data = await api("/api/auth/send-code", { method: "POST", body: { email } });
        if (data.devCode) {
          regForm.code.value = data.devCode;
          toast("测试模式：验证码已自动填入");
        } else {
          toast("验证码已发送，去邮箱查收（记得看垃圾箱）");
        }
        codeCountdown = 60;
        if (!codeTimer) codeTimer = setInterval(tickCodeBtn, 1000);
        tickCodeBtn();
      } catch (err2) {
        errEl.textContent = err2.message;
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = "发送验证码";
      }
    });

    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $("#regErr");
      errEl.textContent = "";
      if (regForm.password.value.length < 8) {
        errEl.textContent = "密码至少 8 位";
        return;
      }
      if (!/^\d{6}$/.test(regForm.code.value.trim())) {
        errEl.textContent = "填一下邮箱收到的 6 位验证码";
        return;
      }
      try {
        const data = await api("/api/auth/register", {
          method: "POST",
          body: {
            nickname: regForm.nickname.value,
            email: regForm.email.value,
            password: regForm.password.value,
            code: regForm.code.value.trim()
          }
        });
        me = data.user;
        authDialog.close();
        regForm.reset();
        await afterAuthChange();
        toast(`注册成功，${me.nickname}。发布前请确保信息真实。`);
      } catch (err2) {
        errEl.textContent = err2.message;
      }
    });
  }

  const userMenu = $("#userMenu");
  const userMenuPop = $("#userMenuPop");

  function renderAuthUI() {
    const mineBtn = $("#mobileMineBtn");
    if (me) {
      $$("[data-auth-entry]").forEach((b) => (b.hidden = true));
      userMenu.hidden = false;
      if (mineBtn) mineBtn.hidden = false;
      $("#userNick").textContent = me.nickname;
      $("#adminEntry").hidden = !me.admin;
    } else {
      $$("[data-auth-entry]").forEach((b) => (b.hidden = false));
      userMenu.hidden = true;
      userMenuPop.hidden = true;
      if (mineBtn) mineBtn.hidden = true;
    }
    renderWallAuthState();
  }

  async function refreshMe() {
    try {
      const data = await api("/api/auth/me");
      me = data.user;
    } catch {
      me = null;
    }
    renderAuthUI();
  }

  async function refreshFavs() {
    if (!me) {
      favIds = new Set();
      return;
    }
    try {
      const data = await api("/api/my/favorites");
      favIds = new Set(data.ids);
    } catch {
      favIds = new Set();
    }
  }

  async function afterAuthChange() {
    renderAuthUI();
    await refreshFavs();
    closeOverlays();
    await loadPets();
  }

  $$("[data-auth-entry]").forEach((b) => b.addEventListener("click", () => openAuth("login")));

  if ($("#mobileMineBtn")) $("#mobileMineBtn").addEventListener("click", () => openAccount("favorites"));

  if ($("#userMenuBtn")) {
    $("#userMenuBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      const open = userMenuPop.hidden;
      userMenuPop.hidden = !open;
      $("#userMenuBtn").setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!userMenu.contains(e.target)) userMenuPop.hidden = true;
    });
  }

  if ($("#logoutBtn")) {
    $("#logoutBtn").addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch {}
      me = null;
      await afterAuthChange();
      toast("已退出登录");
    });
  }

  $$("#userMenuPop [data-nav]").forEach((btn) =>
    btn.addEventListener("click", () => {
      userMenuPop.hidden = true;
      const target = btn.dataset.nav;
      if (target === "publish") openPublish();
      else openAccount(target);
    })
  );

  /* ---------------- overlays (publish / account) ---------------- */
  const publishSec = $("#publish");
  const accountSec = $("#account");

  function closeOverlays() {
    if (publishSec) publishSec.hidden = true;
    if (accountSec) accountSec.hidden = true;
  }

  function showOverlay(sec) {
    closeOverlays();
    sec.hidden = false;
    sec.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
  }

  $$("[data-close-overlay]").forEach((btn) =>
    btn.addEventListener("click", () => {
      closeOverlays();
      $("#pets").scrollIntoView({ behavior: "smooth" });
    })
  );

  /* ---------------- pets list ---------------- */
  const petsGrid = $("#petsGrid");
  const emptyState = $("#emptyState");
  const resultCount = $("#resultCount");

  function matchTag(pet) {
    return activeTag === "all" || (pet.tags || []).includes(activeTag);
  }

  function statusBadge(pet) {
    if (pet.status === "adopted") return `<span class="status status--home">已回家 · 第 ${pet.days} 天</span>`;
    if (pet.stage === "meeting") return `<span class="status status--meeting">见面中 · 第 ${pet.days} 天</span>`;
    return `<span class="status status--waiting">等待中 · 第 ${pet.days} 天</span>`;
  }

  function detailHTML(pet) {
    const rows = [
      ["年龄", pet.age],
      ["性别", pet.sex],
      ["绝育", pet.neuter || "未知"],
      ["疫苗", pet.vaccine || "未知"],
      ["来源", pet.source === "official" ? pet.ownerName : "家长自荐"]
    ];
    if (pet.contact) rows.push(["联系方式", pet.contact]);
    else rows.push(["联系方式", "登录后可见"]);
    return rows
      .map(([k, v]) => `<div class="detail-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join("");
  }

  function cardHTML(pet) {
    const heartOn = favIds.has(pet.id);
    return `
    <article class="pet-card" data-id="${esc(pet.id)}">
      <button class="pet-card__fav${heartOn ? " is-on" : ""}" type="button" data-fav="${esc(pet.id)}"
        aria-pressed="${heartOn}" aria-label="收藏 ${esc(pet.name)}">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20.7C6.4 16.9 3 13.6 3 10.2 3 7.6 5 5.5 7.6 5.5c1.7 0 3.3 1 4.4 2.6 1.1-1.6 2.7-2.6 4.4-2.6 2.6 0 4.6 2.1 4.6 4.7 0 3.4-3.4 6.7-9 10.5Z"/></svg>
      </button>
      <figure class="pet-card__media">
        <img src="${esc(pet.photo || "assets/favicon.svg")}" alt="${esc(pet.alt)}" loading="lazy" decoding="async">
        ${pet.flag ? `<span class="sticker sticker--coral pet-card__flag">${esc(pet.flag)}</span>` : ""}
        ${pet.source === "user" ? `<span class="sticker sticker--purple pet-card__src">家长自荐</span>` : ""}
      </figure>
      <div class="pet-card__body">
        <h3 class="pet-card__name">${esc(pet.name)} <span>${esc(pet.species)} · ${esc(pet.age)}</span></h3>
        <p class="pet-card__quote">“${esc(pet.quote)}”</p>
        <div class="pet-card__meta">
          <span class="pill">${esc(pet.city)}</span>
          ${(pet.tags || []).map((t) => `<span class="tag tag--lime">${esc(t)}</span>`).join("")}
        </div>
        <div class="pet-card__foot">
          ${statusBadge(pet)}
          <div class="pet-card__actions">
            ${pet.status === "approved" ? `<button class="pet-card__apply" type="button" data-apply="${esc(pet.id)}">申请领养</button>` : ""}
            <button class="pet-card__cmt" type="button" data-comment="${esc(pet.id)}" aria-label="给 ${esc(pet.name)} 留言">
              留言 <span class="cmt-count">${pet.commentCount || 0}</span>
            </button>
            <button class="pet-card__pat" type="button" data-pat="${esc(pet.id)}">摸摸它 <span class="pat-count">${patMap[pet.id] || 0}</span></button>
          </div>
        </div>
        <details class="pet-card__details">
          <summary>展开看详情</summary>
          <dl class="detail-list">${detailHTML(pet)}</dl>
        </details>
      </div>
    </article>`;
  }

  function renderCards() {
    const list = currentPets.filter(matchTag);
    petsGrid.innerHTML = list.map(cardHTML).join("");
    emptyState.hidden = list.length > 0;
    const waitingN = list.filter((p) => p.status !== "adopted").length;
    if (area === "adopted") {
      resultCount.textContent = list.length
        ? `${list.length} 位伙伴已经到家了。`
        : "还没有回家的记录。";
    } else {
      resultCount.textContent = list.length
        ? `${list.length} 位伙伴 · ${waitingN} 位还在等`
        : area === "user"
          ? "还没有人发布，成为第一个？"
          : "暂时没有匹配的伙伴。";
    }
    bindCardEvents();
  }

  function bindCommentButtons(root, pets) {
    $$("[data-comment]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        const pet = (pets || currentPets).find((p) => p.id === btn.dataset.comment);
        if (pet) openComments(pet);
      })
    );
  }

  function bindApplyButtons(root, pets) {
    $$("[data-apply]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        const pet = (pets || currentPets).find((p) => p.id === btn.dataset.apply);
        if (pet) openApply(pet);
      })
    );
  }

  function bindCardEvents() {
    bindCommentButtons(petsGrid, currentPets);
    bindApplyButtons(petsGrid, currentPets);
    $$("[data-fav]", petsGrid).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!me) {
          openAuth("login");
          toast("先登录，再收藏");
          return;
        }
        const id = btn.dataset.fav;
        const on = !favIds.has(id);
        btn.disabled = true;
        try {
          await api(`/api/favorites/${id}`, { method: on ? "POST" : "DELETE" });
          if (on) favIds.add(id);
          else favIds.delete(id);
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", String(on));
          toast(on ? "已收藏，去「我的收藏」看看" : "已取消收藏");
        } catch (e) {
          toast(e.message);
        } finally {
          btn.disabled = false;
        }
      })
    );

    $$("[data-pat]", petsGrid).forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.pat;
        patMap[id] = (patMap[id] || 0) + 1;
        try {
          sessionStorage.setItem(PATS_KEY, JSON.stringify(patMap));
        } catch {}
        $(".pat-count", btn).textContent = patMap[id];
        patBubble(btn);
        spawnParticles(btn);
      })
    );
  }

  const PAT_WORDS = ["喵~", "呼噜噜", "蹭蹭你", "咕噜咕噜", "喵呜！", "再摸一下"];

  function patBubble(anchor) {
    const host = anchor.parentElement || anchor;
    $$(".pat-bubble", host).forEach((b) => b.remove());
    const b = document.createElement("span");
    b.className = "pat-bubble";
    b.textContent = PAT_WORDS[Math.floor(Math.random() * PAT_WORDS.length)];
    host.appendChild(b);
    setTimeout(() => b.remove(), 1600);
  }

  function spawnParticles(anchor) {
    if (reduced.matches) return;
    const rect = anchor.getBoundingClientRect();
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("span");
      s.className = "pat-particle";
      s.style.left = `${rect.left + rect.width / 2 + (Math.random() * 40 - 20)}px`;
      s.style.top = `${rect.top + window.scrollY - 6}px`;
      s.style.setProperty("--px", `${(Math.random() * 2 - 1) * 46}px`);
      s.style.animationDelay = `${i * 40}ms`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 950);
    }
  }

  async function loadPets() {
    if (staticMode) return;
    petsGrid.innerHTML = `<p class="loading-line">正在加载…</p>`;
    try {
      const data = await api(`/api/pets?area=${area}`);
      currentPets = data.pets;
    } catch (e) {
      currentPets = [];
      toast(e.message);
    }
    renderCards();
    if (area === "official") renderMap();
    updateVisibility();
  }

  /* ---------------- map (official only) ---------------- */
  const mapView = $("#mapView");
  const mapDots = $("#mapDots");
  const mapInfo = $("#mapInfo");

  function renderMap() {
    if (!mapDots) return;
    mapDots.innerHTML = "";
    const list = currentPets.filter(matchTag).filter((p) => p.coords);
    const NS = "http://www.w3.org/2000/svg";
    for (const pet of list) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", `map-dot map-dot--${pet.stage || "waiting"}`);
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", `${pet.city}的${pet.name}，已等待${pet.days}天`);
      g.dataset.id = pet.id;
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", pet.coords[0]);
      c.setAttribute("cy", pet.coords[1]);
      c.setAttribute("r", "13");
      const c2 = document.createElementNS(NS, "circle");
      c2.setAttribute("cx", pet.coords[0]);
      c2.setAttribute("cy", pet.coords[1]);
      c2.setAttribute("r", "6");
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", pet.coords[0] + (pet.label?.dx || 0));
      t.setAttribute("y", pet.coords[1] + (pet.label?.dy || 34));
      t.setAttribute("text-anchor", pet.label?.anchor || "middle");
      t.textContent = pet.city;
      g.append(c, c2, t);
      mapDots.appendChild(g);
      g.addEventListener("click", () => showMapPet(pet.id));
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          showMapPet(pet.id);
        }
      });
    }
  }

  function showMapPet(id) {
    const pet = currentPets.find((p) => p.id === id);
    if (!pet) return;
    $$(".map-dot", mapDots).forEach((d) => d.classList.toggle("is-active", d.dataset.id === id));
    mapInfo.innerHTML = `
      <figure class="map-info__photo"><img src="${esc(pet.photo)}" alt="${esc(pet.alt)}"></figure>
      <div class="map-info__body">
        <h4>${esc(pet.name)} <span>${esc(pet.city)} · 已等 ${pet.days} 天</span></h4>
        <p>“${esc(pet.quote)}”</p>
        <div class="map-info__tags">${(pet.tags || []).map((t) => `<span class="tag tag--lime">${esc(t)}</span>`).join("")}</div>
        <div class="map-info__actions">
          <button class="btn btn--small btn--ink" type="button" data-goto-card="${esc(pet.id)}">到它的卡片</button>
          <button class="map-info__reset" type="button" data-reset-map>换一个</button>
        </div>
      </div>`;
    $("[data-goto-card]", mapInfo).addEventListener("click", () => {
      setView("list");
      const card = $(`.pet-card[data-id="${CSS.escape(id)}"]`);
      if (card) {
        card.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
        card.classList.add("is-flash");
        setTimeout(() => card.classList.remove("is-flash"), 1600);
      }
    });
    $("[data-reset-map]", mapInfo).addEventListener("click", resetMapInfo);
  }

  function resetMapInfo() {
    $$(".map-dot", mapDots).forEach((d) => d.classList.remove("is-active"));
    mapInfo.innerHTML = `
      <span class="hand map-info__hint">每颗点，都是一只在等。</span>
      <p class="map-info__default">点左边的圆点，就能看到它在哪座城市、等了多久。</p>`;
  }

  /* ---------------- tabs / chips / view ---------------- */
  function setArea(next) {
    if (area === next) return;
    area = next;
    $$(".src-tab").forEach((t) => {
      const on = t.dataset.area === area;
      t.setAttribute("aria-selected", String(on));
    });
    const tools = $(".pet-tools");
    if (area === "adopted") {
      setView("list");
      if (tools) tools.hidden = true;
    } else {
      if (tools) tools.hidden = false;
      if (area !== "official") setView("list");
    }
    loadPets();
  }

  $$(".src-tab").forEach((t) => t.addEventListener("click", () => setArea(t.dataset.area)));

  $$(".chip[data-tag]").forEach((chip) =>
    chip.addEventListener("click", () => {
      activeTag = chip.dataset.tag;
      $$(".chip[data-tag]").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      renderCards();
      if (area === "official" && view === "map") renderMap();
    })
  );

  function setView(v) {
    view = v;
    const isMap = v === "map" && area === "official";
    $("#petsList").hidden = isMap;
    mapView.hidden = !isMap;
    $$(".view-toggle__btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
    if (isMap) resetMapInfo();
  }

  $$(".view-toggle__btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (area !== "official" && btn.dataset.view === "map") return;
      setView(btn.dataset.view);
    })
  );

  function updateVisibility() {
    const toggle = $(".view-toggle");
    if (toggle) toggle.hidden = area !== "official";
    if (view === "map" && area !== "official") setView("list");
  }

  /* ---------------- publish ---------------- */
  const publishForm = $("#publishForm");
  let pendingPhotos = []; // {file?, key, url} 已上传或待传
  let publishId = null;

  function resetPublishForm() {
    editingPet = null;
    publishId = null;
    pendingPhotos = [];
    publishForm.reset();
    $("#photoPreview").innerHTML = "";
    $("#publishErr").textContent = "";
    $("#publishTitle").textContent = "发布送养信息";
    $("#publishSubmit").textContent = "提交审核";
    $("#publishNote").textContent = "提交后进入人工审核，通过才会公开。虚假发布将被永久封号。";
    resetTagPick();
  }

  function openPublish(pet = null) {
    if (!requireLive("发布送养")) return;
    if (!me) {
      openAuth("login");
      toast("先登录，再发布");
      return;
    }
    resetPublishForm();
    if (pet) {
      editingPet = pet;
      publishId = pet.id;
      $("#publishTitle").textContent = `修改「${pet.name}」的信息`;
      $("#publishSubmit").textContent = "保存并重新提交审核";
      publishForm.pname.value = pet.name;
      publishForm.species.value = pet.species;
      publishForm.age.value = pet.age;
      publishForm.sex.value = pet.sex;
      publishForm.neuter.value = pet.neuter === "未知" ? "" : pet.neuter;
      publishForm.vaccine.value = pet.vaccine === "未知" ? "" : pet.vaccine;
      publishForm.city.value = pet.city;
      publishForm.quote.value = pet.quote;
      publishForm.contact.value = pet.contact || "";
      const recommended = new Set([...$$("#tagPick .chip")].map((c) => c.dataset.pick));
      $$("#tagPick .chip").forEach((c) => c.setAttribute("aria-pressed", String(pet.tags.includes(c.dataset.pick))));
      pet.tags.forEach((t) => {
        if (!recommended.has(t)) createCustomChip(t, true);
      });
      pendingPhotos = (pet.photos || []).map((url, i) => ({ key: pet.id, url, existing: true, rawKey: (pet._photoKeys || [])[i] }));
      renderPhotoPreview();
    }
    showOverlay(publishSec);
  }

  function renderPhotoPreview() {
    const box = $("#photoPreview");
    box.innerHTML = pendingPhotos
      .map(
        (p, i) => `
      <div class="photo-thumb">
        <img src="${esc(p.url)}" alt="照片 ${i + 1}">
        <button type="button" class="photo-thumb__del" data-del-photo="${i}" aria-label="删除照片 ${i + 1}">×</button>
      </div>`
      )
      .join("");
    $$("[data-del-photo]", box).forEach((b) =>
      b.addEventListener("click", () => {
        pendingPhotos.splice(Number(b.dataset.delPhoto), 1);
        renderPhotoPreview();
      })
    );
  }

  const tagPick = $("#tagPick");
  const customTagInput = $("#customTagInput");

  function resetTagPick() {
    if (!tagPick) return;
    $$(".chip", tagPick).forEach((c) => {
      if (c.classList.contains("chip--custom")) c.remove();
      else c.setAttribute("aria-pressed", "false");
    });
  }

  if (tagPick) {
    tagPick.addEventListener("click", (e) => {
      const del = e.target.closest(".chip__del");
      const chip = e.target.closest(".chip");
      if (del && chip && chip.classList.contains("chip--custom")) {
        chip.remove();
        return;
      }
      if (!chip) return;
      const on = chip.getAttribute("aria-pressed") === "true";
      if (!on && $$("#tagPick .chip[aria-pressed='true']").length >= 3) {
        toast("最多选 3 个标签");
        return;
      }
      chip.setAttribute("aria-pressed", String(!on));
    });
  }

  function createCustomChip(val, pressed = true) {
    if (!tagPick) return null;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip chip--custom";
    chip.dataset.pick = val;
    chip.setAttribute("aria-pressed", String(pressed));
    chip.innerHTML = `${esc(val)} <span class="chip__del" aria-hidden="true">×</span>`;
    tagPick.appendChild(chip);
    return chip;
  }

  function addCustomTag() {
    if (!tagPick || !customTagInput) return;
    const val = (customTagInput.value || "").trim().slice(0, 6);
    if (!val) {
      toast("写个标签名");
      return;
    }
    const exists = [...tagPick.querySelectorAll(".chip")].some((c) => c.dataset.pick === val);
    if (exists) {
      toast("这个标签已经有了");
      customTagInput.value = "";
      return;
    }
    if ($$("#tagPick .chip[aria-pressed='true']").length >= 3) {
      toast("最多选 3 个标签");
      return;
    }
    createCustomChip(val, true);
    customTagInput.value = "";
    customTagInput.focus();
  }

  if ($("#addCustomTag")) $("#addCustomTag").addEventListener("click", addCustomTag);
  if (customTagInput) {
    customTagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addCustomTag();
      }
    });
  }

  if ($("#photoInput")) {
    $("#photoInput").addEventListener("change", (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      for (const file of files) {
        if (pendingPhotos.length >= 3) {
          toast("最多 3 张照片");
          break;
        }
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
          toast("只支持 JPG / PNG / WebP 图片");
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          toast("单张照片不能超过 5MB");
          continue;
        }
        pendingPhotos.push({ file, url: URL.createObjectURL(file) });
      }
      renderPhotoPreview();
    });
  }

  async function uploadPhoto(petId, file, n) {
    const ticket = await api("/api/upload-ticket", { method: "POST", body: { petId, n } });
    const res = await fetch(ticket.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw new Error("照片上传失败，请重试");
    return ticket.key;
  }

  publishForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#publishErr");
    errEl.textContent = "";
    const submitBtn = $("#publishSubmit");
    const tags = $$("#tagPick .chip[aria-pressed='true']").map((c) => c.dataset.pick);
    try {
      if (!pendingPhotos.length) throw new Error("至少上传一张照片");
      submitBtn.disabled = true;
      submitBtn.textContent = "正在提交…";
      const id = publishId || crypto.randomUUID();
      const usedIdx = new Set(
        pendingPhotos
          .filter((p) => p.existing && p.rawKey)
          .map((p) => Number(p.rawKey.split("-").pop()))
          .filter((x) => Number.isInteger(x))
      );
      const photoKeys = [];
      for (const p of pendingPhotos) {
        if (p.existing && p.rawKey) {
          photoKeys.push(p.rawKey);
        } else {
          let idx = 0;
          while (usedIdx.has(idx)) idx++;
          usedIdx.add(idx);
          photoKeys.push(await uploadPhoto(id, p.file, idx));
        }
      }
      const payload = {
        id,
        name: publishForm.pname.value,
        species: publishForm.species.value,
        age: publishForm.age.value,
        sex: publishForm.sex.value,
        neuter: publishForm.neuter.value,
        vaccine: publishForm.vaccine.value,
        city: publishForm.city.value,
        quote: publishForm.quote.value,
        contact: publishForm.contact.value,
        tags,
        photoKeys
      };
      if (editingPet) {
        await api(`/api/pets/${id}`, { method: "PATCH", body: payload });
        toast("已保存，等待重新审核");
      } else {
        await api("/api/pets", { method: "POST", body: payload });
        toast("已提交审核，通过后会公开显示");
      }
      closeOverlays();
      resetPublishForm();
      openAccount("mypets");
    } catch (e2) {
      errEl.textContent = e2.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editingPet ? "保存并重新提交审核" : "提交审核";
    }
  });

  async function openPetComments(petId) {
    let pet = currentPets.find((p) => p.id === petId);
    if (!pet) {
      for (const name of ["user", "adopted"]) {
        try {
          const data = await api(`/api/pets?area=${name}`);
          pet = data.pets.find((p) => p.id === petId);
          if (pet) break;
        } catch {}
      }
    }
    if (!pet) {
      toast("这只猫咪已经下架了");
      return;
    }
    closeOverlays();
    openComments(pet);
  }

  /* ---------------- account ---------------- */
  const accountBody = $("#accountBody");

  function openAccount(tab = "inbox") {
    if (!requireLive("我的小屋")) return;
    if (!me) {
      openAuth("login");
      return;
    }
    showOverlay(accountSec);
    $$(".account__tab").forEach((t) => {
      const on = t.dataset.atab === tab;
      t.setAttribute("aria-selected", String(on));
      t.hidden = t.dataset.atab === "admin" && !me.admin;
    });
    loadAccountTab(tab);
  }

  $$(".account__tab").forEach((t) => t.addEventListener("click", () => openAccount(t.dataset.atab)));

  function myPetRow(pet) {
    const statusMap = {
      pending: `<span class="status status--meeting">审核中</span>`,
      approved: `<span class="status status--waiting">展示中</span>`,
      rejected: `<span class="status status--home">未通过</span>`,
      adopted: `<span class="status status--home">已回家</span>`
    };
    return `
    <article class="my-pet" data-id="${esc(pet.id)}">
      <img class="my-pet__img" src="${esc(pet.photo || "assets/favicon.svg")}" alt="">
      <div class="my-pet__main">
        <h4>${esc(pet.name)} <span>${esc(pet.city)}</span></h4>
        <p class="my-pet__status">${statusMap[pet.status] || ""}${pet.rejectReason ? `<em>原因：${esc(pet.rejectReason)}</em>` : ""}</p>
        <div class="my-pet__actions">
          ${pet.status === "pending" ? `<button class="btn btn--small" type="button" data-edit="${esc(pet.id)}">修改</button>` : ""}
          ${pet.status === "approved" ? `<button class="btn btn--small btn--lime" type="button" data-adopt="${esc(pet.id)}">它回家了</button>` : ""}
          <button class="btn btn--small btn--coral" type="button" data-del="${esc(pet.id)}">删除</button>
        </div>
      </div>
    </article>`;
  }

  const APPLY_STATUS = { pending: "待处理", contacted: "已联系", closed: "已关闭" };

  function inboxItemHTML(it) {
    const isApply = it.type === "application";
    return `
    <article class="inbox" data-type="${esc(it.type)}" data-pet="${esc(it.petId)}" data-id="${esc(it.id)}">
      <div class="inbox__head">
        <span class="tag ${isApply ? "tag--lime" : ""}">${isApply ? "领养申请" : "留言"}</span>
        <b>${esc(it.author)}</b>
        <span class="inbox__about">关于「${esc(it.petName)}」</span>
        <span class="comment__time">${esc(timeAgo(it.at))}</span>
      </div>
      <p class="inbox__text">${esc(it.text)}</p>
      ${it.housing ? `<p class="inbox__meta">居住：${esc(it.housing)}</p>` : ""}
      ${it.contact ? `<p class="inbox__meta">联系方式：<b>${esc(it.contact)}</b></p>` : ""}
      ${isApply
        ? `<div class="inbox__actions">
            <span class="status ${it.status === "pending" ? "status--waiting" : "status--home"}">${APPLY_STATUS[it.status] || it.status}</span>
            ${it.status !== "contacted" ? `<button class="btn btn--small btn--lime" type="button" data-contact>标记已联系</button>` : ""}
            ${it.status !== "closed" ? `<button class="btn btn--small" type="button" data-close-apply>关闭</button>` : ""}
          </div>`
        : `<div class="inbox__actions"><button class="btn btn--small" type="button" data-open-pet="${esc(it.petId)}">去回复</button></div>`}
    </article>`;
  }

  function myCommentRow(c) {
    return `
    <article class="inbox" data-pet="${esc(c.petId)}" data-id="${esc(c.id)}">
      <div class="inbox__head">
        <span class="tag">我的留言</span>
        <b>关于「${esc(c.petName)}」</b>
        <span class="comment__time">${esc(timeAgo(c.createdAt))}</span>
      </div>
      <p class="inbox__text">${esc(c.text)}</p>
      <div class="inbox__actions">
        <span class="inbox__meta">♥ ${c.likes || 0}${c.replies.length ? ` · ${c.replies.length} 条回复` : ""}</span>
        <button class="btn btn--small" type="button" data-open-pet="${esc(c.petId)}">去留言区</button>
        <button class="btn btn--small" type="button" data-del-my>删除</button>
      </div>
    </article>`;
  }

  async function loadAccountTab(tab) {
    accountBody.innerHTML = `<p class="loading-line">正在加载…</p>`;
    try {
      if (tab === "favorites") {
        const data = await api("/api/my/favorites");
        accountBody.innerHTML = data.pets.length
          ? `<div class="pets-grid pets-grid--flat">${data.pets.map(cardHTML).join("")}</div>`
          : `<p class="account__empty">还没有收藏。看到心动的，点卡片上的心。</p>`;
        bindCardEventsIn(accountBody, data.pets);
      } else if (tab === "mypets") {
        const data = await api("/api/my/pets");
        accountBody.innerHTML = data.pets.length
          ? data.pets.map(myPetRow).join("")
          : `<p class="account__empty">还没有发布过。点右上角菜单里的「发布送养」开始。</p>`;
        $$("[data-edit]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            const pet = data.pets.find((p) => p.id === b.dataset.edit);
            openPublish(pet);
          })
        );
        $$("[data-adopt]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            if (!confirm("确认它已经到家了吗？卡片会移入「已回家」区域。")) return;
            await api(`/api/pets/${b.dataset.adopt}`, { method: "PATCH", body: { action: "adopt" } });
            toast("恭喜它回家！");
            loadAccountTab("mypets");
            loadPets();
          })
        );
        $$("[data-del]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            if (!confirm("确定删除这条信息吗？照片也会一起删掉。")) return;
            await api(`/api/pets/${b.dataset.del}`, { method: "DELETE" });
            toast("已删除");
            loadAccountTab("mypets");
          })
        );
      } else if (tab === "inbox") {
        const data = await api("/api/my/inbox");
        accountBody.innerHTML = data.items.length
          ? data.items.map(inboxItemHTML).join("")
          : `<p class="account__empty">还没有收到留言或申请。猫咪展示出去后，消息会出现在这里。</p>`;
        $$("[data-contact]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            const art = b.closest(".inbox");
            try {
              await api(`/api/pets/${art.dataset.pet}/applications/${art.dataset.id}`, {
                method: "PATCH",
                body: { status: "contacted" }
              });
              toast("已标记为已联系");
              loadAccountTab("inbox");
            } catch (e) {
              toast(e.message);
            }
          })
        );
        $$("[data-close-apply]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            const art = b.closest(".inbox");
            try {
              await api(`/api/pets/${art.dataset.pet}/applications/${art.dataset.id}`, {
                method: "PATCH",
                body: { status: "closed" }
              });
              toast("已关闭这条申请");
              loadAccountTab("inbox");
            } catch (e) {
              toast(e.message);
            }
          })
        );
        $$("[data-open-pet]", accountBody).forEach((b) =>
          b.addEventListener("click", () => openPetComments(b.dataset.openPet))
        );
      } else if (tab === "comments") {
        const data = await api("/api/my/comments");
        accountBody.innerHTML = data.comments.length
          ? data.comments.map(myCommentRow).join("")
          : `<p class="account__empty">还没有写过留言。去看看等家的伙伴，跟它说句话。</p>`;
        $$("[data-open-pet]", accountBody).forEach((b) =>
          b.addEventListener("click", () => openPetComments(b.dataset.openPet))
        );
        $$("[data-del-my]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            const art = b.closest(".inbox");
            if (!confirm("删除这条留言？")) return;
            try {
              await api(`/api/pets/${art.dataset.pet}/comments/${art.dataset.id}`, { method: "DELETE" });
              toast("已删除");
              loadAccountTab("comments");
            } catch (e) {
              toast(e.message);
            }
          })
        );
      } else if (tab === "admin") {
        const data = await api("/api/admin/pending");
        accountBody.innerHTML = data.pets.length
          ? data.pets.map(adminRow).join("")
          : `<p class="account__empty">没有待审核的信息，清净了。</p>`;
        $$("[data-approve]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            await api("/api/admin/review", { method: "POST", body: { id: b.dataset.approve, action: "approve" } });
            toast("已通过，公开展示");
            loadAccountTab("admin");
            loadPets();
          })
        );
        $$("[data-reject]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            const reason = prompt("拒绝原因（会展示给发布者）：", "信息不完整，请补充后再提交");
            if (reason === null) return;
            await api("/api/admin/review", { method: "POST", body: { id: b.dataset.reject, action: "reject", reason } });
            toast("已拒绝");
            loadAccountTab("admin");
          })
        );
        $$("[data-ban]", accountBody).forEach((b) =>
          b.addEventListener("click", async () => {
            if (!confirm(`永久封禁 ${b.dataset.ban}？其名下所有信息将下架，且无法再登录。`)) return;
            await api("/api/admin/ban", { method: "POST", body: { email: b.dataset.ban } });
            toast("已封禁");
            loadAccountTab("admin");
          })
        );
      }
    } catch (e) {
      accountBody.innerHTML = `<p class="account__empty">${esc(e.message)}</p>`;
    }
  }

  function adminRow(pet) {
    return `
    <article class="my-pet my-pet--admin" data-id="${esc(pet.id)}">
      <img class="my-pet__img" src="${esc(pet.photo || "assets/favicon.svg")}" alt="">
      <div class="my-pet__main">
        <h4>${esc(pet.name)} <span>${esc(pet.city)} · ${esc(pet.species)}</span></h4>
        <p class="my-pet__status">发布者：${esc(pet.ownerEmail)} · 联系方式：${esc(pet.contact || "未填")}</p>
        <p class="my-pet__quote">“${esc(pet.quote)}”</p>
        <div class="my-pet__actions">
          <button class="btn btn--small btn--lime" type="button" data-approve="${esc(pet.id)}">通过</button>
          <button class="btn btn--small" type="button" data-reject="${esc(pet.id)}">拒绝</button>
          <button class="btn btn--small btn--coral" type="button" data-ban="${esc(pet.ownerEmail)}">虚假？永久封号</button>
        </div>
      </div>
    </article>`;
  }

  function bindCardEventsIn(root, pets) {
    bindCommentButtons(root, pets);
    bindApplyButtons(root, pets);
    $$("[data-fav]", root).forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.fav;
        const on = !favIds.has(id);
        try {
          await api(`/api/favorites/${id}`, { method: on ? "POST" : "DELETE" });
          if (on) favIds.add(id);
          else favIds.delete(id);
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", String(on));
        } catch (e) {
          toast(e.message);
        }
      })
    );
    $$("[data-pat]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.pat;
        patMap[id] = (patMap[id] || 0) + 1;
        try {
          sessionStorage.setItem(PATS_KEY, JSON.stringify(patMap));
        } catch {}
        $(".pat-count", btn).textContent = patMap[id];
        patBubble(btn);
        spawnParticles(btn);
      })
    );
  }

  /* ---------------- comments ---------------- */
  const commentDialog = $("#commentDialog");
  const commentForm = $("#commentForm");
  let commentPet = null;
  let commentPhotos = []; // {file, url}

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60e3);
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return new Date(ts).toLocaleDateString("zh-CN");
  }

  function renderThumbs(box, photos, onDel) {
    box.innerHTML = photos
      .map(
        (p, i) => `
      <div class="photo-thumb">
        <img src="${esc(p.url)}" alt="图片 ${i + 1}">
        <button type="button" class="photo-thumb__del" data-del-thumb="${i}" aria-label="删除图片 ${i + 1}">×</button>
      </div>`
      )
      .join("");
    $$("[data-del-thumb]", box).forEach((b) =>
      b.addEventListener("click", () => onDel(Number(b.dataset.delThumb)))
    );
  }

  function pickImages(e, target, max, done) {
    const files = [...e.target.files];
    e.target.value = "";
    for (const file of files) {
      if (target.length >= max) {
        toast(`最多 ${max} 张图片`);
        break;
      }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        toast("只支持 JPG / PNG / WebP 图片");
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast("单张图片不能超过 5MB");
        continue;
      }
      target.push({ file, url: URL.createObjectURL(file) });
    }
    done();
  }

  async function uploadScoped(scope, id, file, n) {
    const ticket = await api("/api/upload-ticket", { method: "POST", body: { scope, id, n } });
    const res = await fetch(ticket.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw new Error("图片上传失败，请重试");
    return ticket.key;
  }

  function replyHTML(r) {
    return `
    <div class="comment__reply">
      <span class="comment__avatar comment__avatar--sm" aria-hidden="true">${esc((r.author || "?").slice(0, 1))}</span>
      <div>
        <span class="comment__author">${esc(r.author)}</span>
        <span class="comment__time">${esc(timeAgo(r.createdAt))}</span>
        <p>${esc(r.text)}</p>
      </div>
    </div>`;
  }

  function commentItemHTML(c) {
    return `
    <article class="comment" data-cid="${esc(c.id)}">
      <div class="comment__head">
        <span class="comment__avatar" aria-hidden="true">${esc((c.author || "?").slice(0, 1))}</span>
        <span class="comment__author">${esc(c.author)}</span>
        <span class="comment__time">${esc(timeAgo(c.createdAt))}</span>
        ${c.mine ? `<button class="comment__del" type="button" data-del-comment="${esc(c.id)}">删除</button>` : ""}
      </div>
      ${c.text ? `<p class="comment__text">${esc(c.text)}</p>` : ""}
      ${c.photos.length ? `<div class="comment__photos">${c.photos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="留言图片 ${i + 1}" loading="lazy"></a>`).join("")}</div>` : ""}
      <div class="comment__foot">
        <button class="comment__like${c.liked ? " is-on" : ""}" type="button" data-like="${esc(c.id)}" aria-pressed="${c.liked}" aria-label="给这条留言点赞">
          <span aria-hidden="true">♥</span> <b>${c.likes || 0}</b>
        </button>
        <button class="comment__replybtn" type="button" data-reply="${esc(c.id)}">回复</button>
      </div>
      ${c.replies.length ? `<div class="comment__replies">${c.replies.map(replyHTML).join("")}</div>` : ""}
    </article>`;
  }

  function renderCommentPreview() {
    renderThumbs($("#commentPhotoPreview"), commentPhotos, (i) => {
      commentPhotos.splice(i, 1);
      renderCommentPreview();
    });
  }

  function renderCommentFormState() {
    const wrap = $("#commentFormWrap");
    if (me) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      commentForm.hidden = false;
    } else {
      wrap.hidden = false;
      commentForm.hidden = true;
      wrap.innerHTML = `<div class="comments__login"><p>登录后就能留言、发图片。</p><button class="btn btn--small" type="button" id="commentLoginBtn">登录 / 注册</button></div>`;
      $("#commentLoginBtn").addEventListener("click", () => {
        if (commentDialog.open) commentDialog.close();
        openAuth("login");
      });
    }
  }

  function setCommentCount(petId, n) {
    const pet = currentPets.find((p) => p.id === petId);
    if (pet) pet.commentCount = n;
    $$(`[data-comment="${CSS.escape(petId)}"]`).forEach((btn) => {
      const el = $(".cmt-count", btn);
      if (el) el.textContent = n;
    });
  }

  async function loadComments(petId) {
    const list = $("#commentList");
    try {
      const data = await api(`/api/pets/${petId}/comments`);
      list.innerHTML = data.comments.length
        ? data.comments.map(commentItemHTML).join("")
        : `<p class="comments__empty">还没有留言。做第一个跟它说话的人。</p>`;
      $$("[data-del-comment]", list).forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!confirm("删除这条留言？")) return;
          try {
            await api(`/api/pets/${petId}/comments/${btn.dataset.delComment}`, { method: "DELETE" });
            toast("已删除");
            loadComments(petId);
          } catch (e) {
            toast(e.message);
          }
        })
      );
      $$("[data-like]", list).forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!me) {
            if (commentDialog.open) commentDialog.close();
            openAuth("login");
            toast("先登录，再点赞");
            return;
          }
          const on = !btn.classList.contains("is-on");
          try {
            const r = await api(`/api/pets/${petId}/comments/${btn.dataset.like}/like`, { method: on ? "POST" : "DELETE" });
            btn.classList.toggle("is-on", r.liked);
            btn.setAttribute("aria-pressed", String(r.liked));
            $("b", btn).textContent = r.likes;
          } catch (e) {
            toast(e.message);
          }
        })
      );

      $$("[data-reply]", list).forEach((btn) =>
        btn.addEventListener("click", () => {
          if (!me) {
            if (commentDialog.open) commentDialog.close();
            openAuth("login");
            toast("先登录，再回复");
            return;
          }
          const art = btn.closest(".comment");
          if ($(".comment__replyform", art)) {
            $(".comment__replyform input", art).focus();
            return;
          }
          const form = document.createElement("form");
          form.className = "comment__replyform";
          form.innerHTML = `<input type="text" maxlength="120" required placeholder="回复这条留言…" aria-label="回复内容"><button class="btn btn--small btn--coral" type="submit">发送</button>`;
          art.appendChild(form);
          const input = $("input", form);
          input.focus();
          form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const val = input.value.trim();
            if (!val) return;
            const sbtn = $("button", form);
            sbtn.disabled = true;
            try {
              await api(`/api/pets/${petId}/comments/${btn.dataset.reply}/replies`, {
                method: "POST",
                body: { id: crypto.randomUUID(), text: val }
              });
              toast("回复已发出");
              loadComments(petId);
            } catch (err) {
              toast(err.message);
              sbtn.disabled = false;
            }
          });
        })
      );

      setCommentCount(petId, data.comments.length);
    } catch (e) {
      list.innerHTML = `<p class="comments__empty">${esc(e.message)}</p>`;
    }
  }

  function openComments(pet) {
    if (!requireLive("留言")) return;
    commentPet = pet;
    commentPhotos = [];
    $("#commentPetImg").src = pet.photo || "assets/favicon.svg";
    $("#commentPetImg").alt = pet.alt || pet.name;
    $("#commentPetName").textContent = `${pet.name} 的留言`;
    $("#commentPetMeta").textContent = `${pet.city} · ${pet.species} · ${pet.status === "adopted" ? "已回家" : "等待中"}`;
    commentForm.reset();
    $("#commentErr").textContent = "";
    renderCommentPreview();
    renderCommentFormState();
    if (!commentDialog.open) commentDialog.showModal();
    loadComments(pet.id);
  }

  if ($("#commentPhotoInput")) {
    $("#commentPhotoInput").addEventListener("change", (e) =>
      pickImages(e, commentPhotos, 3, renderCommentPreview)
    );
  }

  if (commentForm) {
    commentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $("#commentErr");
      errEl.textContent = "";
      if (!commentPet) return;
      const textVal = commentForm.ctext.value.trim();
      if (!textVal && !commentPhotos.length) {
        errEl.textContent = "写点什么，或者发张图片";
        return;
      }
      const btn = $("#commentSubmit");
      btn.disabled = true;
      btn.textContent = "发布中…";
      try {
        const id = crypto.randomUUID();
        const keys = [];
        for (let i = 0; i < commentPhotos.length; i++) {
          keys.push(await uploadScoped("comment", id, commentPhotos[i].file, i));
        }
        await api(`/api/pets/${commentPet.id}/comments`, {
          method: "POST",
          body: { id, text: textVal, photoKeys: keys }
        });
        commentForm.reset();
        commentPhotos = [];
        renderCommentPreview();
        toast("留言已发布");
        loadComments(commentPet.id);
      } catch (e2) {
        errEl.textContent = e2.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "发布留言";
      }
    });
  }

  /* ---------------- adoption application ---------------- */
  const applyDialog = $("#applyDialog");
  const applyForm = $("#applyForm");
  let applyPet = null;

  function openApply(pet) {
    if (!requireLive("领养申请")) return;
    if (!me) {
      openAuth("login");
      toast("先登录，再申请领养");
      return;
    }
    if (!applyDialog) return;
    applyPet = pet;
    $("#applyPetImg").src = pet.photo || "assets/favicon.svg";
    $("#applyPetImg").alt = pet.alt || pet.name;
    $("#applyPetName").textContent = `申请领养 ${pet.name}`;
    $("#applyPetMeta").textContent = `${pet.city} · ${pet.species} · ${pet.age}`;
    applyForm.reset();
    applyForm.hidden = false;
    $("#applyDone").hidden = true;
    $("#applyErr").textContent = "";
    if (!applyDialog.open) applyDialog.showModal();
  }

  if (applyForm) {
    applyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!applyPet) return;
      const errEl = $("#applyErr");
      errEl.textContent = "";
      const intro = applyForm.intro.value.trim();
      const contact = applyForm.contact.value.trim();
      if (intro.length < 8) {
        errEl.textContent = "简单介绍一下自己和照顾计划（至少 8 个字）";
        return;
      }
      if (!contact) {
        errEl.textContent = "留个联系方式，方便对方联系你";
        return;
      }
      const btn = $("#applySubmit");
      btn.disabled = true;
      btn.textContent = "提交中…";
      try {
        await api(`/api/pets/${applyPet.id}/applications`, {
          method: "POST",
          body: {
            id: crypto.randomUUID(),
            intro,
            housing: applyForm.housing.value.trim(),
            contact
          }
        });
        applyForm.hidden = true;
        $("#applyDone").hidden = false;
        toast("申请已发出，等发布者联系你");
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "提交申请";
      }
    });
  }

  if ($("#applyDoneBtn")) {
    $("#applyDoneBtn").addEventListener("click", () => {
      if (applyDialog) applyDialog.close();
    });
  }

  /* ---------------- wall ---------------- */
  let wallPhotos = [];
  let wallPosts = [];

  function renderWallAuthState() {
    const form = $("#wallForm");
    const login = $("#wallLogin");
    if (!form || !login) return;
    form.hidden = !me;
    login.hidden = !!me;
  }

  function renderWallPreview() {
    renderThumbs($("#wallPhotoPreview"), wallPhotos, (i) => {
      wallPhotos.splice(i, 1);
      renderWallPreview();
    });
  }

  function postHTML(p) {
    const count = Math.min(p.photos.length, 3);
    return `
    <article class="wall-post">
      <header class="wall-post__head">
        <span class="wall-post__author">${esc(p.author)}</span>
        <span class="wall-post__time">${esc(timeAgo(p.createdAt))}</span>
        ${p.mine ? `<button class="wall-post__del" type="button" data-del-post="${esc(p.id)}">删除</button>` : ""}
      </header>
      ${p.text ? `<p class="wall-post__text">${esc(p.text)}</p>` : ""}
      ${
        p.photos.length
          ? `<div class="wall-post__photos wall-post__photos--${count}">${p.photos
              .map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="晒图 ${i + 1}" loading="lazy"></a>`)
              .join("")}</div>`
          : ""
      }
    </article>`;
  }

  function renderPosts() {
    const grid = $("#wallGrid");
    const empty = $("#wallEmpty");
    grid.innerHTML = wallPosts.map(postHTML).join("");
    empty.hidden = wallPosts.length > 0;
    $$("[data-del-post]", grid).forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("删除这条晒图？")) return;
        try {
          await api(`/api/posts/${btn.dataset.delPost}`, { method: "DELETE" });
          toast("已删除");
          loadPosts();
        } catch (e) {
          toast(e.message);
        }
      })
    );
  }

  async function loadPosts() {
    if (staticMode) return;
    try {
      const data = await api("/api/posts");
      wallPosts = data.posts;
      renderPosts();
    } catch (e) {
      $("#wallGrid").innerHTML = `<p class="loading-line">${esc(e.message)}</p>`;
    }
  }

  if ($("#wallPhotoInput")) {
    $("#wallPhotoInput").addEventListener("change", (e) =>
      pickImages(e, wallPhotos, 3, renderWallPreview)
    );
  }

  if ($("#wallForm")) {
    $("#wallForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireLive("晒图发布")) return;
      if (!me) {
        openAuth("login");
        return;
      }
      const errEl = $("#wallErr");
      errEl.textContent = "";
      const textVal = $("#wallForm").wtext.value.trim();
      if (!textVal && !wallPhotos.length) {
        errEl.textContent = "写一句话，或者发一张图";
        return;
      }
      const btn = $("#wallSubmit");
      btn.disabled = true;
      btn.textContent = "发布中…";
      try {
        const id = crypto.randomUUID();
        const keys = [];
        for (let i = 0; i < wallPhotos.length; i++) {
          keys.push(await uploadScoped("post", id, wallPhotos[i].file, i));
        }
        await api("/api/posts", { method: "POST", body: { id, text: textVal, photoKeys: keys } });
        $("#wallForm").reset();
        wallPhotos = [];
        renderWallPreview();
        toast("已发布到晒图墙");
        loadPosts();
      } catch (e2) {
        errEl.textContent = e2.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "发布到晒图墙";
      }
    });
  }

  /* ---------------- real stats ---------------- */
  function setCount(id, value) {
    const el = $("#" + id);
    if (!el) return;
    el.dataset.count = String(value);
    animateCount(el);
  }

  function updateHero(pet, stats) {
    if (!pet) {
      $("#heroImg").src = "assets/favicon.svg";
      $("#heroImg").alt = "还没有等待中的伙伴";
      $("#heroName").textContent = "还没有";
      $("#heroSub").textContent = "等待中的伙伴";
      $("#heroQuote").textContent = "“等第一条真实发布。”";
      $("#heroTags").innerHTML = `<span class="pill">从零开始</span>`;
      $("#heroStatus").textContent = "暂无数据";
    } else {
      $("#heroImg").src = pet.photo || "assets/favicon.svg";
      $("#heroImg").alt = pet.alt || pet.name;
      $("#heroName").textContent = pet.name;
      $("#heroSub").textContent = `${pet.age} · ${pet.species}`;
      $("#heroQuote").textContent = `“${pet.quote}”`;
      $("#heroTags").innerHTML =
        `<span class="pill">${esc(pet.city)}</span>` +
        (pet.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join("");
      $("#heroStatus").textContent = `等待中 · 第 ${pet.days} 天`;
    }
    $("#heroMeta").innerHTML = `<span>${stats.total} 位站内伙伴</span><span class="dot-sep" aria-hidden="true"></span><span>${stats.waiting} 位还在等</span>`;
  }

  function updateTicker(feed) {
    const one = feed
      .map((p) => {
        const state =
          p.status === "adopted" ? `已回家 ${p.days} 天` : p.stage === "meeting" ? "正在见面" : `已等待 ${p.days} 天`;
        return `<span class="ticker__item"><b>${esc(p.city)}</b> · ${esc(p.name)} ${esc(state)}</span>`;
      })
      .join("");
    $("#tickerTrack").innerHTML = one
      ? one + one.replace(/class="ticker__item"/g, 'class="ticker__item" aria-hidden="true"')
      : `<span class="ticker__item">还没有动态，先从发布一只开始。</span>`;
  }

  function applyStats(s) {
    setCount("statWaiting", s.waiting);
    setCount("statAdopted", s.adopted);
    setCount("statAvg", s.avgWaitDays);
    setCount("statCities", s.cities);
    $("#statWaitingNote").textContent = s.waiting ? `分布在 ${s.cities} 座城市` : "暂时没有等待中的伙伴";
    $("#statAdoptedNote").textContent = s.adopted ? "都来自站内真实记录" : "还没有回家记录";
    $("#statCitiesNote").textContent = s.cities ? "来自站内发布的城市" : "还没有城市记录";

    const max = Math.max(1, ...s.months.map((m) => m.count));
    $("#chartBars").innerHTML = s.months
      .map((m, i) => {
        const h = Math.max(2, Math.round((m.count / max) * 100));
        const now = i === s.months.length - 1;
        return `<div class="bar${now ? " bar--now" : ""}" role="img" style="--h:${h}%;--d:${i * 40}ms" tabindex="0" aria-label="${m.label}，${m.count} 只"><span class="bar__tip">${m.count} 只${now ? " · 本月" : ""}</span></div>`;
      })
      .join("");
    $("#chartAxis").innerHTML = s.months.map((m) => `<span>${m.month}</span>`).join("");
    $("#chartMeta").textContent = `${s.months[0].label} — ${s.months[s.months.length - 1].label} · 单位：只`;
    $("#chartBox").setAttribute(
      "aria-label",
      `过去十二个月每月回家的数量依次为：${s.months.map((m) => `${m.label} ${m.count} 只`).join("、")}。`
    );

    setCount("ringPct", s.rate);
    $("#ringSub").textContent = `${s.adopted} / ${s.total}`;
    $("#ringNote").textContent = s.total
      ? `站内 ${s.total} 位公开伙伴中，已有 ${s.adopted} 位回家。`
      : "还没有公开伙伴，数据会从零开始。";
    const offset = 351.86 * (1 - s.rate / 100);
    requestAnimationFrame(() => {
      $("#ringValue").style.strokeDashoffset = String(offset);
    });
    $(".ring__svg").setAttribute(
      "aria-label",
      s.total ? `站内 ${s.total} 位公开伙伴，已回家 ${s.adopted} 位，占 ${s.rate}%。` : "站内还没有公开伙伴。"
    );

    updateHero(s.featured, s);
    updateTicker(s.feed);
  }

  async function loadStats() {
    if (staticMode) return;
    try {
      const s = await api("/api/stats");
      applyStats(s);
    } catch (e) {
      toast(e.message);
    }
  }

  /* ---------------- reveals & counters ---------------- */
  function animateCount(el) {
    const target = Number(el.dataset.count);
    if (reduced.matches) {
      el.textContent = target;
      return;
    }
    const dur = 1100;
    const start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if ("IntersectionObserver" in window) {
    const revealIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            revealIO.unobserve(en.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    $$(".reveal").forEach((el) => revealIO.observe(el));

    const chart = $(".chart");
    if (chart) {
      const chartIO = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            chart.classList.add("is-in");
            chartIO.disconnect();
          }
        },
        { threshold: 0.4 }
      );
      chartIO.observe(chart);
    }

    const countIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            animateCount(en.target);
            countIO.unobserve(en.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    $$("[data-count]").forEach((el) => countIO.observe(el));
  } else {
    $$(".reveal").forEach((el) => el.classList.add("is-in"));
    const chart = $(".chart");
    if (chart) chart.classList.add("is-in");
    $$("[data-count]").forEach(animateCount);
  }

  /* ---------------- match quiz ---------------- */
  const matchDialog = $("#matchDialog");
  const matchForm = $("#matchForm");
  const MATCH_RULES = {
    q1: { 多: ["黏人精", "社牛"], 中: ["安静派", "公寓友好"], 少: ["安静派", "适合新手"] },
    q2: { apartment: ["公寓友好"], house: ["运动型", "社牛"] },
    q3: { alone: ["黏人精", "安静派"], family: ["社牛", "适合新手"], pets: ["社牛", "运动型"] },
    q4: { cuddle: ["黏人精"], quiet: ["安静派"], play: ["运动型", "社牛"] },
    q5: { new: ["适合新手", "安静派"], some: ["运动型", "黏人精"] }
  };

  async function runMatch() {
    const wants = new Set();
    ["q1", "q2", "q3", "q4", "q5"].forEach((k) => {
      const v = matchForm[k].value;
      (MATCH_RULES[k][v] || []).forEach((t) => wants.add(t));
    });
    const resEl = $("#matchResult");
    resEl.hidden = false;
    resEl.innerHTML = `<p class="loading-line">正在找最合拍的伙伴…</p>`;
    try {
      const data = await api("/api/pets?area=user");
      const waiting = data.pets.filter((p) => p.status === "approved");
      if (!waiting.length) {
        resEl.innerHTML = `<p class="account__empty">现在还没有待领养的伙伴。等第一条真实发布出现，再来测一次。</p>`;
        return;
      }
      const scored = waiting
        .map((p) => ({ pet: p, score: (p.tags || []).reduce((s, t) => s + (wants.has(t) ? 2 : 0), 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      resEl.innerHTML = `
        <p class="match__lead">按你的生活方式，最合拍的是：</p>
        <div class="match__cards">
          ${scored
            .map(
              ({ pet, score }) => `
          <article class="match-card" data-jump="${esc(pet.id)}">
            <img src="${esc(pet.photo || "assets/favicon.svg")}" alt="${esc(pet.alt || pet.name)}" loading="lazy">
            <div class="match-card__body">
              <h3>${esc(pet.name)} <span>${esc(pet.species)} · ${esc(pet.age)}</span></h3>
              <p>${esc(pet.quote)}</p>
              <div class="match-card__tags">${(pet.tags || [])
                .map((t) => `<span class="tag ${wants.has(t) ? "tag--lime" : ""}">${esc(t)}</span>`)
                .join("")}</div>
              <span class="match-card__score">合拍度 ${Math.min(100, 40 + score * 10)}%</span>
            </div>
          </article>`
            )
            .join("")}
        </div>
        <p class="match__note">点卡片跳到它所在的位置，展开详情或留言。</p>`;
      $$("[data-jump]", resEl).forEach((card) =>
        card.addEventListener("click", () => jumpToPet(card.dataset.jump))
      );
    } catch (e) {
      resEl.innerHTML = `<p class="account__empty">${esc(e.message)}</p>`;
    }
  }

  async function jumpToPet(id) {
    if (matchDialog) matchDialog.close();
    activeTag = "all";
    $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.tag === "all")));
    if (area !== "user") {
      setArea("user");
      await new Promise((r) => setTimeout(r, 120));
    } else {
      await loadPets();
    }
    const card = $(`.pet-card[data-id="${CSS.escape(id)}"]`);
    if (!card) {
      toast("它可能已经不在列表里了");
      return;
    }
    card.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
    const d = $("details", card);
    if (d) d.open = true;
    card.classList.add("is-flash");
    setTimeout(() => card.classList.remove("is-flash"), 1400);
  }

  if ($("#matchBtn") && matchDialog) {
    $("#matchBtn").addEventListener("click", () => {
      if (!requireLive("配对问答")) return;
      $("#matchResult").hidden = true;
      matchForm.reset();
      $("#matchErr").textContent = "";
      matchDialog.showModal();
    });
  }
  if (matchForm) {
    matchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      runMatch();
    });
  }

  /* ---------------- boot ---------------- */
  (async () => {
    await refreshMe();
    await refreshFavs();
    setView("list");
    loadStats();
    loadPosts();
    loadPets();
  })();
})();
