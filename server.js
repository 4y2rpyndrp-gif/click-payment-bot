const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// SOZLAMALAR
// =====================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const ALLOWED_CHAT_ID = String(
  process.env.CLICK_GROUP_CHAT_ID || ''
).trim();

// FAQAT SHU SUMMA QABUL QILINADI
const EXPECTED_AMOUNT = 412000;

// To'lovlar saqlanadigan fayl
const DB_FILE = path.join(__dirname, 'payments.json');

// Render porti
const PORT = process.env.PORT || 3000;


// =====================================================
// DATABASE
// =====================================================

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return {};
    }

    const data = fs.readFileSync(DB_FILE, 'utf8');

    if (!data.trim()) {
      return {};
    }

    return JSON.parse(data);

  } catch (error) {
    console.log('Database o‘qishda xato:', error.message);
    return {};
  }
}


function saveDb(db) {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2),
      'utf8'
    );

  } catch (error) {
    console.log('Database saqlashda xato:', error.message);
  }
}


// =====================================================
// SUMMANI NORMALIZATSIYA QILISH
// =====================================================

function normalizeAmount(value) {

  if (value === null || value === undefined) {
    return null;
  }

  let text = String(value)
    .replace(/\u00A0/g, ' ')
    .trim();

  // Faqat raqam, nuqta, vergul va bo'sh joyni qoldiramiz
  text = text.replace(/[^\d.,\s]/g, '');

  // Bo'sh joylarni olib tashlaymiz
  text = text.replace(/\s/g, '');

  if (!text) {
    return null;
  }


  // ---------------------------------------------------
  // 412,000.00
  // 412.000,00
  // ---------------------------------------------------

  if (text.includes(',') && text.includes('.')) {

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');

    if (lastComma > lastDot) {

      // 412.000,00
      text = text
        .replace(/\./g, '')
        .replace(',', '.');

    } else {

      // 412,000.00
      text = text.replace(/,/g, '');
    }
  }

  // ---------------------------------------------------
  // 412,000
  // ---------------------------------------------------

  else if (text.includes(',')) {

    const parts = text.split(',');

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {

      // 412,000
      text = parts[0] + parts[1];

    } else {

      // 412,00
      text = text.replace(/,/g, '.');
    }
  }

  // ---------------------------------------------------
  // 412.000
  // ---------------------------------------------------

  else if (text.includes('.')) {

    const parts = text.split('.');

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {

      // 412.000
      text = parts[0] + parts[1];
    }
  }


  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.round(number);
}


// =====================================================
// CLICK XABARIDAGI SUMMA QATORINI TOPISH
// =====================================================

function isCurrencyLine(line) {

  if (!line) {
    return false;
  }

  return /(
    сум|
    сўм|
    сом|
    so['’‘`ʼʻ]?m
  )/ix.test(line);
}


// =====================================================
// CLICK GURUH XABARINI TAHLIL QILISH
// =====================================================

function parseClickMessage(text) {

  if (!text) {
    return null;
  }


  // FAQAT MUVAFFAQIYATLI CLICK TO'LOV
  if (!/Успешно\s+подтвержден/i.test(text)) {

    return null;
  }


  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);


  // ---------------------------------------------------
  // PARAMETRLAR / TELEFON
  // ---------------------------------------------------

  const paramIdx = lines.findIndex(line =>
    /Параметры\s+оплаты/i.test(line)
  );


  let ref = null;


  if (
    paramIdx !== -1 &&
    lines[paramIdx + 1]
  ) {

    ref = lines[paramIdx + 1]
      .replace(
        /^[^\wа-яА-ЯёЁ0-9+]+/u,
        ''
      )
      .trim();
  }


  // ---------------------------------------------------
  // SUMMA
  // ---------------------------------------------------

  let amount = null;
  let amountLine = null;


  for (const line of lines) {

    if (!isCurrencyLine(line)) {
      continue;
    }


    // Qatordagi birinchi haqiqiy raqamlar blokini olish
    const numberMatches = line.match(
      /\d[\d\s.,]*/g
    );


    if (!numberMatches || !numberMatches.length) {
      continue;
    }


    // Odatda Click summasi bo'lgan raqamni olamiz.
    // Masalan:
    // 412,000.00 сум
    // 412 000 сум
    // 1 000 so'm
    const candidate = numberMatches[0];


    const detectedAmount = normalizeAmount(
      candidate
    );


    if (detectedAmount !== null) {

      amount = detectedAmount;
      amountLine = line;

      break;
    }
  }


  return {
    ref,
    amount,
    amountLine
  };
}


// =====================================================
// TELEGRAM BOT
// =====================================================

