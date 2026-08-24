// Telegram guruhdagi Click bildirishnomalarini o'qib, to'lovni avtomatik
// tasdiqlaydigan server. Click'ning maxfiy kaliti (secret_key) shart emas —
// faqat sizda mavjud bo'lgan narsalardan foydalaniladi: pay-havola va
// Click'ning o'zi yuboradigan guruh xabarlari.

const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// ==== SOZLAMALAR ====
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'PUT_YOUR_BOT_TOKEN_HERE';
// Ixtiyoriy: faqat shu guruhdan kelgan xabarlarni qabul qilish uchun.
// Bo'sh qoldirsangiz, bot qo'shilgan har qanday guruhdagi mos xabarni o'qiydi.
const ALLOWED_CHAT_ID = process.env.CLICK_GROUP_CHAT_ID || '';
const EXPECTED_AMOUNT = 412000; // so'mda, test narxi

const DB_FILE = path.join(__dirname, 'payments.json');
function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---- Click guruh xabarini tahlil qilish ----
// Namuna xabar:
// GOLD VISA (109639)
// ➡️ Параметры оплаты:
// 🔶 998901234567          <- bizning transaction_param (telefon raqami)
// ID 5223633786
// 📱 +998*****4488
// 💳 986017******7675
// 🌐 412,000.00 сум
// 🕐 20:11:27 17.08.2026
// ✅ Успешно подтвержден
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
    const digits = amountLine.replace(/[^\d.,]/g, '').replace(/,/g, '');
    amount = Math.round(parseFloat(digits));
  }

  return { ref, amount };
}

// ---- Telegram bot: guruh xabarlarini tinglaydi ----
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('message', (msg) => {
  if (ALLOWED_CHAT_ID && String(msg.chat.id) !== String(ALLOWED_CHAT_ID)) return;

  // Guruh chat_id ni bilib olish uchun yordamchi: konsolga yozib turadi
  console.log('Xabar keldi. chat.id =', msg.chat.id, '| chat.title =', msg.chat.title);

  const parsed = parseClickMessage(msg.text || '');
  if (!parsed || !parsed.ref) return;

  const phoneDigits = parsed.ref.replace(/[^0-9]/g, '');
  if (!phoneDigits) return;
  if (parsed.amount == null || parsed.amount < EXPECTED_AMOUNT) {
    console.log('E\'tiborsiz qoldirildi (summa mos kelmadi):', parsed);
    return;
  }

  const db = loadDb();
  db[phoneDigits] = { status: 'paid', amount: parsed.amount, paidAt: new Date().toISOString() };
  saveDb(db);
  console.log('TASDIQLANDI:', phoneDigits, parsed.amount, 'so\'m');
});

// ---- Veb-sahifa shu yerdan "to'landimi?" deb so'raydi ----
const app = express();
app.get('/status/:phone', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const db = loadDb();
  const rec = db[req.params.phone.replace(/[^0-9]/g, '')];
  res.json({ paid: !!(rec && rec.status === 'paid') });
});
app.get('/', (req, res) => res.send('Bot ishlamoqda.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Status server ishga tushdi, port:', PORT));
