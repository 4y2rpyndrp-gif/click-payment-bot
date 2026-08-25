// Germaniya viza testi — to'liq backend (to'liq avtomatik, admin kerak emas).
// 1) Telegram guruhdagi Click bildirishnomalarini o'qib, to'lovni avtomatik tasdiqlaydi
//    (faqat aynan 412 000 so'm va undan yuqori summa "to'landi" deb hisoblanadi —
//    Click sahifasida ko'rsatilgan summaga emas, guruhga kelgan HAQIQIY tasdiqlangan
//    summaga ishoniladi, shuning uchun buni chetlab o'tib bo'lmaydi)
// 2) Test sahifasi (istalgan joyda joylashtirilgan — Netlify, va h.k.) uchun
//    oferta rozilik va test natijalarini saqlaydi
// 3) Har bir TO'LOV QILGAN mijoz uchun (ism, telefon, oferta roziligi, to'lov,
//    keyin test natijasi) yuridik hisobot guruhiga avtomatik xabar yuboradi

const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// ==== SOZLAMALAR ====
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'PUT_YOUR_BOT_TOKEN_HERE';
const ALLOWED_CHAT_ID = process.env.CLICK_GROUP_CHAT_ID || ''; // Click bildirishnomalari guruhi
const LEGAL_GROUP_CHAT_ID = process.env.LEGAL_GROUP_CHAT_ID || ''; // Yuridik hisobot guruhi
const EXPECTED_AMOUNT = 412000; // so'mda, test narxi — bundan kam to'lov hech qachon qabul qilinmaydi

// ---- Oddiy fayl-baza yordamchilari ----
function dbPath(name) { return path.join(__dirname, name + '.json'); }
function loadJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dbPath(name), 'utf8')); }
  catch (e) { return fallback; }
}
function saveJson(name, data) {
  fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2));
}

// payments: { "<phoneDigits>": { status:'paid', amount, paidAt } }
function loadPayments() { return loadJson('payments', {}); }
function savePayments(db) { saveJson('payments', db); }

// consents: [ {name, phone, timestamp} ]
function loadConsents() { return loadJson('consents', []); }
function saveConsents(list) { saveJson('consents', list); }

// submissions: [ {name, phone, direction, sector, specialty, lang, prof, passed, timestamp} ]
function loadSubmissions() { return loadJson('submissions', []); }
function saveSubmissions(list) { saveJson('submissions', list); }

function digits(s) { return (s || '').replace(/[^0-9]/g, ''); }

function findLatestConsent(phoneDigits) {
  const list = loadConsents();
  const matches = list.filter(c => digits(c.phone) === phoneDigits);
  return matches.length ? matches[matches.length - 1] : null;
}

// ---- Telegram bot ----
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.on('polling_error', (err) => console.error('TELEGRAM POLLING ERROR:', err.code, err.message));
bot.getMe().then(me => console.log('BOT ULANDI:', me.username)).catch(err => console.error('BOT TOKEN XATOLIGI:', err.message));

function sendLegalNotice(text) {
  if (!LEGAL_GROUP_CHAT_ID) { console.log('LEGAL_GROUP_CHAT_ID sozlanmagan, xabar yuborilmadi.'); return; }
  bot.sendMessage(LEGAL_GROUP_CHAT_ID, text).catch(err => console.error('Legal guruhga yuborishda xatolik:', err.message));
}

function notifyPaymentConfirmed(phoneDigits, amount) {
  const consent = findLatestConsent(phoneDigits);
  const lines = [
    '🧾 YANGI TO\'LOV TASDIQLANDI',
    '',
    `Ism: ${consent ? consent.name : '(oferta yozuvi topilmadi)'}`,
    `Telefon: +${phoneDigits}`,
    `Summa: ${amount.toLocaleString()} so'm`,
    consent ? `Oferta roziligi: ${new Date(consent.timestamp).toLocaleString('uz-UZ')} da tasdiqlangan` : 'Oferta roziligi: TOPILMADI (tekshiring)',
    `To'lov vaqti: ${new Date().toLocaleString('uz-UZ')}`,
  ];
  sendLegalNotice(lines.join('\n'));
}

function notifySubmission(record) {
  const lines = [
    '📋 TEST NATIJASI',
    '',
    `Ism: ${record.name}`,
    `Telefon: ${record.phone}`,
    `Yo'nalish: ${record.direction === 'rus' ? 'Rus tili' : 'Nemis tili'}`,
    `Soha: ${record.sector} — ${record.specialty}`,
    `Til balli: ${record.lang.correct}/${record.lang.total}`,
    `Kasb balli: ${record.prof.correct}/${record.prof.total}`,
    `Natija: ${record.passed ? 'O\'TDI ✅' : 'O\'TMADI ❌'}`,
  ];
  sendLegalNotice(lines.join('\n'));
}