if (!BOT_TOKEN) {

  console.log(
    'OGOHLANTIRISH: TELEGRAM_BOT_TOKEN topilmadi.'
  );

} else {

  const bot = new TelegramBot(
    BOT_TOKEN,
    {
      polling: true
    }
  );


  bot.on('polling_error', (error) => {

    console.log(
      'Telegram polling error:',
      error.message
    );

  });


  bot.on('message', (msg) => {

    try {

      // ------------------------------------------------
      // FAQAT KERAKLI GURUH
      // ------------------------------------------------

      if (
        ALLOWED_CHAT_ID &&
        String(msg.chat.id) !== ALLOWED_CHAT_ID
      ) {

        return;
      }


      const text = msg.text || '';


      console.log('');
      console.log(
        '========================================'
      );

      console.log(
        'Yangi Telegram xabar keldi'
      );

      console.log(
        'Chat ID:',
        msg.chat.id
      );

      console.log(
        'Chat title:',
        msg.chat.title || ''
      );

      console.log(
        'Xabar:',
        text
      );

      console.log(
        '========================================'
      );


      // ------------------------------------------------
      // CLICK XABARINI TEKSHIRISH
      // ------------------------------------------------

      const parsed = parseClickMessage(text);


      if (!parsed) {

        console.log(
          '❌ Click to‘lovi sifatida qabul qilinmadi.'
        );

        return;
      }


      console.log(
        'Aniqlangan REF:',
        parsed.ref
      );

      console.log(
        'Aniqlangan summa:',
        parsed.amount
      );

      console.log(
        'Summa qatori:',
        parsed.amountLine
      );


      // ------------------------------------------------
      // TELEFON / REF TEKSHIRISH
      // ------------------------------------------------

      if (!parsed.ref) {

        console.log(
          '❌ To‘lov parametri topilmadi.'
        );

        return;
      }


      const phoneDigits = parsed.ref
        .replace(/[^0-9]/g, '');


      if (!phoneDigits) {

        console.log(
          '❌ Telefon raqami topilmadi.'
        );

        return;
      }


      // ------------------------------------------------
      // ENG MUHIM TEKSHIRUV
      //
      // FAQAT AYNAN 412 000 SO'M
      //
      // 1 000     ❌
      // 79 000    ❌
      // 100 000   ❌
      // 411 999   ❌
      // 412 000   ✅
      // 412 001   ❌
      // 500 000   ❌
      // ------------------------------------------------

      if (
        parsed.amount !== EXPECTED_AMOUNT
      ) {

        console.log('');
        console.log(
          '❌ TO‘LOV TASDIQLANMADI'
        );

        console.log(
          'Kelgan summa:',
          parsed.amount
        );

        console.log(
          'Kerakli summa:',
          EXPECTED_AMOUNT
        );

        console.log(
          'Sabab: summa aynan 412 000 so‘m emas.'
        );

        console.log('');

        return;
      }


      // ------------------------------------------------
      // OLDINGI MA'LUMOTNI TEKSHIRISH
      // ------------------------------------------------

      const db = loadDb();


      // ------------------------------------------------
      // FAQAT 412 000 BO'LSA SAQLAYMIZ
      // ------------------------------------------------

      db[phoneDigits] = {

        status: 'paid',

        amount: EXPECTED_AMOUNT,

        paidAt: new Date().toISOString()
      };


      saveDb(db);


      console.log('');
      console.log(
        '========================================'
      );

      console.log(
        '✅ TO‘LOV TASDIQLANDI'
      );

      console.log(
        'Telefon:',
        phoneDigits
      );

      console.log(
        'Summa:',
        EXPECTED_AMOUNT
      );

      console.log(
        '========================================'
      );

      console.log('');

    } catch (error) {

      console.log(
        '❌ Xabarni qayta ishlashda xato:',
        error.message
      );
    }

  });
}


// =====================================================
// STATUS API
// =====================================================
//
// Test sayti shu manzilni tekshiradi:
//
// /status/998901234567
//
// Faqat aynan 412000 bo'lsa:
// paid: true
//
// 1000 bo'lsa:
// paid: false
// =====================================================

app.get(
  '/status/:phone',
  (req, res) => {

    res.set(
      'Access-Control-Allow-Origin',
      '*'
    );


    const phone = req.params.phone
      .replace(/[^0-9]/g, '');


    const db = loadDb();


    const record = db[phone];


    // ------------------------------------------------
    // FAQAT AYNAN 412 000 BO'LSA PAID
    // ------------------------------------------------

    const isPaid = !!(
      record &&
      record.status === 'paid' &&
      Number(record.amount) === EXPECTED_AMOUNT
    );


    return res.json({

      paid: isPaid,

      amount: EXPECTED_AMOUNT

    });
  }
);


// =====================================================
// HOME
// =====================================================

app.get(
  '/',
  (req, res) => {

    res.send(
      'Payment verification server ishlamoqda.'
    );
  }
);


// =====================================================
// SERVER
// =====================================================

app.listen(
  PORT,
  () => {

    console.log('');
    console.log(
      '========================================'
    );

    console.log(
      '✅ SERVER ISHLADI'
    );

    console.log(
      'Kerakli summa: 412000 so‘m'
    );

    console.log(
      'Faqat aynan 412000 qabul qilinadi.'
    );

    console.log(
      'PORT:',
      PORT
    );

    console.log(
      '========================================'
    );
  }
);
