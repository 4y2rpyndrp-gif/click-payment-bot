const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// ============================================================
// CONFIG
// ============================================================

const BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || ''
).trim();

const ALLOWED_CHAT_ID = String(
  process.env.CLICK_GROUP_CHAT_ID || ''
).trim();

const PUBLIC_URL = String(
  process.env.PUBLIC_URL ||
  'https://click-payment-bot.onrender.com'
).trim().replace(/\/$/, '');

const WEBHOOK_SECRET = String(
  process.env.TELEGRAM_WEBHOOK_SECRET ||
  crypto.randomBytes(32).toString('hex')
).trim();

const EXPECTED_AMOUNT = 412000;
const PORT = Number(process.env.PORT || 3000);

const DB_FILE = path.join(__dirname, 'payments.json');
const WEBHOOK_PATH = '/telegram/webhook';

if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN topilmadi');
}

if (!ALLOWED_CHAT_ID) {
  throw new Error('CLICK_GROUP_CHAT_ID topilmadi');
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT noto‘g‘ri');
}

// ============================================================
// DATABASE
// ============================================================

function emptyDb() {
  return {
    version: 1,
    payments: []
  };
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return emptyDb();
    }

    const raw = fs.readFileSync(
      DB_FILE,
      'utf8'
    );

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      !Array.isArray(parsed.payments)
    ) {
      return emptyDb();
    }

    return {
      version: Number(parsed.version) || 1,
      payments: parsed.payments
    };

  } catch (error) {
    console.error(
      'DB READ ERROR:',
      error.message
    );

    return emptyDb();
  }
}

function saveDb(db) {
  const tempFile = `${DB_FILE}.tmp`;

  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify(db, null, 2),
      'utf8'
    );

    fs.renameSync(
      tempFile,
      DB_FILE
    );

  } catch (error) {

    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (_) {}

    throw error;
  }
}

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeAmount(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const s = String(value)
    .replace(/[^0-9]/g, '');

  if (!s) {
    return null;
  }

  const n = Number(s);

  return Number.isSafeInteger(n)
    ? n
    : null;
}

function normalizePhone(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  const digits = String(value)
    .replace(/\D/g, '');

  if (
    digits.startsWith('998') &&
    digits.length === 12
  ) {
    return digits;
  }

  if (digits.length === 9) {
    return `998${digits}`;
  }

  return digits;
}

// ============================================================
// CLICK MESSAGE PARSER
// ============================================================

function extractAmount(text) {

  if (!text) {
    return null;
  }

  const normalized = String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '');

  const lines = normalized
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean);

  for (const line of lines) {

    if (
      !/(summa|сумма|amount|to.?lov|tolov|тўлов|төлов|mablag|маблаг)/iu
        .test(line)
    ) {
      continue;
    }

    const match = line.match(
      /(\d{1,3}(?:[\s.,]\d{3})+|\d{4,})\s*(?:so.?m|sum|сум|сўм|uzs)?/iu
    );

    if (match) {

      const amount =
        normalizeAmount(match[1]);

      if (amount !== null) {
        return amount;
      }
    }
  }

  const currencyMatch =
    normalized.match(
      /(\d{1,3}(?:[\s.,]\d{3})+|\d{4,})\s*(?:so.?m|sum|сум|сўм|uzs)\b/iu
    );

  return currencyMatch
    ? normalizeAmount(currencyMatch[1])
    : null;
}

function extractPhone(text) {

  if (!text) {
    return '';
  }

  const source = String(text)
    .replace(/\u00a0/g, ' ');

  const candidates =
    source.match(
      /(?:\+?998)[\s()\-\d]{9,}/g
    ) || [];

  for (const candidate of candidates) {

    const phone =
      normalizePhone(candidate);

    if (
      phone.length === 12 &&
      phone.startsWith('998')
    ) {
      return phone;
    }
  }

  const lines =
    source
      .split('\n')
      .map(x => x.trim());

  for (const line of lines) {

    if (
      !/(id|telefon|phone|номер|телефон)/iu
        .test(line)
    ) {
      continue;
    }

    const match =
      line.match(
        /(?:\D|^)(\d{9})(?:\D|$)/
      );

    if (match) {
      return `998${match[1]}`;
    }
  }

  return '';
}