// ---- Click guruh xabarini tahlil qilish ----
function parseClickMessage(text) {
  if (!text || !/Успешно подтвержден/i.test(text)) return null;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const paramIdx = lines.findIndex(l => /Параметры оплаты/i.test(l));
  let ref = null;
  if (paramIdx !== -1 && lines[paramIdx + 1]) {
    ref = lines[paramIdx + 1].replace(/^[^\wа-яА-Я0-9+]+/u, '').trim();
  }
  const amountLine = lines.find(l => /сум/i.test(l));
  let amount = null;
  if (amountLine) {
    const d = amountLine.replace(/[^\d.,]/g, '').replace(/,/g, '');
    amount = Math.round(parseFloat(d));
  }
  return { ref, amount };
}

bot.on('message', (msg) => {
  console.log('Xabar keldi. chat.id =', msg.chat.id, '| chat.title =', msg.chat.title);
  if (ALLOWED_CHAT_ID && String(msg.chat.id) !== String(ALLOWED_CHAT_ID)) return;

  const parsed = parseClickMessage(msg.text || '');
  if (!parsed || !parsed.ref) return;

  const phoneDigits = digits(parsed.ref);
  if (!phoneDigits) return;

  // QAT'IY SUMMA TEKSHIRUVI: Click sahifasida ko'rsatilgan summaga emas,
  // shu yerga — guruhga kelgan HAQIQIY tasdiqlangan summaga ishonamiz.
  if (parsed.amount == null || parsed.amount < EXPECTED_AMOUNT) {
    console.log('CLICK PAYMENT IGNORED (summa yetarli emas):', parsed);
    return;
  }

  console.log('CLICK PAYMENT FOUND:', { ref: phoneDigits, amount: parsed.amount });

  const payments = loadPayments();
  const alreadyPaid = payments[phoneDigits] && payments[phoneDigits].status === 'paid';
  payments[phoneDigits] = { status: 'paid', amount: parsed.amount, paidAt: new Date().toISOString() };
  savePayments(payments);

  console.log('PAYMENT CONFIRMED:', phoneDigits, '|', parsed.amount, "so'm");

  if (!alreadyPaid) notifyPaymentConfirmed(phoneDigits, parsed.amount);
});

// ==== HTTP API ====
const app = express();
app.use(express.json());
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type'); next(); });
app.options('*', (req, res) => res.sendStatus(200));

app.get('/', (req, res) => res.send('Bot ishlamoqda.'));

// ---- To'lov holati (yagona manba — to'liq avtomatik) ----
app.get('/status/:phone', (req, res) => {
  const payments = loadPayments();
  const rec = payments[digits(req.params.phone)];
  res.json({ paid: !!(rec && rec.status === 'paid') });
});

// ---- To'lovni "ishlatilgan" deb belgilash — shu telefon raqami endi bepul qayta test topshira olmaydi ----
app.post('/api/consume-payment', (req, res) => {
  const key = digits((req.body || {}).phone);
  if (!key) return res.status(400).json({ ok: false, error: 'phone kerak' });
  const payments = loadPayments();
  if (payments[key] && payments[key].status === 'paid') {
    payments[key].status = 'used';
    payments[key].usedAt = new Date().toISOString();
    savePayments(payments);
  }
  res.json({ ok: true });
});

// ---- Qo'lda tuzatish: bot avtomatik aniqlay olmagan haqiqiy to'lovni belgilash ----
// Faqat ADMIN_SECRET ni bilgan kishi ishlata oladi.
app.post('/api/mark-paid', (req, res) => {
  const { phone, amount, secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: 'Ruxsat yo\'q' });
  }
  const key = digits(phone);
  if (!key) return res.status(400).json({ ok: false, error: 'phone kerak' });
  const payments = loadPayments();
  const alreadyPaid = payments[key] && payments[key].status === 'paid';
  payments[key] = { status: 'paid', amount: amount || EXPECTED_AMOUNT, paidAt: new Date().toISOString() };
  savePayments(payments);
  if (!alreadyPaid) notifyPaymentConfirmed(key, amount || EXPECTED_AMOUNT);
  res.json({ ok: true });
});

// ---- Oferta roziligi ----
app.post('/api/consent', (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || !phone) return res.status(400).json({ ok: false, error: 'name/phone required' });
  const list = loadConsents();
  list.push({ name, phone, timestamp: new Date().toISOString() });
  saveConsents(list);
  res.json({ ok: true });
});

// ---- Test natijasi ----
app.post('/api/submission', (req, res) => {
  const record = req.body || {};
  if (!record.name || !record.phone) return res.status(400).json({ ok: false, error: 'name/phone required' });
  const full = { ...record, timestamp: new Date().toISOString() };
  const list = loadSubmissions();
  list.push(full);
  saveSubmissions(list);
  notifySubmission(full);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server ishga tushdi, port:', PORT));
