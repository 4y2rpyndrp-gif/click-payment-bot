const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================================================
// SOZLAMALAR
// ======================================================

const BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || ''
).trim();

const ALLOWED_CHAT_ID = String(
  process.env.CLICK_GROUP_CHAT_ID || '-5037525525'
).trim();

// TEST UCHUN KERAKLI MINIMAL SUMMA
const EXPECTED_AMOUNT = 412000;

// RENDER PORT
const PORT = Number(process.env.PORT || 3000);

// RENDER PUBLIC URL
const PUBLIC_URL = String(
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://click-payment-bot.onrender.com'
).replace(/\/$/, '');

// ======================================================
// TOKEN TEKSHIRUVI
// ======================================================

if (!BOT_TOKEN) {
  console.error(
    'ERROR: TELEGRAM_BOT_TOKEN environment variable topilmadi.'
  );

  process.exit(1);
}

// ======================================================
// DATABASE
// ======================================================

const DB_FILE = path.join(__dirname, 'payments.json');

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return {
        payments: {},
        transactions: {}
      };
    }

    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(raw);

    return {
      payments:
        data &&
        typeof data.payments === 'object'
          ? data.payments
          : {},

      transactions:
        data &&
        typeof data.transactions === 'object'
          ? data.transactions
          : {}
    };

  } catch (error) {

    console.error(
      'DB READ ERROR:',
      error.message
    );

    return {
      payments: {},
      transactions: {}
    };
  }
}

function saveDb(db) {

  const tempFile = `${DB_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(db, null, 2),
    'utf8'
  );

  fs.renameSync(
    tempFile,
    DB_FILE
  );
}

// ======================================================
// TELEFON RAQAMNI NORMALIZATSIYA
// ======================================================

function normalizePhone(value) {

  const digits = String(value || '')
    .replace(/\D/g, '');

  // 998901234567
  if (
    digits.length === 12 &&
    digits.startsWith('998')
  ) {
    return digits;
  }

  // 901234567
  if (
    digits.length === 9 &&
    digits.startsWith('9')
  ) {
    return `998${digits}`;
  }

  return digits;
}

// ======================================================
// SUMMANI AJRATISH
// ======================================================

function parseAmount(value) {

  const text = String(value || '')
    .replace(/\u00a0/g, ' ');

  const match = text.match(
    /(\d[\d\s,.]*)(?:\s*(?:сум|so['’`]?\s*m|uzs))?/i
  );

  if (!match) {
    return null;
  }

  let numberText = match[1]
    .replace(/\s/g, '');

  // 412,000.00
  if (
    numberText.includes(',') &&
    numberText.includes('.')
  ) {

    numberText =
      numberText.replace(/,/g, '');
  }

  // 412,000
  else if (
    numberText.includes(',')
  ) {

    const parts =
      numberText.split(',');

    if (
      parts.length === 2 &&
      parts[1].length === 2
    ) {

      numberText =
        `${parts[0]}.${parts[1]}`;

    } else {

      numberText =
        numberText.replace(/,/g, '');
    }
  }

  const amount =
    Number(numberText);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return Math.round(amount);
}

// ======================================================
// CLICK TELEGRAM XABARINI TAHLIL QILISH
// ======================================================

