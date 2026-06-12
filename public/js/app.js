const I18N = {
  ar: {
    hero_title: "رقم هاتف مؤقت — استقبل رسائل SMS حقيقية",
    hero_sub:
      "احصل على رقم لمدة ١٠ دقائق لاستقبال رموز التحقق عند التسجيل في المواقع. بدون حساب، بدون تسجيل.",
    get_number: "احصل على رقم الآن",
    voip_note:
      "ملاحظة: بعض المواقع الكبيرة (مثل واتساب وجوجل) قد ترفض الأرقام الافتراضية.",
    copy: "نسخ",
    copied: "تم النسخ ✓",
    extend: "+١٠ دقائق",
    inbox: "الرسائل الواردة",
    waiting:
      "في انتظار الرسائل… استخدم الرقم أعلاه في أي موقع وستظهر الرسالة هنا خلال ثوانٍ.",
    expired_title: "انتهت صلاحية الرقم",
    get_another: "احصل على رقم جديد",
    credit: "برمجة",
    rate_limited: "وصلت للحد الأقصى — حاول بعد ساعة",
    no_numbers: "لا توجد أرقام متاحة حالياً",
  },
  en: {
    hero_title: "Temporary phone number — receive real SMS",
    hero_sub:
      "Get a number for 10 minutes to receive verification codes when signing up anywhere. No account, no registration.",
    get_number: "Get a number now",
    voip_note:
      "Note: some major sites (WhatsApp, Google) may reject virtual numbers.",
    copy: "Copy",
    copied: "Copied ✓",
    extend: "+10 min",
    inbox: "Incoming messages",
    waiting:
      "Waiting for messages… use the number above on any site and the SMS will appear here within seconds.",
    expired_title: "This number has expired",
    get_another: "Get a new number",
    credit: "Programmed by",
    rate_limited: "Hourly limit reached — try again later",
    no_numbers: "No numbers available right now",
  },
};
let lang = localStorage.getItem("lang") || "ar";

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.getElementById("langBtn").textContent =
    lang === "ar" ? "EN" : "عربي";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.dataset.i18n;
    if (I18N[lang][k]) el.textContent = I18N[lang][k];
  });
}
document.getElementById("langBtn").onclick = () => {
  lang = lang === "ar" ? "en" : "ar";
  localStorage.setItem("lang", lang);
  applyLang();
};

const $ = (id) => document.getElementById(id);
let token = localStorage.getItem("session_token");
let expiresAt = 0;
let pollId = null,
  tickId = null;

function show(view) {
  ["landing", "session", "expired"].forEach((v) =>
    $(v).classList.toggle("hidden", v !== view),
  );
}

async function getNumber() {
  $("getBtn").disabled = true;
  try {
    const r = await fetch("/api/session", { method: "POST" });
    const d = await r.json();
    if (!r.ok) {
      alert(I18N[lang][d.error] || d.error);
      return;
    }
    token = d.token;
    localStorage.setItem("session_token", token);
    await openSession();
  } finally {
    $("getBtn").disabled = false;
  }
}

async function openSession() {
  const r = await fetch(`/api/session/${token}`);
  if (!r.ok) {
    localStorage.removeItem("session_token");
    token = null;
    show("landing");
    return;
  }
  const d = await r.json();
  expiresAt = d.expires_at;
  $("number").textContent = formatNum(d.number);
  $("number").dataset.raw = d.number;
  $("flag").textContent = d.country === "US" ? "🇺🇸" : "🌍";
  show("session");
  clearInterval(pollId);
  clearInterval(tickId);
  pollId = setInterval(poll, 3000);
  tickId = setInterval(tick, 250);
  poll();
  tick();
}

function formatNum(e164) {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}

function tick() {
  const left = expiresAt - Date.now();
  if (left <= 0) {
    clearInterval(pollId);
    clearInterval(tickId);
    localStorage.removeItem("session_token");
    token = null;
    show("expired");
    return;
  }
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  $("timer").textContent = `${mm}:${ss}`;
  $("timer").classList.toggle("low", left < 60000);
}

async function poll() {
  if (!token) return;
  const r = await fetch(`/api/session/${token}/messages`);
  if (!r.ok) return;
  const { messages } = await r.json();
  $("waiting").classList.toggle("hidden", messages.length > 0);
  $("messages").innerHTML = messages
    .map(
      (m) => `<div class="msg">
        <div class="from">${esc(m.from_e164)} · ${new Date(m.received_at).toLocaleTimeString()}</div>
        ${
          m.otp
            ? `<div class="otp-row"><span class="otp">${esc(m.otp)}</span>
          <button class="btn-copy" onclick="copyText('${esc(m.otp)}',this)">${I18N[lang].copy}</button></div>`
            : ""
        }
        <div class="body">${esc(m.body)}</div>
      </div>`,
    )
    .join("");
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

window.copyText = (text, btn) => {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = I18N[lang].copied;
    setTimeout(() => (btn.textContent = old), 1200);
  });
};

$("getBtn").onclick = getNumber;
$("againBtn").onclick = getNumber;
$("copyNum").onclick = () => copyText($("number").dataset.raw, $("copyNum"));
$("extendBtn").onclick = async () => {
  const r = await fetch(`/api/session/${token}/extend`, { method: "POST" });
  if (r.ok) expiresAt = (await r.json()).expires_at;
};

applyLang();
if (token) openSession();
else show("landing");
