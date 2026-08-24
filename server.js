// Germaniya viza testi — to'liq backend.
// 1) Telegram guruhdagi Click bildirishnomalarini o'qib, to'lovni avtomatik tasdiqlaydi
// 2) Test sahifasi (istalgan joyda joylashtirilgan — Netlify, va h.k.) uchun
//    oferta rozilik, test natijalari va admin panelni saqlaydi

const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// ==== SOZLAMALAR ====
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'PUT_YOUR_BOT_TOKEN_HERE';
const ALLOWED_CHAT_ID = process.env.CLICK_GROUP_CHAT_ID || '';
const EXPECTED_AMOUNT = 412000; // so'mda, test narxi

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

// pending: { "<phoneDigits>": { name, phone, amount, receiptId, timestamp, status:'pending'|'approved'|'rejected' } }
function loadPending() { return loadJson('pending', {}); }
function savePending(db) { saveJson('pending', db); }

// consents: [ {name, phone, timestamp} ]
function loadConsents() { return loadJson('consents', []); }
function saveConsents(list) { saveJson('consents', list); }

// submissions: [ {name, phone, direction, sector, specialty, lang, prof, passed, timestamp} ]
function loadSubmissions() { return loadJson('submissions', []); }
function saveSubmissions(list) { saveJson('submissions', list); }

function digits(s) { return (s || '').replace(/[^0-9]/g, ''); }

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

// ---- Telegram bot: guruh xabarlarini tinglaydi ----
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('message', (msg) => {
  if (ALLOWED_CHAT_ID && String(msg.chat.id) !== String(ALLOWED_CHAT_ID)) return;
  console.log('Xabar keldi. chat.id =', msg.chat.id, '| chat.title =', msg.chat.title);

  const parsed = parseClickMessage(msg.text || '');
  if (!parsed || !parsed.ref) return;

  const phoneDigits = digits(parsed.ref);
  if (!phoneDigits) return;
  if (parsed.amount == null || parsed.amount < EXPECTED_AMOUNT) {
    console.log('CLICK PAYMENT IGNORED (amount mismatch):', parsed);
    return;
  }

  console.log('CLICK PAYMENT FOUND:', { ref: phoneDigits, amount: parsed.amount });

  const payments = loadPayments();
  payments[phoneDigits] = { status: 'paid', amount: parsed.amount, paidAt: new Date().toISOString() };
  savePayments(payments);

  // pending yozuvi bo'lsa, uni ham yopamiz (tarix uchun)
  const pending = loadPending();
  if (pending[phoneDigits]) { pending[phoneDigits].status = 'approved'; savePending(pending); }

  console.log('PAYMENT CONFIRMED:', phoneDigits, '|', parsed.amount, "so'm");
});

// ==== HTTP API ====
const app = express();
app.use(express.json());
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type'); next(); });
app.options('*', (req, res) => res.sendStatus(200));

app.get('/', (req, res) => res.send('Bot ishlamoqda.'));

// ---- To'lov holati (asosiy, avtomatik) ----
app.get('/status/:phone', (req, res) => {
  const payments = loadPayments();
  const rec = payments[digits(req.params.phone)];
  res.json({ paid: !!(rec && rec.status === 'paid') });
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

// ---- "To'lov qildim" — kutish navbatiga qo'shish (admin zaxira tasdig'i uchun) ----
app.post('/api/pending', (req, res) => {
  const { name, phone, amount, receiptId } = req.body || {};
  if (!name || !phone) return res.status(400).json({ ok: false, error: 'name/phone required' });
  const pending = loadPending();
  pending[digits(phone)] = { name, phone, amount: amount || EXPECTED_AMOUNT, receiptId: receiptId || '', timestamp: new Date().toISOString(), status: 'pending' };
  savePending(pending);
  res.json({ ok: true });
});

// ---- Admin: kutilayotgan to'lovlar ro'yxati ----
app.get('/api/pending', (req, res) => {
  const pending = loadPending();
  const list = Object.values(pending).filter(p => p.status === 'pending');
  res.json({ pending: list });
});

// ---- Admin: to'lovni qo'lda tasdiqlash/rad etish ----
app.post('/api/pending/:phone/resolve', (req, res) => {
  const { status, reason } = req.body || {}; // 'approved' | 'rejected'
  const key = digits(req.params.phone);
  const pending = loadPending();
  if (!pending[key]) return res.status(404).json({ ok: false, error: 'not found' });
  pending[key].status = status;
  pending[key].reason = reason || '';
  savePending(pending);

  if (status === 'approved') {
    const payments = loadPayments();
    payments[key] = { status: 'paid', amount: pending[key].amount, paidAt: new Date().toISOString() };
    savePayments(payments);
  }
  res.json({ ok: true });
});

// ---- Test natijasi ----
app.post('/api/submission', (req, res) => {
  const record = req.body || {};
  if (!record.name || !record.phone) return res.status(400).json({ ok: false, error: 'name/phone required' });
  const list = loadSubmissions();
  list.push({ ...record, timestamp: new Date().toISOString() });
  saveSubmissions(list);
  res.json({ ok: true });
});

// ---- Admin: barcha test natijalari ----
app.get('/api/submissions', (req, res) => {
  res.json({ submissions: loadSubmissions().slice().reverse() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server ishga tushdi, port:', PORT));
