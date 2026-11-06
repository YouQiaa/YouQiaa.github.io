/* Wait For UR · 等一个家 —— 前端（全栈版） */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

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
  let area = "official"; // official | user | adopted
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

    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $("#regErr");
      errEl.textContent = "";
      if (regForm.password.value.length < 8) {
        errEl.textContent = "密码至少 8 位";
        return;
      }
      try {
        const data = await api("/api/auth/register", {
          method: "POST",
          body: {
            nickname: regForm.nickname.value,
            email: regForm.email.value,
            password: regForm.password.value
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
          <button class="pet-card__pat" type="button" data-pat="${esc(pet.id)}">摸摸它 <span class="pat-count">${patMap[pet.id] || 0}</span></button>
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

  function bindCardEvents() {
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
        spawnParticles(btn);
      })
    );
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

  $$(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      activeTag = chip.dataset.tag;
      $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
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
  }

  function openPublish(pet = null) {
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
      $$("#tagPick .chip").forEach((c) => c.setAttribute("aria-pressed", String(pet.tags.includes(c.dataset.pick))));
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

  $$("#tagPick .chip").forEach((c) =>
    c.addEventListener("click", () => {
      const on = c.getAttribute("aria-pressed") === "true";
      if (!on && $$("#tagPick .chip[aria-pressed='true']").length >= 3) {
        toast("最多选 3 个标签");
        return;
      }
      c.setAttribute("aria-pressed", String(!on));
    })
  );

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
      openAccount("mypets");
    } catch (e2) {
      errEl.textContent = e2.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editingPet ? "保存并重新提交审核" : "提交审核";
    }
  });

  /* ---------------- account ---------------- */
  const accountBody = $("#accountBody");

  function openAccount(tab = "favorites") {
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

  async function loadAccountTab(tab) {
    accountBody.innerHTML = `<p class="loading-line">正在加载…</p>`;
    try {
      if (tab === "favorites") {
        const data = await api("/api/my/favorites");
        accountBody.innerHTML = data.pets.length
          ? `<div class="pets-grid pets-grid--flat">${data.pets.map(cardHTML).join("")}</div>`
          : `<p class="account__empty">还没有收藏。看到心动的，点卡片上的心。</p>`;
        bindCardEventsIn(accountBody);
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

  function bindCardEventsIn(root) {
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
        spawnParticles(btn);
      })
    );
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

  /* ---------------- boot ---------------- */
  (async () => {
    await refreshMe();
    await refreshFavs();
    setView("list");
    loadPets();
  })();
})();
