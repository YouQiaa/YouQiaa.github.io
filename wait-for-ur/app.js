(function () {
  "use strict";

  /* ------------------------------------------------------------------
     数据字段预留：id / 昵称 / 城市 / 性格标签 / 状态 / 等待天数 /
     救助站 / 照片 / 一句话自述。换成真实接口时结构不用改。
  ------------------------------------------------------------------ */
  const pets = [
    {
      id: "mashu",
      name: "麻薯",
      species: "橘白猫",
      age: "3 岁",
      sex: "公",
      neuter: "已绝育",
      vaccine: "三联 + 狂犬齐全",
      city: "杭州",
      coords: [708, 442],
      label: { dx: 22, dy: 22, anchor: "start" },
      tags: ["安静派", "黏人精"],
      status: "waiting",
      days: 87,
      shelter: "杭州小院",
      photo: "assets/pets/mashu.svg",
      alt: "三岁的橘白猫麻薯坐在客厅沙发上",
      quote: "我不太会看镜头，但很会等你在沙发上坐下来。"
    },
    {
      id: "juzuo",
      name: "橘座",
      species: "橘猫",
      age: "5 岁",
      sex: "公",
      neuter: "已绝育",
      vaccine: "三联 + 狂犬齐全",
      city: "成都",
      coords: [501, 437],
      label: { dx: 0, dy: 34, anchor: "middle" },
      tags: ["社牛"],
      status: "home",
      days: 12,
      shelter: "成都毛孩子之家",
      photo: "assets/pets/juzuo.svg",
      alt: "一只橘猫躺在奶油色地毯上晒太阳",
      quote: "我已经回家了。位置空出来，下一个会是谁？"
    },
    {
      id: "afu",
      name: "阿福",
      species: "中华田园犬",
      age: "2 岁",
      sex: "公",
      neuter: "已绝育",
      vaccine: "八联 + 狂犬齐全",
      city: "武汉",
      coords: [633, 437],
      label: { dx: -22, dy: -10, anchor: "end" },
      tags: ["运动型", "适合新手"],
      status: "waiting",
      days: 54,
      shelter: "武汉流浪动物救助站",
      photo: "assets/pets/afu.svg",
      alt: "一只黄白色的中华田园犬坐在公园碎石路上",
      quote: "我跑得快，但会在路口停下来等你。"
    },
    {
      id: "douban",
      name: "豆瓣",
      species: "玳瑁猫",
      age: "4 岁",
      sex: "母",
      neuter: "已绝育",
      vaccine: "三联齐全",
      city: "上海",
      coords: [723, 428],
      label: { dx: 22, dy: -4, anchor: "start" },
      tags: ["安静派", "公寓友好"],
      status: "waiting",
      days: 132,
      flag: "等最久",
      shelter: "上海领养日",
      photo: "assets/pets/douban.svg",
      alt: "一只玳瑁猫蜷在书架上的书堆中间",
      quote: "我大部分时间在书架上，偶尔下来看看你在不在。"
    },
    {
      id: "qixi",
      name: "七喜",
      species: "比格犬",
      age: "1 岁",
      sex: "公",
      neuter: "已绝育",
      vaccine: "八联 + 狂犬齐全",
      city: "广州",
      coords: [620, 557],
      label: { dx: 20, dy: 6, anchor: "start" },
      tags: ["社牛", "运动型"],
      status: "meeting",
      days: 9,
      shelter: "广州阿派",
      photo: "assets/pets/qixi.svg",
      alt: "一只比格犬在草地上奔跑，耳朵飞起来",
      quote: "我耳朵很大，能听见你开零食袋的声音。"
    },
    {
      id: "xiaoman",
      name: "小满",
      species: "长毛白猫",
      age: "6 岁",
      sex: "母",
      neuter: "已绝育",
      vaccine: "三联 + 狂犬齐全",
      city: "北京",
      coords: [660, 287],
      label: { dx: 0, dy: -22, anchor: "middle" },
      tags: ["黏人精", "公寓友好"],
      status: "waiting",
      days: 41,
      shelter: "北京幸运土猫",
      photo: "assets/pets/xiaoman.svg",
      alt: "一只奶油白色长毛猫趴在米色毯子上",
      quote: "我睡觉的时间很长，但只要你坐下，我就醒。"
    }
  ];

  const STATUS = {
    waiting: { label: "等待中", cls: "waiting" },
    meeting: { label: "见面中", cls: "meeting" },
    home: { label: "已回家", cls: "home" }
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ---------------- theme ---------------- */
  const root = document.documentElement;
  const themeToggles = $$("[data-theme-toggle]");
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function readStore(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }
  function writeStore(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* 隐私模式下忽略 */
    }
  }

  function setTheme(theme) {
    root.dataset.theme = theme;
    themeToggles.forEach(function (btn) {
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      btn.setAttribute("aria-label", theme === "dark" ? "切换到日间模式" : "切换到夜间模式");
    });
    if (themeMeta) {
      themeMeta.setAttribute("content", theme === "dark" ? "#14131A" : "#F6F3EA");
    }
    writeStore("wfu-theme", theme);
  }

  let savedTheme = readStore("wfu-theme");
  if (!savedTheme) {
    savedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  setTheme(savedTheme);

  themeToggles.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
  });

  /* ---------------- paw cursor ---------------- */
  const pawToggle = $("#pawToggle");
  const savedPaw = readStore("wfu-paw");
  const pawOn = savedPaw === null ? true : savedPaw === "on";

  function applyPaw(on) {
    document.body.classList.toggle("paw-cursor", on);
    if (pawToggle) pawToggle.checked = on;
    writeStore("wfu-paw", on ? "on" : "off");
  }
  applyPaw(pawOn);

  if (pawToggle) {
    pawToggle.addEventListener("change", function () {
      applyPaw(pawToggle.checked);
    });
  }

  /* ---------------- pat counts ---------------- */
  function patKey(id) {
    return "wfu-pat-" + id;
  }
  function getPat(id) {
    try {
      return parseInt(sessionStorage.getItem(patKey(id)) || "0", 10) || 0;
    } catch (err) {
      return 0;
    }
  }
  function setPat(id, n) {
    try {
      sessionStorage.setItem(patKey(id), String(n));
    } catch (err) {
      /* 忽略 */
    }
  }
  function patLabel(pet) {
    return pet.status === "home" ? "想它了" : "摸摸它";
  }
  function countText(pet, n) {
    if (pet.status === "home") {
      return n > 0 ? "有人想它 <b>" + n + "</b> 次" : "还没人想它";
    }
    return n > 0 ? "已被摸摸 <b>" + n + "</b> 次" : "还没人摸过";
  }

  /* ---------------- render cards ---------------- */
  const grid = $("#petsGrid");
  const resultCount = $("#resultCount");
  const emptyState = $("#emptyState");
  const mapView = $("#mapView");
  const petsList = $("#petsList");
  const mapDots = $("#mapDots");
  const mapInfo = $("#mapInfo");

  function detailRow(term, value) {
    return "<div><dt>" + term + "</dt><dd>" + value + "</dd></div>";
  }

  function renderCards() {
    if (!grid) return;
    let html = "";
    pets.forEach(function (pet, index) {
      const st = STATUS[pet.status];
      const daysLabel = pet.status === "home"
        ? "已回家 " + pet.days + " 天"
        : (pet.status === "meeting" ? "见面第 " + pet.days + " 天" : "第 " + pet.days + " 天");
      const pats = getPat(pet.id);
      const hoverSticker = pet.tags[1] || (pet.status === "home" ? "好日子" : "来坐坐");

      html +=
        '<article class="pet-card" data-id="' + pet.id + '" style="--ad:' + (index * 55) + 'ms">' +
          '<div class="pet-card__media">' +
            '<img src="' + pet.photo + '" width="900" height="810" loading="lazy" decoding="async" alt="' + pet.alt + '">' +
            '<span class="status status--' + st.cls + ' pet-card__status">' + st.label + "</span>" +
            (pet.flag ? '<span class="pet-card__flag">' + pet.flag + "</span>" : "") +
            '<span class="sticker sticker--coral pet-card__sticker">' + pet.tags[0] + "</span>" +
            '<span class="sticker pet-card__sticker-hover">' + hoverSticker + "</span>" +
          "</div>" +
          '<div class="pet-card__body">' +
            '<div class="pet-card__head">' +
              "<h3>" + pet.name + "</h3>" +
              '<span class="pet-card__meta">' + pet.species + " · " + pet.age + " · " + pet.city + "</span>" +
            "</div>" +
            '<p class="pet-card__quote">“' + pet.quote + '”</p>' +
            '<div class="pet-card__tags">' +
              pet.tags.map(function (tag) { return '<span class="tag">' + tag + "</span>"; }).join("") +
            "</div>" +
            '<div class="pet-card__actions">' +
              '<button class="btn btn--lime btn--small" type="button" data-pat="' + pet.id + '">' + patLabel(pet) + "</button>" +
              '<span class="pat-count" data-pat-count aria-live="polite">' + countText(pet, pats) + "</span>" +
            "</div>" +
            '<details class="pet-details">' +
              '<summary><span class="plus" aria-hidden="true">+</span>展开看详情</summary>' +
              "<dl>" +
                detailRow("年龄", pet.age) +
                detailRow("性别", pet.sex) +
                detailRow("绝育", pet.neuter) +
                detailRow("疫苗", pet.vaccine) +
                detailRow("城市", pet.city) +
                detailRow("救助站", pet.shelter) +
                detailRow(pet.status === "home" ? "回家" : "等待", daysLabel) +
                detailRow("性格", pet.tags.join(" / ")) +
              "</dl>" +
            "</details>" +
          "</div>" +
        "</article>";
    });
    grid.innerHTML = html;
  }

  /* ---------------- render map ---------------- */
  function renderMap() {
    if (!mapDots) return;
    let html = "";
    pets.forEach(function (pet) {
      const st = STATUS[pet.status];
      const x = pet.coords[0];
      const y = pet.coords[1];
      html +=
        '<g class="map-dot" data-id="' + pet.id + '" data-status="' + pet.status + '" tabindex="0" role="button"' +
          ' aria-label="' + pet.name + "，" + pet.city + "，" + st.label + '，点击查看"' +
          ' transform="translate(' + x + "," + y + ')">' +
          '<circle class="map-dot__halo" r="19"></circle>' +
          '<circle class="map-dot__core" r="8.5"></circle>' +
          '<text class="map-dot__label" x="' + pet.label.dx + '" y="' + pet.label.dy + '" text-anchor="' + pet.label.anchor + '">' +
            pet.city + " · " + pet.name +
          "</text>" +
        "</g>";
    });
    mapDots.innerHTML = html;
  }

  /* ---------------- map info ---------------- */
  function waitText(pet) {
    if (pet.status === "home") return "已回家 " + pet.days + " 天";
    if (pet.status === "meeting") return "见面第 " + pet.days + " 天";
    return "等待第 " + pet.days + " 天";
  }

  function resetMapInfo() {
    $$(".map-dot", mapDots).forEach(function (dot) {
      dot.classList.remove("is-selected");
    });
    if (!mapInfo) return;
    mapInfo.innerHTML =
      '<span class="hand map-info__hint">每颗点，都是一只在等。</span>' +
      '<p class="map-info__default">点左边的圆点，就能看到它在哪座城市、等了多久。</p>';
  }

  function showMapPet(id) {
    const pet = pets.filter(function (p) { return p.id === id; })[0];
    if (!pet || !mapInfo) return;
    const st = STATUS[pet.status];
    $$(".map-dot", mapDots).forEach(function (dot) {
      dot.classList.toggle("is-selected", dot.dataset.id === id);
    });
    mapInfo.innerHTML =
      '<div class="map-info__photo"><img src="' + pet.photo + '" width="900" height="810" alt="' + pet.alt + '" loading="lazy" decoding="async"></div>' +
      '<div class="map-info__status"><span class="status status--' + st.cls + '">' + st.label + "</span>" +
        '<span class="map-info__wait">' + waitText(pet) + "</span></div>" +
      '<h4 class="map-info__name">' + pet.name + "<span>" + pet.city + " · " + pet.shelter + "</span></h4>" +
      '<p class="map-info__quote">“' + pet.quote + '”</p>' +
      '<div class="map-info__tags">' +
        pet.tags.map(function (tag) { return '<span class="tag">' + tag + "</span>"; }).join("") +
      "</div>" +
      '<div class="map-info__actions">' +
        '<button class="btn btn--coral btn--small" type="button" data-jump="' + pet.id + '">到它的卡片</button>' +
        '<button class="map-info__reset" type="button" data-reset>看别的</button>' +
      "</div>";
  }

  /* ---------------- filters & views ---------------- */
  let activeTag = "all";
  let currentView = "list";

  const chips = $$(".chip");
  const cards = function () { return $$(".pet-card"); };
  const dots = function () { return $$(".map-dot", mapDots); };

  function visiblePets() {
    return pets.filter(function (pet) {
      return activeTag === "all" || pet.tags.indexOf(activeTag) !== -1;
    });
  }

  function updateVisibility() {
    const list = visiblePets();
    const ids = list.map(function (p) { return p.id; });

    cards().forEach(function (card) {
      card.hidden = ids.indexOf(card.dataset.id) === -1;
    });
    dots().forEach(function (dot) {
      dot.hidden = ids.indexOf(dot.dataset.id) === -1;
    });

    const waiting = list.filter(function (p) { return p.status !== "home"; }).length;
    const home = list.filter(function (p) { return p.status === "home"; }).length;

    if (resultCount) {
      resultCount.innerHTML =
        (activeTag === "all" ? "" : '<b>「' + activeTag + '」</b> · ') +
        "<b>" + list.length + "</b> 位伙伴 · <b>" + waiting + "</b> 位还在等" +
        (home ? " · <b>" + home + "</b> 位已回家" : "");
    }
    if (emptyState) emptyState.hidden = list.length > 0;

    const selected = $(".map-dot.is-selected", mapDots);
    if (selected && ids.indexOf(selected.dataset.id) === -1) {
      resetMapInfo();
    }
  }

  function setFilter(tag) {
    activeTag = tag;
    chips.forEach(function (chip) {
      chip.setAttribute("aria-pressed", chip.dataset.tag === tag ? "true" : "false");
    });
    updateVisibility();
  }

  function setView(view) {
    currentView = view;
    $$("[data-view]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.dataset.view === view ? "true" : "false");
    });
    if (petsList) petsList.hidden = view !== "list";
    if (mapView) mapView.hidden = view !== "map";
  }

  if (chips.length) {
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        setFilter(chip.dataset.tag);
      });
    });
  }

  $$("[data-view]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setView(btn.dataset.view);
    });
  });

  /* ---------------- pat interaction ---------------- */
  function spawnParticles(container) {
    if (reduceMotion.matches || !container) return;
    const colors = ["var(--coral)", "var(--lime)", "var(--purple-deep)"];
    for (let i = 0; i < 5; i += 1) {
      const span = document.createElement("span");
      span.className = "pat-anim";
      span.style.color = colors[i % colors.length];
      span.style.setProperty("--dx", ((Math.random() - 0.5) * 92).toFixed(1) + "px");
      span.style.setProperty("--dy", (-34 - Math.random() * 46).toFixed(1) + "px");
      span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2s-7.2-4.4-7.2-9.2a4.1 4.1 0 0 1 8-1.7 4.1 4.1 0 0 1 8 1.7c0 4.8-8.8 9.2-8.8 9.2Z"></path></svg>';
      container.appendChild(span);
      window.setTimeout(function () {
        if (span.parentNode) span.parentNode.removeChild(span);
      }, 950);
    }
  }

  function handlePat(btn) {
    const pet = pets.filter(function (p) { return p.id === btn.dataset.pat; })[0];
    if (!pet) return;
    const next = getPat(pet.id) + 1;
    setPat(pet.id, next);

    const card = btn.closest(".pet-card");
    if (card) {
      const count = $("[data-pat-count]", card);
      if (count) count.innerHTML = countText(pet, next);
      spawnParticles($(".pet-card__actions", card));
    }

    btn.textContent = "它眯了一下眼";
    window.clearTimeout(btn._patTimer);
    btn._patTimer = window.setTimeout(function () {
      btn.textContent = patLabel(pet);
    }, 1300);
  }

  /* ---------------- events ---------------- */
  if (grid) {
    grid.addEventListener("click", function (event) {
      const btn = event.target.closest("[data-pat]");
      if (btn) handlePat(btn);
    });
  }

  if (mapDots) {
    mapDots.addEventListener("click", function (event) {
      const dot = event.target.closest(".map-dot");
      if (dot) showMapPet(dot.dataset.id);
    });
    mapDots.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const dot = event.target.closest(".map-dot");
      if (!dot) return;
      event.preventDefault();
      showMapPet(dot.dataset.id);
    });
  }

  if (mapInfo) {
    mapInfo.addEventListener("click", function (event) {
      const jump = event.target.closest("[data-jump]");
      if (jump) {
        setView("list");
        const card = $('.pet-card[data-id="' + jump.dataset.jump + '"]', grid);
        if (card) {
          card.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
          card.classList.add("is-flash");
          window.setTimeout(function () { card.classList.remove("is-flash"); }, 1600);
        }
        return;
      }
      if (event.target.closest("[data-reset]")) resetMapInfo();
    });
  }

  /* ---------------- reveal & counters ---------------- */
  function animateCount(el) {
    const target = parseInt(el.dataset.count, 10);
    if (isNaN(target)) return;
    if (reduceMotion.matches) {
      el.textContent = String(target);
      return;
    }
    const start = performance.now();
    const duration = 1200;
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(target * eased));
      if (t < 1) window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        const chart = $(".chart", entry.target);
        if (chart) chart.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

    $$(".reveal").forEach(function (el) { revealObserver.observe(el); });

    const countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        animateCount(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.4 });

    $$("[data-count]").forEach(function (el) { countObserver.observe(el); });
  } else {
    $$(".reveal").forEach(function (el) { el.classList.add("is-in"); });
    $$(".chart").forEach(function (el) { el.classList.add("is-in"); });
    $$("[data-count]").forEach(animateCount);
  }

  /* ---------------- boot ---------------- */
  renderCards();
  renderMap();
  updateVisibility();
  setView("list");
})();
