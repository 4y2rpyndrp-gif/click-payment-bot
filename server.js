// Telegram guruhdagi Click bildirishnomalarini o'qib, to'lovni avtomatik
// tasdiqlaydigan server.

const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// ==== SOZLAMALAR ====

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || 'PUT_YOUR_BOT_TOKEN_HERE';

// Faqat shu guruhdan kelgan xabarlarni qabul qiladi.
const ALLOWED_CHAT_ID =
  process.env.CLICK_GROUP_CHAT_ID || '';

const EXPECTED_AMOUNT = 412000;

// To'lovlar saqlanadigan fayl
const DB_FILE = path.join(__dirname, 'payments.json');


// ==== BAZANI O'QISH ====

function loadDb() {
  try {
    return JSON.parse(
      fs.readFileSync(DB_FILE, 'utf8')
    );
  } catch (e) {
    return {};
  }
}


// ==== BAZAGA SAQLASH ====

function saveDb(db) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}


// ==== CLICK XABARINI TAHLIL QILISH ====

function parseClickMessage(text) {

  // Faqat muvaffaqiyatli tasdiqlangan to'lovlarni qabul qilamiz
  if (
    !text ||
    !/Успешно подтвержден/i.test(text)
  ) {
    return null;
  }

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);


  // "Параметры оплаты:" qatorini topamiz
  const paramIdx = lines.findIndex(
    l => /Параметры оплаты/i.test(l)
  );


  // Transaction param / telefon raqami
  let ref = null;

  if (
    paramIdx !== -1 &&
    lines[paramIdx + 1]
  ) {
    ref = lines[paramIdx + 1]
      .replace(/^[^\wа-яА-Я0-9+]+/u, '')
      .trim();
  }


  // Summani topamiz
  const amountLine = lines.find(
    l => /сум/i.test(l)
  );

  let amount = null;

  if (amountLine) {

    const digits = amountLine
      .replace(/[^\d.,]/g, '')
      .replace(/,/g, '');

    amount = Math.round(
      parseFloat(digits)
    );
  }


  return {
    ref,
    amount
  };
}


// ==== TELEGRAM BOT ====

const bot = new TelegramBot(
  BOT_TOKEN,
  {
    polling: true
  }
);


// ==== /START BUYRUG'I ====

bot.onText(/\/start/, (msg) => {

  bot.sendMessage(
    msg.chat.id,
    'Bot ishlamoqda. To‘lovlar avtomatik tekshiriladi.'
  );

});


// ==== GURUH XABARLARINI QABUL QILISH ====

bot.on('message', (msg) => {

  // Agar aniq guruh belgilangan bo'lsa,
  // boshqa guruhlarni e'tiborsiz qoldiramiz.
  if (
    ALLOWED_CHAT_ID &&
    String(msg.chat.id) !== String(ALLOWED_CHAT_ID)
  ) {
    return;
  }


  // Konsolga kelgan xabarni chiqaramiz
  console.log(
    'Xabar keldi. chat.id =',
    msg.chat.id,
    '| chat.title =',
    msg.chat.title
  );


  // CLICK xabarini tahlil qilamiz
  const parsed = parseClickMessage(
    msg.text || ''
  );


  // CLICK xabari bo'lmasa
  if (
    !parsed ||
    !parsed.ref
  ) {
    return;
  }


  // Faqat raqamlarni qoldiramiz
  const phoneDigits =
    parsed.ref.replace(
      /[^0-9]/g,
      ''
    );


  if (!phoneDigits) {
    return;
  }


  // Kerakli summa kelganini tekshiramiz
  if (
    parsed.amount == null ||
    parsed.amount < EXPECTED_AMOUNT
  ) {

    console.log(
      'E\'tiborsiz qoldirildi (summa mos kelmadi):',
      parsed
    );

    return;
  }


  // Bazani o'qiymiz
  const db = loadDb();


  // To'lovni tasdiqlaymiz
  db[phoneDigits] = {
    status: 'paid',
    amount: parsed.amount,
    paidAt: new Date().toISOString()
  };


  // Bazaga saqlaymiz
  saveDb(db);


  console.log(
    'TASDIQLANDI:',
    phoneDigits,
    parsed.amount,
    'so\'m'
  );

});


// ==== VEB SERVER ====

const app = express();


// Sayt telefon bo'yicha to'lov holatini tekshiradi
app.get(
  '/status/:phone',
  (req, res) => {

    res.set(
      'Access-Control-Allow-Origin',
      '*'
    );

    const db = loadDb();

    const phone =
      req.params.phone.replace(
        /[^0-9]/g,
        ''
      );

    const rec = db[phone];

    res.json({
      paid: !!(
        rec &&
        rec.status === 'paid'
      )
    });

  }
);


// Asosiy sahifa
app.get(
  '/',
  (req, res) => {
    res.send('Bot ishlamoqda.');
  }
);


// Render porti
const PORT =
  process.env.PORT || 3000;


// Serverni ishga tushirish
app.listen(
  PORT,
  () => {
    console.log(
      'Status server ishga tushdi, port:',
      PORT
    );
  }
);