function parseClickMessage(text) {

  if (!text) {
    return null;
  }

  const normalized =
    String(text).replace(/\r/g, '');

  // Faqat muvaffaqiyatli to'lov
  if (
    !/Успешно\s+подтвержден/i.test(
      normalized
    )
  ) {
    return null;
  }

  const lines =
    normalized
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

  // ----------------------------------------------------
  // PARAMETRLAR QATORI
  // ----------------------------------------------------

  const paramIndex =
    lines.findIndex(line =>
      /Параметры\s+оплаты/i.test(line)
    );

  let ref = null;

  if (paramIndex >= 0) {

    for (
      let i = paramIndex + 1;
      i < Math.min(
        lines.length,
        paramIndex + 6
      );
      i++
    ) {

      const phone =
        lines[i].match(
          /(?:\+?998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\+?998\d{9}|\b9\d{8}\b)/
        );

      if (phone) {

        ref = phone[0];

        break;
      }
    }
  }

  // ----------------------------------------------------
  // FALLBACK TELEFON QIDIRISH
  // ----------------------------------------------------

  if (!ref) {

    const phone =
      normalized.match(
        /(?:\+?998\d{9}|\b9\d{8}\b)/
      );

    if (phone) {
      ref = phone[0];
    }
  }

  // ----------------------------------------------------
  // SUMMA
  // ----------------------------------------------------

  const amountLine =
    lines.find(line =>
      /(сум|so['’`]?\s*m|uzs)/i.test(line)
    );

  const amount =
    parseAmount(
      amountLine || ''
    );

  // ----------------------------------------------------
  // CLICK ID
  // ----------------------------------------------------

  const idMatch =
    normalized.match(
      /(?:^|\n)\s*ID\s*[:#-]?\s*(\d{4,})/i
    );

  const clickTransId =
    idMatch
      ? idMatch[1]
      : null;

  return {

    ref:
      normalizePhone(ref),

    amount,

    clickTransId,

    text:
      normalized
  };
}

// ======================================================
// TELEFONNI LOGDA YASHIRISH
// ======================================================

function maskPhone(phone) {

  const p =
    normalizePhone(phone);

  if (p.length < 7) {
    return p;
  }

  return (
    `${p.slice(0, 6)}****${p.slice(-2)}`
  );
}

// ======================================================
// TELEGRAM API
// ======================================================

async function telegram(
  method,
  body = {}
) {

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: 'POST',

        headers: {
          'content-type':
            'application/json'
        },

        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (
    !response.ok ||
    !data.ok
  ) {

    throw new Error(
      data.description ||
      `Telegram HTTP ${response.status}`
    );
  }

  return data.result;
}

// ======================================================
// WEBHOOK
// ======================================================

// Muhim:
// BU KODDA POLLING YO'Q.
// getUpdates YO'Q.
// Faqat webhook ishlaydi.

const WEBHOOK_SECRET =
  String(
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    crypto
      .createHash('sha256')
      .update(BOT_TOKEN)
      .digest('hex')
      .slice(0, 32)
  );

const WEBHOOK_PATH =
  `/telegram/webhook/${WEBHOOK_SECRET}`;

const WEBHOOK_URL =
  `${PUBLIC_URL}${WEBHOOK_PATH}`;

// ======================================================
// TELEGRAM WEBHOOKNI O'RNATISH
// ======================================================

async function setupTelegramWebhook() {

  const me =
    await telegram('getMe');

  console.log(
    `Telegram bot: @${me.username || me.first_name || 'unknown'}`
  );

  console.log(
    `Webhook URL: ${PUBLIC_URL}/telegram/webhook/[secret]`
  );

  // Eski webhook o'rniga aynan shu webhook o'rnatiladi.
  const result =
    await telegram(
      'setWebhook',
      {
        url:
          WEBHOOK_URL,

        secret_token:
          WEBHOOK_SECRET,

        allowed_updates:
          ['message'],

        drop_pending_updates:
          false,

        max_connections:
          10
      }
    );

  console.log(
    'TELEGRAM WEBHOOK SET:',
    result === true
      ? 'OK'
      : result
  );

  const info =
    await telegram(
      'getWebhookInfo'
    );

  console.log(
    'WEBHOOK ACTIVE:',
    Boolean(info.url)
  );

  console.log(
    'WEBHOOK PENDING:',
    info.pending_update_count || 0
  );

  if (
    info.last_error_message
  ) {

    console.log(
      'WEBHOOK LAST ERROR:',
      info.last_error_message
    );
  }
}

// ======================================================
// CLICK XABARINI QABUL QILISH
// ======================================================

function processClickMessage(
  message
) {

  if (!message) {
    return;
  }

  const chatId =
    String(
      message.chat?.id ?? ''
    );

  const chatTitle =
    message.chat?.title ||
    message.chat?.username ||
    'private';

  const text =
    message.text ||
    message.caption ||
    '';

  console.log(
    'TELEGRAM MESSAGE:',
    JSON.stringify({
      chatId,
      chatTitle,
      messageId:
        message.message_id
    })
  );

  // Faqat CLICK guruhidan
  if (
    ALLOWED_CHAT_ID &&
    chatId !== ALLOWED_CHAT_ID
  ) {

    console.log(
      'IGNORED CHAT:',
      chatId
    );

    return;
  }

  const parsed =
    parseClickMessage(text);

  if (!parsed) {
    return;
  }

  console.log(
    'CLICK PAYMENT FOUND:',
    JSON.stringify({
      ref:
        maskPhone(parsed.ref),

      amount:
        parsed.amount,

      clickTransId:
        parsed.clickTransId
    })
  );

  // Telefon topilmasa
  if (!parsed.ref) {

    console.log(
      'IGNORED: phone/reference topilmadi.'
    );

    return;
  }

  // Summa topilmasa
  if (
    parsed.amount === null
  ) {

    console.log(
      'IGNORED: summa topilmadi.'
    );

    return;
  }

  // Yetarli summa emas
  if (
    parsed.amount <
    EXPECTED_AMOUNT
  ) {

    console.log(
      `IGNORED: amount ${parsed.amount} < required ${EXPECTED_AMOUNT}`
    );

    return;
  }

  const db =
    loadDb();

  const now =
    new Date().toISOString();

  const phone =
    parsed.ref;

  const transactionKey =
    parsed.clickTransId ||
    `${phone}:${parsed.amount}:${message.message_id}`;

  // ----------------------------------------------------
  // DUPLIKAT TO'LOV
  // ----------------------------------------------------

  if (
    db.transactions[
      transactionKey
    ]?.status === 'paid'
  ) {

    console.log(
      'DUPLICATE PAYMENT IGNORED:',
      transactionKey
    );

    return;
  }

  // ----------------------------------------------------
  // TO'LOVNI SAQLASH
  // ----------------------------------------------------

  const record = {

    status:
      'paid',

    amount:
      parsed.amount,

    requiredAmount:
      EXPECTED_AMOUNT,

    phone:
      phone,

    clickTransId:
      parsed.clickTransId,

    telegramChatId:
      chatId,

    telegramMessageId:
      message.message_id,

    paidAt:
      now
  };

  db.payments[phone] =
    record;

  db.transactions[
    transactionKey
  ] =
    record;

  saveDb(db);

  console.log(
    `PAYMENT CONFIRMED: ${maskPhone(phone)} | ${parsed.amount} so'm`
  );
}

// ======================================================
// TELEGRAM WEBHOOK ENDPOINT
// ======================================================

app.post(
  WEBHOOK_PATH,
  (req, res) => {

    const incomingSecret =
      String(
        req.get(
          'X-Telegram-Bot-Api-Secret-Token'
        ) || ''
      );

    // Telegram emas bo'lsa
    if (
      incomingSecret !==
      WEBHOOK_SECRET
    ) {

      console.warn(
        'TELEGRAM WEBHOOK: invalid secret'
      );

      return res.sendStatus(403);
    }

    try {

      processClickMessage(
        req.body?.message
      );

      return res.sendStatus(200);

    } catch (error) {

      console.error(
        'TELEGRAM UPDATE ERROR:',
        error
      );

      return res.sendStatus(500);
    }
  }
);

// ======================================================
// ASOSIY SERVER
// ======================================================

app.get(
  '/',
  (req, res) => {

    res.json({

      ok: true,

      service:
        'click-payment-bot',

      mode:
        'telegram-webhook',

      expectedAmount:
        EXPECTED_AMOUNT,

      webhook:
        true,

      time:
        new Date().toISOString()
    });
  }
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  '/health',
  (req, res) => {

    res.json({

      ok: true,

      status:
        'online'
    });
  }
);

// ======================================================
// TO'LOV STATUSINI TEKSHIRISH
// ======================================================

app.get(
  '/status/:phone',
  (req, res) => {

    res.set(
      'Access-Control-Allow-Origin',
      '*'
    );

    res.set(
      'Cache-Control',
      'no-store'
    );

    const phone =
      normalizePhone(
        req.params.phone
      );

    const db =
      loadDb();

    const record =
      db.payments[phone];

    res.json({

      paid:
        Boolean(
          record &&
          record.status === 'paid'
        ),

      phone:
        phone,

      amount:
        record?.amount ??
        null,

      paidAt:
        record?.paidAt ??
        null,

      status:
        record?.status ??
        'unpaid'
    });
  }
);

// ======================================================
// BARCHA TO'LOVLAR
// ======================================================

app.get(
  '/api/payments',
  (req, res) => {

    res.set(
      'Cache-Control',
      'no-store'
    );

    const db =
      loadDb();

    const payments =
      Object.values(
        db.payments
      ).sort(
        (a, b) =>
          String(
            b.paidAt || ''
          ).localeCompare(
            String(
              a.paidAt || ''
            )
          )
      );

    res.json({

      success:
        true,

      count:
        payments.length,

      payments:
        payments
    });
  }
);

// ======================================================
// BITTA TO'LOV
// ======================================================

app.get(
  '/api/payment/:phone',
  (req, res) => {

    res.set(
      'Cache-Control',
      'no-store'
    );

    const phone =
      normalizePhone(
        req.params.phone
      );

    const db =
      loadDb();

    const payment =
      db.payments[phone] ||
      null;

    res.json({

      success:
        true,

      phone:
        phone,

      payment:
        payment
    });
  }
);

// ======================================================
// 404
// ======================================================

app.use(
  (req, res) => {

    res.status(404).json({

      ok:
        false,

      error:
        'Not found'
    });
  }
);

// ======================================================
// SERVER START
// ======================================================

const server =
  app.listen(
    PORT,
    '0.0.0.0',
    async () => {

      console.log(
        '=========================================='
      );

      console.log(
        'CLICK PAYMENT SERVER STARTED'
      );

      console.log(
        `PORT: ${PORT}`
      );

      console.log(
        `EXPECTED AMOUNT: ${EXPECTED_AMOUNT} so'm`
      );

      console.log(
        `ALLOWED CHAT: ${ALLOWED_CHAT_ID || 'ANY'}`
      );

      console.log(
        `PUBLIC URL: ${PUBLIC_URL}`
      );

      console.log(
        'MODE: TELEGRAM WEBHOOK ONLY'
      );

      console.log(
        'POLLING: DISABLED'
      );

      console.log(
        '=========================================='
      );

      try {

        await setupTelegramWebhook();

      } catch (error) {

        console.error(
          'TELEGRAM WEBHOOK SETUP ERROR:',
          error.message
        );

        console.error(
          'Server online, lekin Telegram webhook ishlamayapti.'
        );
      }
    }
  );

// ======================================================
// SERVERNI TO'G'RI YOPISH
// ======================================================

function shutdown(signal) {

  console.log(
    `Received ${signal}. Shutting down...`
  );

  server.close(
    () => process.exit(0)
  );

  setTimeout(
    () => process.exit(1),
    10000
  ).unref();
}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);
