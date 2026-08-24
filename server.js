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
// SUMMANI ANIQLASH
// =====================================================

function normalizeAmount(value) {
  if (value == null) return null;

  let text = String(value)
    .replace(/\u00A0/g, ' ')
    .replace(/\s/g, '')
    .trim();

  // Masalan:
  // 412000
  // 412,000
  // 412 000
  // 412000.00
  // 412,000.00

  text = text.replace(/[^\d.,]/g, '');

  if (!text) return null;

  // 412,000.00 -> 412000.00
  // 412.000,00 -> 412000.00
  if (text.includes(',') && text.includes('.')) {
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');

    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  }

  // 412,000 -> 412000
  else if (text.includes(',')) {
    const parts = text.split(',');

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {
      text = parts[0] + parts[1];
    } else {
      text = text.replace(/,/g, '');
    }
  }

  // 412.000 -> 412000
  else if (text.includes('.')) {
    const parts = text.split('.');

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {
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
// CLICK TELEGRAM XABARINI TEKSHIRISH
// =====================================================

function parseClickMessage(text) {

  if (!text) {
    return null;
  }

  // FAQAT "Успешно подтвержден" bo'lgan Click xabari
  if (!/Успешно\s+подтвержден/i.test(text)) {
    return null;
  }

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);


  // ---------------------------------------------------
  // PARAMETR / TELEFON RAQAMINI OLISH
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
      .replace(/^[^\wа-яА-Я0-9+]+/u, '')
      .trim();
  }


  // ---------------------------------------------------
  // SUMMANI TOPISH
  // ---------------------------------------------------

  let amount = null;

  for (const line of lines) {

    // Faqat "сум" bor qatorni tekshiramiz
    if (!/сум/i.test(line)) {
      continue;
    }

    const detected = normalizeAmount(line);

    if (detected !== null) {
      amount = detected;
      break;
    }
  }


  return {
    ref,
    amount
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
      // CHATNI TEKSHIRISH
      // ------------------------------------------------

      if (
        ALLOWED_CHAT_ID &&
        String(msg.chat.id) !== ALLOWED_CHAT_ID
      ) {
        return;
      }


      console.log('');
      console.log('========================================');
      console.log('YANGI TELEGRAM XABAR');
      console.log('Chat ID:', msg.chat.id);
      console.log('Title:', msg.chat.title || '');
      console.log('========================================');


      const text = msg.text || '';


      console.log('Xabar matni:');
      console.log(text);


      // ------------------------------------------------
      // CLICK XABARINI PARSE QILISH
      // ------------------------------------------------

      const parsed = parseClickMessage(text);


      if (!parsed) {

        console.log(
          '❌ Click to‘lovi sifatida qabul qilinmadi.'
        );

        return;
      }


      console.log(
        'Aniqlangan ref:',
        parsed.ref
      );

      console.log(
        'Aniqlangan summa:',
        parsed.amount
      );


      // ------------------------------------------------
      // TELEFON RAQAMINI OLISH
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
      // FAQAT 412 000 SO'M
      // ------------------------------------------------

      if (parsed.amount !== EXPECTED_AMOUNT) {

        console.log('');
        console.log('❌ TO‘LOV TASDIQLANMADI');
        console.log(
          'Kelgan summa:',
          parsed.amount
        );
        console.log(
          'Kerakli summa:',
          EXPECTED_AMOUNT
        );
        console.log(
          'Sabab: summa 412 000 so‘mga teng emas.'
        );
        console.log('');

        return;
      }


      // ------------------------------------------------
      // FAQAT ANIQLIK BILAN 412 000 BO'LSA SAQLAYMIZ
      // ------------------------------------------------

      const db = loadDb();


      db[phoneDigits] = {
        status: 'paid',
        amount: EXPECTED_AMOUNT,
        paidAt: new Date().toISOString()
      };


      saveDb(db);


      console.log('');
      console.log('========================================');
      console.log('✅ TO‘LOV TASDIQLANDI');
      console.log('Telefon:', phoneDigits);
      console.log('Summa:', EXPECTED_AMOUNT);
      console.log('========================================');
      console.log('');

    } catch (error) {

      console.log(
        'Telegram xabarini qayta ishlashda xato:',
        error.message
      );

    }

  });

}


// =====================================================
// TEST / STATUS API
// =====================================================

// Sayt shu endpoint orqali:
// "Bu telefon egasi to'laganmi?"
// deb tekshiradi.

app.get('/status/:phone', (req, res) => {

  res.set(
    'Access-Control-Allow-Origin',
    '*'
  );

  const phone = req.params.phone
    .replace(/[^0-9]/g, '');


  const db = loadDb();

  const record = db[phone];


  if (
    record &&
    record.status === 'paid' &&
    Number(record.amount) === EXPECTED_AMOUNT
  ) {

    return res.json({
      paid: true,
      amount: EXPECTED_AMOUNT
    });

  }


  return res.json({
    paid: false,
    amount: EXPECTED_AMOUNT
  });

});


// =====================================================
// HOME
// =====================================================

app.get('/', (req, res) => {

  res.send(
    'Payment verification server ishlamoqda.'
  );

});


// =====================================================
// SERVER
// =====================================================

app.listen(PORT, () => {

  console.log('');
  console.log('========================================');
  console.log('SERVER ISHLADI');
  console.log('Kerakli summa: 412000 so‘m');
  console.log('PORT:', PORT);
  console.log('========================================');

});
