/* Wait For UR · 浏览器端 Supabase 接口层
 *
 * GitHub Pages 只能托管静态文件，跑不了原来的 api/ 后端。
 * 这里把 app.js 里所有 /api/* 请求在浏览器内接管，直接走 Supabase
 * （Auth + PostgREST + Storage），对外返回与旧后端一致的 JSON 形状。
 */
(() => {
  "use strict";

  const SUPABASE_URL = "https://qjzjtmseosowbzkjkudx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_-LqEivJr6aezgOZTdzyGyg_xu0vIbPH";
  const BUCKET = "photos";
  const DAY = 86400e3;

  if (!window.supabase) {
    console.error("[wfu] supabase-js 未加载，站点无法连接后端");
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "wfu-sb-auth"
    }
  });

  /* ---------------- 基础工具 ---------------- */
  const jsonRes = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });

  const fail = (status, message) => jsonRes({ ok: false, error: message }, status);
  const ok = (data = {}) => jsonRes({ ok: true, ...data });
  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const photoUrl = (key) =>
    `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${String(key).replace(/^photos\//, "")}`;

  const sbError = (e) => {
    const msg = (e && (e.message || e.error_description || e.error)) || "网络出了点小状况";
    throw new Error(String(msg).replace(/^.*?: /, ""));
  };

  /* ---------------- 当前用户 ---------------- */
  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session || null;
  }

  async function getMe() {
    const session = await getSession();
    if (!session) return null;
    const { data: prof, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prof) {
      const meta = session.user.user_metadata || {};
      return {
        id: session.user.id,
        email: session.user.email,
        nickname: meta.nickname || String(session.user.email || "").split("@")[0],
        admin: false,
        banned: false
      };
    }
    const { data: adm } = await sb.from("admins").select("email").eq("email", prof.email).maybeSingle();
    return {
      id: prof.id,
      email: prof.email,
      nickname: prof.nickname,
      admin: !!adm,
      banned: !!prof.banned
    };
  }

  async function requireMe(msg = "先登录") {
    const me = await getMe();
    if (!me) throw Object.assign(new Error(msg), { status: 401 });
    if (me.banned) throw Object.assign(new Error("该账号因发布不实信息已被永久封禁"), { status: 403 });
    return me;
  }

  const publicMe = (me) => (me ? { email: me.email, nickname: me.nickname, admin: !!me.admin } : null);

  /* ---------------- 序列化 ---------------- */
  function publicPet(row, loggedIn) {
    const keys = row.photo_keys || [];
    const now = Date.now();
    const days =
      row.status === "adopted"
        ? Math.max(0, Math.floor((now - (row.adopted_at || now)) / DAY))
        : Math.max(0, Math.floor((now - row.created_at) / DAY));
    return {
      id: row.id,
      source: row.source,
      ownerName: row.owner_name || "",
      name: row.name,
      species: row.species,
      age: row.age,
      sex: row.sex,
      neuter: row.neuter,
      vaccine: row.vaccine,
      city: row.city,
      coords: row.coords || null,
      label: row.label || null,
      tags: row.tags || [],
      quote: row.quote,
      alt: `${row.city || ""}的${row.name || ""}`,
      photo: keys[0] ? photoUrl(keys[0]) : null,
      photos: keys.map(photoUrl),
      _photoKeys: keys,
      flag: row.flag || null,
      status: row.status,
      stage: row.stage,
      days,
      contact: loggedIn ? row.contact || null : null
    };
  }

  function publicComment(c, me, likes, replies) {
    const mine = !!me && (me.id === c.author_id || me.admin);
    return {
      id: c.id,
      author: c.author_name,
      text: c.text,
      photos: (c.photo_keys || []).map(photoUrl),
      createdAt: c.created_at,
      likes: likes.filter((l) => l.comment_id === c.id).length,
      liked: !!me && likes.some((l) => l.comment_id === c.id && l.user_id === me.id),
      replies: replies
        .filter((r) => r.comment_id === c.id)
        .map((r) => ({
          id: r.id,
          author: r.author_name,
          text: r.text,
          createdAt: r.created_at,
          mine: !!me && (me.id === r.author_id || me.admin)
        })),
      mine
    };
  }

  const publicPost = (p, me) => ({
    id: p.id,
    author: p.author_name,
    text: p.text,
    photos: (p.photo_keys || []).map(photoUrl),
    createdAt: p.created_at,
    mine: !!me && (me.id === p.author_id || me.admin)
  });

  /* ---------------- 数据读取 ---------------- */
  async function allPets() {
    const { data, error } = await sb.from("pets").select("*");
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function commentCounts() {
    const { data, error } = await sb.from("comments").select("pet_id");
    if (error) throw new Error(error.message);
    const map = {};
    for (const row of data || []) map[row.pet_id] = (map[row.pet_id] || 0) + 1;
    return map;
  }

  async function loadComments(petId) {
    const { data: rows, error } = await sb
      .from("comments")
      .select("*")
      .eq("pet_id", petId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = (rows || []).map((r) => r.id);
    let likes = [];
    let replies = [];
    if (ids.length) {
      const r1 = await sb.from("comment_likes").select("comment_id,user_id").in("comment_id", ids);
      if (r1.error) throw new Error(r1.error.message);
      likes = r1.data || [];
      const r2 = await sb
        .from("replies")
        .select("*")
        .in("comment_id", ids)
        .order("created_at", { ascending: true });
      if (r2.error) throw new Error(r2.error.message);
      replies = r2.data || [];
    }
    return { rows: rows || [], likes, replies };
  }

  /* ---------------- 各接口实现 ---------------- */
  async function handleAuth(seg, method, payload) {
    if (method === "POST" && seg[1] === "send-code") {
      const email = text(payload && payload.email, 120).toLowerCase();
      if (!EMAIL_RE.test(email)) return fail(400, "邮箱格式不正确");
      const { data, error } = await sb.rpc("request_code", { p_email: email });
      if (error) return fail(500, error.message);
      if (data && data.ok === false) return fail(400, data.error || "验证码发送失败");
      return ok({ ok: true });
    }

    if (method === "POST" && seg[1] === "register") {
      const email = text(payload && payload.email, 120).toLowerCase();
      const nickname = text(payload && payload.nickname, 12);
      const password = String((payload && payload.password) || "");
      if (!EMAIL_RE.test(email)) return fail(400, "邮箱格式不正确");
      if (password.length < 8) return fail(400, "密码至少 8 位");
      if (!nickname) return fail(400, "给自己起个名字吧");
      if (!/^\d{6}$/.test(text(payload && payload.code, 6))) return fail(400, "填一下邮箱收到的 6 位验证码");

      const v = await sb.rpc("verify_code", { p_email: email, p_code: text(payload.code, 6) });
      if (v.error) return fail(500, v.error.message);
      if (!v.data || v.data.ok === false) {
        return fail(400, (v.data && v.data.error) || "验证码不正确");
      }

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { nickname } }
      });
      if (error) {
        if (/already registered|already exists/i.test(error.message)) {
          return fail(409, "这个邮箱已经注册过了，直接登录试试");
        }
        return fail(400, error.message);
      }
      if (!data.session) {
        if (data.user && (data.user.identities || []).length === 0) {
          return fail(409, "这个邮箱已经注册过了，直接登录试试");
        }
        const login = await sb.auth.signInWithPassword({ email, password });
        if (login.error) {
          return fail(400, "注册成功但还需要邮箱验证：请在 Supabase 后台关闭 Confirm email 后再试");
        }
      }
      const me = await getMe();
      return ok({ user: publicMe(me) });
    }

    if (method === "POST" && seg[1] === "login") {
      const email = text(payload && payload.email, 120).toLowerCase();
      const password = String((payload && payload.password) || "");
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (/invalid/i.test(error.message)) return fail(401, "邮箱或密码不对");
        return fail(401, error.message);
      }
      const me = await getMe();
      if (me && me.banned) {
        await sb.auth.signOut();
        return fail(403, "该账号因发布不实信息已被永久封禁");
      }
      return ok({ user: publicMe(me) });
    }

    if (method === "POST" && seg[1] === "logout") {
      await sb.auth.signOut();
      return ok();
    }

    if (method === "GET" && seg[1] === "me") {
      const me = await getMe();
      return ok({ user: publicMe(me) });
    }
    return fail(404, "接口不存在");
  }

  function validatePetInput(data) {
    const name = text(data.name, 8);
    const species = text(data.species, 10) || "猫咪";
    const age = text(data.age, 10);
    const sex = data.sex === "母" ? "母" : "公";
    const neuter = text(data.neuter, 10);
    const vaccine = text(data.vaccine, 16);
    const city = text(data.city, 10);
    const quote = text(data.quote, 40);
    const contact = text(data.contact, 40);
    const tags = Array.isArray(data.tags)
      ? [
          ...new Set(
            data.tags
              .filter((t) => typeof t === "string")
              .map((t) => t.trim().slice(0, 6))
              .filter(Boolean)
          )
        ].slice(0, 3)
      : [];
    const photoKeys = Array.isArray(data.photoKeys)
      ? data.photoKeys.filter((k) => typeof k === "string").slice(0, 3)
      : [];
    if (!name) return { error: "给猫咪写个名字吧" };
    if (!age) return { error: "写一下它多大啦" };
    if (!city) return { error: "写一下它在哪座城市" };
    if (!quote) return { error: "替它写一句自我介绍吧" };
    if (!contact) return { error: "留个联系方式，意向人才找得到你" };
    if (!tags.length) return { error: "至少选一个性格标签" };
    if (!photoKeys.length) return { error: "至少上传一张照片" };
    return { name, species, age, sex, neuter, vaccine, city, quote, contact, tags, photoKeys };
  }

  async function handlePets(path, seg, method, payload, url) {
    /* 列表 */
    if (!seg[1] && method === "GET") {
      const area = url.searchParams.get("area") || "official";
      const me = await getMe();
      const pets = await allPets();
      let list;
      if (area === "adopted") list = pets.filter((p) => p.status === "adopted");
      else if (area === "user") list = pets.filter((p) => p.source === "user" && p.status === "approved");
      else list = pets.filter((p) => p.source === "official" && p.status === "approved");
      list.sort((a, b) => a.created_at - b.created_at);
      const counts = await commentCounts();
      return ok({
        pets: list.map((p) => ({ ...publicPet(p, !!me), commentCount: counts[p.id] || 0 }))
      });
    }

    /* 发布 */
    if (!seg[1] && method === "POST") {
      const me = await requireMe("先登录，再发布");
      const id = text(payload && payload.id, 48);
      if (!ID_RE.test(id)) return fail(400, "编号格式不正确");
      const v = validatePetInput(payload || {});
      if (v.error) return fail(400, v.error);
      if (!v.photoKeys.every((k) => k.startsWith(`photos/${id}-`))) return fail(400, "照片与信息不匹配");
      const dup = await sb.from("pets").select("id").eq("id", id).maybeSingle();
      if (dup.data) return fail(409, "编号被占用了，刷新后再试");
      const now = Date.now();
      const { error } = await sb.from("pets").insert({
        id,
        source: "user",
        owner_id: me.id,
        owner_email: me.email,
        owner_name: me.nickname,
        name: v.name,
        species: v.species,
        age: v.age,
        sex: v.sex,
        neuter: v.neuter || "未知",
        vaccine: v.vaccine || "未知",
        city: v.city,
        quote: v.quote,
        contact: v.contact,
        tags: v.tags,
        photo_keys: v.photoKeys,
        status: "pending",
        stage: "waiting",
        created_at: now
      });
      if (error) return fail(400, error.message);
      return ok({ id });
    }

    /* 单只：PATCH / DELETE */
    if (seg[1] && method === "PATCH") {
      const me = await requireMe("先登录");
      const id = seg[1];
      const { data: pet, error } = await sb.from("pets").select("*").eq("id", id).maybeSingle();
      if (error) return fail(500, error.message);
      if (!pet) return fail(404, "没有找到这只猫咪");
      if (pet.owner_id !== me.id && !me.admin) return fail(403, "只能操作自己发布的猫咪");

      if (payload && payload.action === "adopt") {
        if (pet.status !== "approved") return fail(400, "只有展示中的猫咪才能标记回家");
        const { error: e2 } = await sb
          .from("pets")
          .update({ status: "adopted", adopted_at: Date.now() })
          .eq("id", id);
        if (e2) return fail(400, e2.message);
        return ok();
      }

      if (pet.status !== "pending") return fail(400, "只有待审核的信息可以修改");
      const merged = { ...pet, ...(payload || {}), photoKeys: (payload && payload.photoKeys) || pet.photo_keys };
      const v = validatePetInput(merged);
      if (v.error) return fail(400, v.error);
      if (!v.photoKeys.every((k) => k.startsWith(`photos/${id}-`))) return fail(400, "照片与信息不匹配");
      const oldKeys = pet.photo_keys || [];
      const { error: e3 } = await sb
        .from("pets")
        .update({
          name: v.name,
          species: v.species,
          age: v.age,
          sex: v.sex,
          neuter: v.neuter,
          vaccine: v.vaccine,
          city: v.city,
          quote: v.quote,
          contact: v.contact,
          tags: v.tags,
          photo_keys: v.photoKeys,
          status: "pending",
          reject_reason: null
        })
        .eq("id", id);
      if (e3) return fail(400, e3.message);
      const gone = oldKeys.filter((k) => !v.photoKeys.includes(k));
      if (gone.length) await sb.storage.from(BUCKET).remove(gone.map((k) => k.replace(/^photos\//, "")));
      return ok();
    }

    if (seg[1] && method === "DELETE") {
      const me = await requireMe("先登录");
      const id = seg[1];
      const { data: pet } = await sb.from("pets").select("*").eq("id", id).maybeSingle();
      if (!pet) return fail(404, "没有找到这只猫咪");
      if (pet.owner_id !== me.id && !me.admin) return fail(403, "只能删除自己发布的猫咪");
      if (pet.source === "official") return fail(403, "官方数据不能删除");
      const { error } = await sb.from("pets").delete().eq("id", id);
      if (error) return fail(400, error.message);
      if ((pet.photo_keys || []).length) {
        await sb.storage.from(BUCKET).remove(pet.photo_keys.map((k) => k.replace(/^photos\//, "")));
      }
      return ok();
    }

    return fail(404, "接口不存在");
  }

  async function handleComments(seg, method, payload) {
    const petId = seg[1];
    const cid = seg[3];

    if (method === "GET" && !cid) {
      const { rows, likes, replies } = await loadComments(petId);
      const me = await getMe();
      return ok({ comments: rows.map((c) => publicComment(c, me, likes, replies)) });
    }

    if (method === "POST" && !cid) {
      const me = await requireMe("先登录，再留言");
      const id = text(payload && payload.id, 48);
      if (!ID_RE.test(id)) return fail(400, "参数不正确");
      const content = text(payload && payload.text, 120);
      const photoKeys = Array.isArray(payload && payload.photoKeys)
        ? payload.photoKeys.filter((k) => typeof k === "string").slice(0, 3)
        : [];
      if (!content && !photoKeys.length) return fail(400, "写点什么，或者发张图片");
      if (!photoKeys.every((k) => k.startsWith(`photos/c-${id}-`))) return fail(400, "图片与留言不匹配");
      const { error } = await sb.from("comments").insert({
        id,
        pet_id: petId,
        author_id: me.id,
        author_email: me.email,
        author_name: me.nickname,
        text: content,
        photo_keys: photoKeys,
        created_at: Date.now()
      });
      if (error) {
        if (/duplicate|unique/i.test(error.message)) return fail(409, "请重新提交一次");
        return fail(400, error.message);
      }
      const c = {
        id,
        pet_id: petId,
        author_id: me.id,
        author_email: me.email,
        author_name: me.nickname,
        text: content,
        photo_keys: photoKeys,
        created_at: Date.now()
      };
      return ok({ comment: publicComment(c, me, [], []) });
    }

    if (method === "DELETE" && cid && !seg[4]) {
      const me = await requireMe("先登录");
      const { data: c } = await sb.from("comments").select("*").eq("id", cid).maybeSingle();
      if (!c) return fail(404, "留言不存在");
      if (c.author_id !== me.id && !me.admin) return fail(403, "只能删除自己的留言");
      const { error } = await sb.from("comments").delete().eq("id", cid);
      if (error) return fail(400, error.message);
      if ((c.photo_keys || []).length) {
        await sb.storage.from(BUCKET).remove(c.photo_keys.map((k) => k.replace(/^photos\//, "")));
      }
      return ok();
    }

    if (cid && seg[4] === "like") {
      const me = await requireMe("先登录，再点赞");
      if (method === "POST") {
        const { error } = await sb.from("comment_likes").insert({ comment_id: cid, user_id: me.id });
        if (error && !/duplicate|unique/i.test(error.message)) return fail(400, error.message);
      } else if (method === "DELETE") {
        const { error } = await sb
          .from("comment_likes")
          .delete()
          .eq("comment_id", cid)
          .eq("user_id", me.id);
        if (error) return fail(400, error.message);
      } else return fail(404, "接口不存在");
      const { data } = await sb.from("comment_likes").select("comment_id").eq("comment_id", cid);
      return ok({ likes: (data || []).length, liked: method === "POST" });
    }

    if (method === "POST" && cid && seg[4] === "replies") {
      const me = await requireMe("先登录，再回复");
      const rid = text(payload && payload.id, 48);
      if (!ID_RE.test(rid)) return fail(400, "参数不正确");
      const content = text(payload && payload.text, 120);
      if (!content) return fail(400, "写点什么再回复");
      const { count } = await sb
        .from("replies")
        .select("*", { count: "exact", head: true })
        .eq("comment_id", cid);
      if ((count || 0) >= 50) return fail(400, "这条留言的回复已经满了");
      const { error } = await sb.from("replies").insert({
        id: rid,
        comment_id: cid,
        author_id: me.id,
        author_email: me.email,
        author_name: me.nickname,
        text: content,
        created_at: Date.now()
      });
      if (error) return fail(400, error.message);
      return ok({
        reply: { id: rid, author: me.nickname, text: content, createdAt: Date.now(), mine: true }
      });
    }

    return fail(404, "接口不存在");
  }

  async function handleApplications(seg, method, payload) {
    const petId = seg[1];
    const aid = seg[3];

    if (method === "POST" && !aid) {
      const me = await requireMe("先登录，再申请领养");
      const { data: pet } = await sb.from("pets").select("*").eq("id", petId).maybeSingle();
      if (!pet || pet.status !== "approved") return fail(404, "这只猫咪暂时不能申请领养");
      if (pet.owner_id === me.id) return fail(400, "不能申请自己发布的猫咪");
      const id = text(payload && payload.id, 48);
      if (!ID_RE.test(id)) return fail(400, "参数不正确");
      const intro = text(payload && payload.intro, 200);
      const housing = text(payload && payload.housing, 60);
      const contact = text(payload && payload.contact, 40);
      if (intro.length < 8) return fail(400, "简单介绍一下自己和照顾计划（至少 8 个字）");
      if (!contact) return fail(400, "留个联系方式，方便对方联系你");
      const dup = await sb
        .from("applications")
        .select("id,status")
        .eq("pet_id", petId)
        .eq("from_id", me.id)
        .neq("status", "closed");
      if ((dup.data || []).length) return fail(409, "你已经申请过这只猫咪了，等对方联系你吧");
      const now = Date.now();
      const { error } = await sb.from("applications").insert({
        id,
        pet_id: petId,
        pet_name: pet.name,
        to_email: pet.owner_email,
        from_id: me.id,
        from_email: me.email,
        from_name: me.nickname,
        intro,
        housing,
        contact,
        status: "pending",
        created_at: now
      });
      if (error) return fail(400, error.message);
      return ok({ id });
    }

    if (method === "GET" && !aid) {
      const me = await requireMe("先登录");
      const { data: pet } = await sb.from("pets").select("*").eq("id", petId).maybeSingle();
      if (!pet) return fail(404, "没有找到这只猫咪");
      if (pet.owner_id !== me.id && !me.admin) return fail(403, "只有发布者能查看申请");
      const { data, error } = await sb
        .from("applications")
        .select("*")
        .eq("pet_id", petId)
        .order("created_at", { ascending: false });
      if (error) return fail(400, error.message);
      return ok({ applications: data || [] });
    }

    if (method === "PATCH" && aid) {
      const me = await requireMe("先登录");
      const { data: a } = await sb.from("applications").select("*").eq("id", aid).maybeSingle();
      if (!a) return fail(404, "没有找到这条申请");
      const { data: pet } = await sb.from("pets").select("*").eq("id", petId).maybeSingle();
      if ((!pet || pet.owner_id !== me.id) && !me.admin) return fail(403, "只有发布者能处理申请");
      const status = payload && payload.status;
      if (!["pending", "contacted", "closed"].includes(status)) return fail(400, "未知状态");
      const { error } = await sb
        .from("applications")
        .update({ status, updated_at: Date.now() })
        .eq("id", aid);
      if (error) return fail(400, error.message);
      return ok({ status });
    }

    return fail(404, "接口不存在");
  }

  async function handleFavorites(seg, method) {
    const me = await requireMe("先登录，再收藏");
    const petId = seg[1];
    if (method === "POST") {
      const { data: pet } = await sb.from("pets").select("id,status").eq("id", petId).maybeSingle();
      if (!pet || !["approved", "adopted"].includes(pet.status)) return fail(404, "没有找到这只猫咪");
      const { error } = await sb.from("favorites").upsert({ user_id: me.id, pet_id: petId, created_at: Date.now() });
      if (error) return fail(400, error.message);
      return ok();
    }
    if (method === "DELETE") {
      const { error } = await sb.from("favorites").delete().eq("user_id", me.id).eq("pet_id", petId);
      if (error) return fail(400, error.message);
      return ok();
    }
    return fail(404, "接口不存在");
  }

  async function handleMy(seg, method) {
    const me = await requireMe("先登录");

    if (method === "GET" && seg[1] === "favorites") {
      const { data: favs } = await sb.from("favorites").select("pet_id").eq("user_id", me.id);
      const ids = (favs || []).map((f) => f.pet_id);
      let pets = [];
      if (ids.length) {
        const { data } = await sb.from("pets").select("*").in("id", ids);
        pets = data || [];
      }
      const out = pets
        .filter((p) => p.status === "approved" || p.status === "adopted")
        .map((p) => publicPet(p, true));
      return ok({ pets: out, ids: out.map((p) => p.id) });
    }

    if (method === "GET" && seg[1] === "pets") {
      const { data, error } = await sb
        .from("pets")
        .select("*")
        .eq("owner_id", me.id)
        .order("created_at", { ascending: false });
      if (error) return fail(400, error.message);
      return ok({
        pets: (data || []).map((p) => ({ ...publicPet(p, true), rejectReason: p.reject_reason }))
      });
    }

    if (method === "GET" && seg[1] === "applications") {
      const { data, error } = await sb
        .from("applications")
        .select("*")
        .eq("to_email", me.email)
        .order("created_at", { ascending: false });
      if (error) return fail(400, error.message);
      const out = (data || []).map((a) => ({
        id: a.id,
        petId: a.pet_id,
        petName: a.pet_name,
        toEmail: a.to_email,
        fromEmail: a.from_email,
        fromName: a.from_name,
        intro: a.intro,
        housing: a.housing,
        contact: a.contact,
        status: a.status,
        createdAt: a.created_at
      }));
      return ok({ applications: out });
    }

    if (method === "GET" && seg[1] === "comments") {
      const { data: rows, error } = await sb
        .from("comments")
        .select("*")
        .eq("author_id", me.id)
        .order("created_at", { ascending: false });
      if (error) return fail(400, error.message);
      const petIds = [...new Set((rows || []).map((c) => c.pet_id))];
      let pets = [];
      if (petIds.length) {
        const { data } = await sb.from("pets").select("id,name,photo_keys").in("id", petIds);
        pets = data || [];
      }
      const petMap = new Map(pets.map((p) => [p.id, p]));
      const ids = (rows || []).map((c) => c.id);
      let likes = [];
      let replies = [];
      if (ids.length) {
        const r1 = await sb.from("comment_likes").select("comment_id,user_id").in("comment_id", ids);
        likes = r1.data || [];
        const r2 = await sb.from("replies").select("*").in("comment_id", ids).order("created_at", { ascending: true });
        replies = r2.data || [];
      }
      const out = (rows || []).map((c) => {
        const pet = petMap.get(c.pet_id);
        return {
          ...publicComment(c, me, likes, replies),
          petId: c.pet_id,
          petName: pet ? pet.name : "已下架",
          petPhoto: pet && pet.photo_keys && pet.photo_keys[0] ? photoUrl(pet.photo_keys[0]) : null
        };
      });
      return ok({ comments: out });
    }

    if (method === "GET" && seg[1] === "inbox") {
      const { data: pets } = await sb.from("pets").select("*").eq("owner_id", me.id);
      const mine = pets || [];
      const petIds = mine.map((p) => p.id);
      let comments = [];
      let apps = [];
      if (petIds.length) {
        const r1 = await sb.from("comments").select("*").in("pet_id", petIds);
        comments = r1.data || [];
        const r2 = await sb.from("applications").select("*").in("pet_id", petIds);
        apps = r2.data || [];
      }
      const items = [];
      for (const p of mine) {
        for (const c of comments.filter((x) => x.pet_id === p.id)) {
          items.push({
            type: "comment",
            id: c.id,
            petId: p.id,
            petName: p.name,
            author: c.author_name,
            text: c.text,
            photos: (c.photo_keys || []).map(photoUrl),
            at: c.created_at
          });
        }
        for (const a of apps.filter((x) => x.pet_id === p.id)) {
          items.push({
            type: "application",
            id: a.id,
            petId: p.id,
            petName: p.name,
            author: a.from_name,
            text: a.intro,
            housing: a.housing,
            contact: a.contact,
            status: a.status,
            at: a.created_at
          });
        }
      }
      items.sort((a, b) => b.at - a.at);
      return ok({ items });
    }

    return fail(404, "接口不存在");
  }

  async function handlePosts(seg, method, payload) {
    if (method === "GET" && !seg[1]) {
      const me = await getMe();
      const { data, error } = await sb.from("posts").select("*").order("created_at", { ascending: false });
      if (error) return fail(400, error.message);
      return ok({ posts: (data || []).map((p) => publicPost(p, me)) });
    }
    if (method === "POST" && !seg[1]) {
      const me = await requireMe("先登录，再晒图");
      const id = text(payload && payload.id, 48);
      if (!ID_RE.test(id)) return fail(400, "参数不正确");
      const content = text(payload && payload.text, 300);
      const photoKeys = Array.isArray(payload && payload.photoKeys)
        ? payload.photoKeys.filter((k) => typeof k === "string").slice(0, 3)
        : [];
      if (!content && !photoKeys.length) return fail(400, "写一句话，或者发一张图");
      if (!photoKeys.every((k) => k.startsWith(`photos/w-${id}-`))) return fail(400, "图片与内容不匹配");
      const now = Date.now();
      const { error } = await sb.from("posts").insert({
        id,
        author_id: me.id,
        author_email: me.email,
        author_name: me.nickname,
        text: content,
        photo_keys: photoKeys,
        created_at: now
      });
      if (error) {
        if (/duplicate|unique/i.test(error.message)) return fail(409, "请重新提交一次");
        return fail(400, error.message);
      }
      const post = {
        id,
        author_id: me.id,
        author_name: me.nickname,
        text: content,
        photo_keys: photoKeys,
        created_at: now
      };
      return ok({ post: publicPost(post, me) });
    }
    if (method === "DELETE" && seg[1]) {
      const me = await requireMe("先登录");
      const { data: p } = await sb.from("posts").select("*").eq("id", seg[1]).maybeSingle();
      if (!p) return fail(404, "这条动态不存在");
      if (p.author_id !== me.id && !me.admin) return fail(403, "只能删除自己发布的内容");
      const { error } = await sb.from("posts").delete().eq("id", seg[1]);
      if (error) return fail(400, error.message);
      if ((p.photo_keys || []).length) {
        await sb.storage.from(BUCKET).remove(p.photo_keys.map((k) => k.replace(/^photos\//, "")));
      }
      return ok();
    }
    return fail(404, "接口不存在");
  }

  async function handleStats() {
    const pets = await allPets();
    const active = pets.filter((p) => p.status === "approved" || p.status === "adopted");
    const waiting = active.filter((p) => p.status === "approved");
    const adopted = active.filter((p) => p.status === "adopted");
    const now = Date.now();
    const avgWaitDays = waiting.length
      ? Math.round(
          waiting.reduce((sum, p) => sum + Math.max(0, Math.floor((now - p.created_at) / DAY)), 0) /
            waiting.length
        )
      : 0;

    const months = [];
    const base = new Date();
    for (let i = 11; i >= 0; i--) {
      const start = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      const list = adopted.filter(
        (p) => p.adopted_at && p.adopted_at >= start.getTime() && p.adopted_at < end.getTime()
      );
      months.push({
        label: `${start.getFullYear()}.${start.getMonth() + 1}`,
        month: start.getMonth() + 1,
        count: list.length
      });
    }

    const total = active.length;
    const rate = total ? Math.round((adopted.length / total) * 100) : 0;
    const featured = waiting.length ? publicPet(waiting[Math.floor(Math.random() * waiting.length)], false) : null;

    return ok({
      waiting: waiting.length,
      adopted: adopted.length,
      cities: new Set(active.map((p) => p.city)).size,
      avgWaitDays,
      months,
      rate,
      total,
      featured,
      feed: active
        .slice()
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 8)
        .map((p) => ({
          id: p.id,
          name: p.name,
          city: p.city,
          status: p.status,
          stage: p.stage,
          days: publicPet(p, false).days
        }))
    });
  }

  async function handleAdmin(seg, method, payload) {
    const me = await requireMe("先登录");
    if (!me.admin) return fail(403, "这里只有审核员能进");

    if (method === "GET" && seg[1] === "pending") {
      const { data, error } = await sb.from("pets").select("*").eq("status", "pending");
      if (error) return fail(400, error.message);
      const list = (data || []).sort((a, b) => a.created_at - b.created_at);
      return ok({
        pets: list.map((p) => ({ ...publicPet(p, true), ownerEmail: p.owner_email }))
      });
    }

    if (method === "POST" && seg[1] === "review") {
      const id = text(payload && payload.id, 48);
      const { data: pet } = await sb.from("pets").select("*").eq("id", id).maybeSingle();
      if (!pet) return fail(404, "没有找到这只猫咪");
      if (pet.status !== "pending") return fail(400, "这条信息已经审核过了");
      if (payload.action === "approve") {
        const { data: owner } = await sb.from("profiles").select("*").eq("email", pet.owner_email).maybeSingle();
        if (owner && owner.banned) return fail(400, "发布者已被封禁，不能通过");
        const { error } = await sb
          .from("pets")
          .update({ status: "approved", reject_reason: null })
          .eq("id", id);
        if (error) return fail(400, error.message);
        return ok();
      }
      if (payload.action === "reject") {
        const reason = text(payload.reason, 60) || "信息不完整，请补充后再提交";
        const { error } = await sb
          .from("pets")
          .update({ status: "rejected", reject_reason: reason })
          .eq("id", id);
        if (error) return fail(400, error.message);
        return ok();
      }
      return fail(400, "未知操作");
    }

    if (method === "POST" && seg[1] === "ban") {
      const email = text(payload && payload.email, 120).toLowerCase();
      if (email === me.email) return fail(400, "不能封禁自己");
      const { data: user } = await sb.from("profiles").select("*").eq("email", email).maybeSingle();
      if (!user) return fail(404, "没有找到这个账号");
      const { error } = await sb.from("profiles").update({ banned: true }).eq("email", email);
      if (error) return fail(400, error.message);
      const { data: pets } = await sb.from("pets").select("id,status").eq("owner_email", email);
      for (const p of pets || []) {
        if (p.status !== "rejected") {
          await sb
            .from("pets")
            .update({ status: "rejected", reject_reason: "账号因不实信息被永久封禁" })
            .eq("id", p.id);
        }
      }
      return ok();
    }

    return fail(404, "接口不存在");
  }

  async function handleUploadTicket(payload) {
    await requireMe("先登录");
    const n = Number(payload && payload.n);
    let key;
    if (payload && (payload.scope === "comment" || payload.scope === "post")) {
      const id = text(payload.id, 48);
      if (!ID_RE.test(id) || !(n >= 0 && n <= 2)) return fail(400, "参数不正确");
      key = `photos/${payload.scope === "comment" ? "c" : "w"}-${id}-${n}`;
    } else {
      const petId = text(payload && payload.petId, 48);
      if (!ID_RE.test(petId) || !(n >= 0 && n <= 2)) return fail(400, "参数不正确");
      key = `photos/${petId}-${n}`;
    }
    const path = key.replace(/^photos\//, "");
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return fail(400, error.message);
    let signed = data.signedUrl;
    if (!/^https?:/i.test(signed)) signed = `${SUPABASE_URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
    return ok({ key, url: signed, expiresAt: Date.now() + 3600e3 });
  }

  /* ---------------- 路由 ---------------- */
  async function route(path, method, payload, url) {
    const seg = path.split("/").filter(Boolean);

    if (seg[0] === "health") return ok({ plain: true });
    if (seg[0] === "auth") return handleAuth(seg, method, payload);
    if (seg[0] === "stats" && method === "GET") return handleStats();
    if (seg[0] === "upload-ticket" && method === "POST") return handleUploadTicket(payload);
    if (seg[0] === "photos") {
      const key = seg.slice(1).join("/");
      return Response.redirect(photoUrl(decodeURIComponent(key)), 302);
    }
    if (seg[0] === "posts") return handlePosts(seg, method, payload);
    if (seg[0] === "favorites" && seg[1]) return handleFavorites(seg, method);
    if (seg[0] === "my") return handleMy(seg, method);
    if (seg[0] === "admin") return handleAdmin(seg, method, payload);
    if (seg[0] === "pets" && seg[1] && seg[2] === "comments") return handleComments(seg, method, payload);
    if (seg[0] === "pets" && seg[1] && seg[2] === "applications") return handleApplications(seg, method, payload);
    if (seg[0] === "pets") return handlePets(path, seg, method, payload, url);

    return fail(404, "接口不存在");
  }

  /* ---------------- fetch 接管 ---------------- */
  const realFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    let url = null;
    try {
      url = new URL(typeof input === "string" ? input : input.url, location.href);
    } catch {
      return realFetch(input, init);
    }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      return realFetch(input, init);
    }

    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    let payload = null;
    if (init && init.body) {
      try {
        payload = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      } catch {
        payload = null;
      }
    }

    try {
      return await route(path, method, payload, url);
    } catch (e) {
      console.warn("[wfu api]", path, e && e.message);
      const status = (e && e.status) || 500;
      return fail(status, (e && e.message) || "服务器出了点小状况，稍后再试");
    }
  };

  window.SupaApi = { sb, photoUrl };
})();
