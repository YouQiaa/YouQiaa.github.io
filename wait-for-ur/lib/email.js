/* 邮件发送：优先 Brevo，其次 Resend；都没配置时返回 null（调用方走测试模式，验证码直接回显）。
   环境变量：
   - BREVO_API_KEY + MAIL_FROM（Brevo 账号里验证过的发件邮箱，免费版每天 300 封，无需域名）
   - 或 RESEND_API_KEY（+ MAIL_FROM 可选；默认 onboarding@resend.dev 只能发给自己的注册邮箱） */

function mailHtml(code) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#fff8f2;font-family:'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #ffe0d6;">
    <p style="margin:0 0 4px;font-size:13px;color:#b3867a;">Wait For UR · 等一个家</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#2b2b2b;">你正在注册新账号 🐾</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#555;">验证码（10 分钟内有效）：</p>
    <p style="margin:0 0 16px;font-size:34px;font-weight:800;letter-spacing:8px;color:#ff6b5e;">${code}</p>
    <p style="margin:0;font-size:12px;color:#999;line-height:1.7;">如果这不是你的操作，忽略这封邮件即可。<br>每一只猫咪，都值得一个家。</p>
  </div>
</body></html>`;
}

export async function sendVerifyMail(to, code) {
  const subject = `【等一个家】你的验证码：${code}`;
  const html = mailHtml(code);

  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    const from = process.env.MAIL_FROM;
    if (!from) throw new Error("配置了 BREVO_API_KEY 但缺少 MAIL_FROM（发件邮箱）");
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevoKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: "等一个家 Wait For UR" },
        to: [{ email: to }],
        subject,
        htmlContent: html
      })
    });
    if (!r.ok) throw new Error(`brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return "brevo";
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = process.env.MAIL_FROM || "等一个家 <onboarding@resend.dev>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return "resend";
  }

  return null;
}