function hasSuccessfulStatus(text) {

  if (!text) {
    return false;
  }

  const s =
    String(text).toLowerCase();

  return [
    'успешно подтвержден',
    'успешно подтверждено',
    'успешно подтверждена',
    'muvaffaqiyatli tasdiqlandi',
    'muvaffaqiyatli'
  ].some(word =>
    s.includes(word)
  );
}

function parseClickPayment(text) {

  if (!text) {
    return null;
  }

  if (!hasSuccessfulStatus(text)) {
    return null;
  }

  const amount =
    extractAmount(text);

  if (amount !== EXPECTED_AMOUNT) {
    return null;
  }

  const phone =
    extractPhone(text);

  if (!phone) {
    return null;
  }

  return {
    phone,
    amount: EXPECTED_AMOUNT,
    currency: 'UZS'
  };
}

// ============================================================
// TELEGRAM
// ============================================================

const bot = new TelegramBot(
  BOT_TOKEN,
  {
    polling: false
  }
);

function isAllowedChat(msg) {

  return String(
    msg?.chat?.id || ''
  ) === ALLOWED_CHAT_ID;
}

function getMessageText(msg) {

  return String(
    msg?.text ||
    msg?.caption ||
    ''
  ).trim();
}

function paymentExistsByTelegramMessage(
  db,
  msg
) {

  return db.payments.some(p =>
    p.chatId ===
      String(msg.chat.id) &&
    p.messageId ===
      Number(msg.message_id)
  );
}

function paymentExistsByPhone(
  db,
  phone
) {

  return db.payments.some(p =>
    p.status === 'paid' &&
    p.phone === phone &&
    p.amount === EXPECTED_AMOUNT
  );
}

function recordPayment(
  msg,
  payment
) {

  const db = loadDb();

  if (
    paymentExistsByTelegramMessage(
      db,
      msg
    )
  ) {

    console.log(
      'DUPLICATE: Telegram message already processed'
    );

    return false;
  }

  if (
    paymentExistsByPhone(
      db,
      payment.phone
    )
  ) {

    console.log(
      'DUPLICATE: phone already has a paid record'
    );

    return false;
  }

  const record = {

    id: crypto.randomUUID(),

    phone:
      payment.phone,

    amount:
      EXPECTED_AMOUNT,

    currency:
      'UZS',

    status:
      'paid',

    consumed:
      false,

    chatId:
      String(msg.chat.id),

    chatTitle:
      msg.chat.title ||
      msg.chat.username ||
      '',

    messageId:
      Number(msg.message_id),

    createdAt:
      new Date().toISOString(),

    sourceText:
      getMessageText(msg)

  };

  db.payments.push(record);

  saveDb(db);

  console.log(
    '========================================'
  );

  console.log(
    'PAYMENT VERIFIED'
  );

  console.log(
    'PHONE:',
    payment.phone
  );

  console.log(
    'AMOUNT:',
    EXPECTED_AMOUNT
  );

  console.log(
    'MESSAGE ID:',
    msg.message_id
  );

  console.log(
    '========================================'
  );

  return true;
}

async function handleTelegramUpdate(
  update
) {

  const msg =
    update?.message;

  if (!msg) {
    return;
  }

  if (!isAllowedChat(msg)) {

    console.log(
      'Ignored message from chat:',
      msg.chat?.id
    );

    return;
  }

  const text =
    getMessageText(msg);

  if (!text) {
    return;
  }

  console.log(
    'CLICK GROUP MESSAGE:',
    text
  );

  const payment =
    parseClickPayment(text);

  if (!payment) {

    console.log(
      'Not a valid 412000 UZS successful payment.'
    );

    return;
  }

  try {

    recordPayment(
      msg,
      payment
    );

  } catch (error) {

    console.error(
      'PAYMENT SAVE ERROR:',
      error.message
    );
  }
}

// ============================================================
// TELEGRAM WEBHOOK
// ============================================================

app.post(
  WEBHOOK_PATH,
  (req, res) => {

    const incomingSecret =
      String(
        req.get(
          'X-Telegram-Bot-Api-Secret-Token'
        ) || ''
      );

    if (
      incomingSecret !==
      WEBHOOK_SECRET
    ) {
      return res.sendStatus(401);
    }

    res.sendStatus(200);

    handleTelegramUpdate(
      req.body
    ).catch(error => {

      console.error(
        'WEBHOOK UPDATE ERROR:',
        error
      );

    });
  }
);

// ============================================================
// PAYMENT STATUS API
// ============================================================

app.get(
  '/payment-status',
  (req, res) => {

    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    res.setHeader(
      'Pragma',
      'no-cache'
    );

    res.setHeader(
      'Expires',
      '0'
    );

    try {

      const phone =
        normalizePhone(
          req.query.phone
        );

      if (
        !phone ||
        phone.length !== 12 ||
        !phone.startsWith('998')
      ) {

        return res.status(400).json({

          paid: false,

          amount: 0,

          error:
            'Telefon raqami noto‘g‘ri'

        });
      }

      const db =
        loadDb();

      let index = -1;

      for (
        let i = db.payments.length - 1;
        i >= 0;
        i--
      ) {

        const p =
          db.payments[i];

        if (
          p.status === 'paid' &&
          p.amount === EXPECTED_AMOUNT &&
          p.phone === phone &&
          p.consumed !== true
        ) {

          index = i;

          break;
        }
      }

      if (index === -1) {

        return res.json({

          paid: false,

          amount: 0,

          expectedAmount:
            EXPECTED_AMOUNT,

          currency:
            'UZS'

        });
      }

      db.payments[index]
        .consumed = true;

      db.payments[index]
        .consumedAt =
        new Date().toISOString();

      saveDb(db);

      return res.json({

        paid: true,

        amount:
          EXPECTED_AMOUNT,

        currency:
          'UZS',

        ref:
          phone

      });

    } catch (error) {

      console.error(
        'PAYMENT STATUS ERROR:',
        error.message
      );

      return res.status(500).json({

        paid: false,

        amount: 0,

        error:
          'Server xatosi'

      });
    }
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  '/',
  (req, res) => {

    res.json({

      ok: true,

      service:
        'click-payment-gate',

      expectedAmount:
        EXPECTED_AMOUNT,

      currency:
        'UZS'

    });
  }
);

app.get(
  '/health',
  (req, res) => {

    res.json({

      ok: true,

      webhook: true,

      expectedAmount:
        EXPECTED_AMOUNT

    });
  }
);

// ============================================================
// WEBHOOK SETUP
// ============================================================

async function configureWebhook() {

  const webhookUrl =
    `${PUBLIC_URL}${WEBHOOK_PATH}`;

  console.log(
    'Configuring Telegram webhook:',
    webhookUrl
  );

  await bot.setWebHook(
    webhookUrl,
    {
      secret_token:
        WEBHOOK_SECRET,

      drop_pending_updates:
        false
    }
  );

  const info =
    await bot.getWebhookInfo();

  console.log(
    'Telegram webhook URL:',
    info.url || '(empty)'
  );

  console.log(
    'Telegram pending updates:',
    info.pending_update_count || 0
  );

  if (
    info.last_error_message
  ) {

    console.log(
      'Telegram webhook last error:',
      info.last_error_message
    );
  }
}

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  async () => {

    console.log(
      '========================================'
    );

    console.log(
      'CLICK PAYMENT SERVER STARTED'
    );

    console.log(
      'PORT:',
      PORT
    );

    console.log(
      'EXPECTED AMOUNT:',
      EXPECTED_AMOUNT
    );

    console.log(
      'ALLOWED CHAT:',
      ALLOWED_CHAT_ID
    );

    console.log(
      'PUBLIC URL:',
      PUBLIC_URL
    );

    console.log(
      'WEBHOOK:',
      `${PUBLIC_URL}${WEBHOOK_PATH}`
    );

    console.log(
      '========================================'
    );

    try {

      await configureWebhook();

      console.log(
        'TELEGRAM WEBHOOK: READY'
      );

    } catch (error) {

      console.error(
        'TELEGRAM WEBHOOK SETUP ERROR:',
        error.message
      );
    }
  }
);
