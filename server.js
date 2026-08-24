const express = require("express");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// SOZLAMALAR
// =====================================================

const BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || ""
).trim();

const ALLOWED_CHAT_ID = String(
  process.env.CLICK_GROUP_CHAT_ID || ""
).trim();

// FAQAT SHU SUMMA QABUL QILINADI
const EXPECTED_AMOUNT = 412000;

// To'lovlar bazasi
const DB_FILE = path.join(__dirname, "payments.json");

// Render porti
const PORT = Number(process.env.PORT) || 3000;


// =====================================================
// DATABASE
// =====================================================

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return {};
    }

    const data = fs.readFileSync(DB_FILE, "utf8");

    if (!data.trim()) {
      return {};
    }

    const db = JSON.parse(data);

    if (!db || typeof db !== "object") {
      return {};
    }

    return db;

  } catch (error) {
    console.log(
      "Database o'qishda xato:",
      error.message
    );

    return {};
  }
}


function saveDb(db) {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    return true;

  } catch (error) {
    console.log(
      "Database saqlashda xato:",
      error.message
    );

    return false;
  }
}


// =====================================================
// SUMMANI NORMALIZATSIYA QILISH
// =====================================================

function normalizeAmount(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  let text = String(value)
    .replace(/\u00A0/g, " ")
    .replace(/\u202F/g, " ")
    .trim();

  // Faqat raqam, nuqta, vergul va bo'sh joy
  text = text.replace(/[^\d.,\s]/g, "");

  // Barcha bo'sh joylarni olib tashlash
  text = text.replace(/\s/g, "");

  if (!text) {
    return null;
  }


  // 412,000.00
  // 412.000,00
  if (
    text.includes(",") &&
    text.includes(".")
  ) {

    const lastComma =
      text.lastIndexOf(",");

    const lastDot =
      text.lastIndexOf(".");

    if (lastComma > lastDot) {

      // 412.000,00
      text = text
        .replace(/\./g, "")
        .replace(",", ".");

    } else {

      // 412,000.00
      text = text.replace(/,/g, "");
    }

  }

  // 412,000
  else if (text.includes(",")) {

    const parts = text.split(",");

    if (
      parts.length === 2 &&
      parts[1].length === 3
    ) {

      // 412,000
      text = parts[0] + parts[1];

    } else {

      // 412,00
      text = text.replace(/,/g, ".");
    }
  }

  // 412.000
  else if (text.includes(".")) {

    const parts = text.split(".");

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
// VALYUTA QATORINI TEKSHIRISH
// =====================================================

function isCurrencyLine(line) {

  if (!line) {
    return false;
  }

  const text = String(line).toLowerCase();

  return (
    text.includes("сум") ||
    text.includes("сўм") ||
    text.includes("сом") ||
    /so['’‘`ʼʻ]?m/i.test(text)
  );
}


// =====================================================
// MUVAFFAQIYATLI CLICK TO'LOVNI TEKSHIRISH
// =====================================================

function isSuccessfulPayment(text) {

  if (!text) {
    return false;
  }

  const normalized = String(text)
    .replace(/\u00A0/g, " ")
    .replace(/\u202F/g, " ")
    .replace(/\r/g, "")
    .trim();

  // Click xabarlaridagi muvaffaqiyat holatlari
  return (
    /успешно\s+подтвержден/i.test(normalized) ||
    /успешно\s+подтверждён/i.test(normalized) ||
    /успешно\s+подтверждено/i.test(normalized)
  );
}


// =====================================================
// CLICK XABARINI TAHLIL QILISH
// =====================================================

function parseClickMessage(text) {

  if (!text) {
    return null;
  }

  const rawText = String(text)
    .replace(/\u00A0/g, " ")
    .replace(/\u202F/g, " ")
    .trim();

  // -----------------------------------------------
  // 1. MUVAFFAQIYATLI TO'LOV BO'LISHI SHART
  // -----------------------------------------------

  if (!isSuccessfulPayment(rawText)) {
    return null;
  }


  // -----------------------------------------------
  // 2. CLICK XABARIDA "PARAMETRLAR OPATЫ" BO'LISHI SHART
  // -----------------------------------------------

  if (
    !/параметры\s+оплаты/i.test(rawText)
  ) {
    return null;
  }


  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);


  // -----------------------------------------------
  // 3. PARAMETRLAR QATORINI TOPISH
  // -----------------------------------------------

  const paramIdx = lines.findIndex(
    line =>
      /параметры\s+оплаты/i.test(line)
  );


  let ref = null;


  // -----------------------------------------------
  // 4. PARAMETRLARDAN TELEFON / ID TOPISH
  // -----------------------------------------------

  if (paramIdx !== -1) {

    const possibleLines =
      lines.slice(
        paramIdx + 1,
        paramIdx + 6
      );

    for (const line of possibleLines) {

      // Telefon raqami bo'lsa
      const phoneMatch =
        line.match(
          /\+?\d[\d\s().-]{7,}\d/
        );

      if (phoneMatch) {

        ref = phoneMatch[0]
          .trim();

        break;
      }


      // Agar telefon ID ko'rinishida bo'lsa
      const cleanDigits =
        line.replace(
          /[^0-9]/g,
          ""
        );

      if (
        cleanDigits.length >= 9 &&
        cleanDigits.length <= 15
      ) {

        ref = cleanDigits;

        break;
      }
    }
  }


  // -----------------------------------------------
  // 5. SUMMANI TOPISH
  // -----------------------------------------------

  let amount = null;
  let amountLine = null;


  for (const line of lines) {

    if (!isCurrencyLine(line)) {
      continue;
    }


    // Qatordagi raqamlarni olish
    const numberMatches =
      line.match(
        /\d[\d\s.,]*/g
      );


    if (
      !numberMatches ||
      !numberMatches.length
    ) {
      continue;
    }


    // Currency qatoridagi birinchi raqam
    for (const candidate of numberMatches) {

      const detectedAmount =
        normalizeAmount(candidate);

      if (
        detectedAmount !== null
      ) {

        amount =
          detectedAmount;

        amountLine =
          line;

        break;
      }
    }


    if (amount !== null) {
      break;
    }
  }


  // -----------------------------------------------
  // 6. NATIJA
  // -----------------------------------------------

  return {
    ref,
    amount,
    amountLine
  };
}


// =====================================================
// TELEGRAM BOT
// =====================================================

let bot = null;

if (!BOT_TOKEN) {

  console.log(
    "OGOHLANTIRISH: TELEGRAM_BOT_TOKEN topilmadi."
  );

} else {

  bot = new TelegramBot(
    BOT_TOKEN,
    {
      polling: {
        autoStart: false
      }
    }
  );


  // -----------------------------------------------
  // POLLING ERROR
  // -----------------------------------------------

  bot.on(
    "polling_error",
    error => {

      console.log(
        "Telegram polling error:",
        error.message
      );

    }
  );


  // -----------------------------------------------
  // TELEGRAM MESSAGE
  // -----------------------------------------------

  bot.on(
    "message",
    msg => {

      try {

        // -----------------------------------------
        // FAQAT KERAKLI GURUH
        // -----------------------------------------

        if (
          ALLOWED_CHAT_ID &&
          String(msg.chat.id) !==
            ALLOWED_CHAT_ID
        ) {

          return;
        }


        const text =
          msg.text || "";


        console.log("");
        console.log(
          "========================================"
        );

        console.log(
          "YANGI TELEGRAM XABAR"
        );

        console.log(
          "Chat ID:",
          msg.chat.id
        );

        console.log(
          "Chat title:",
          msg.chat.title || ""
        );

        console.log(
          "Xabar:",
          text
        );

        console.log(
          "========================================"
        );


        // -----------------------------------------
        // CLICK XABARINI PARSE QILISH
        // -----------------------------------------

        const parsed =
          parseClickMessage(text);


        if (!parsed) {

          console.log(
            "❌ Click to'lovi sifatida qabul qilinmadi."
          );

          return;
        }


        console.log(
          "Aniqlangan REF:",
          parsed.ref
        );

        console.log(
          "Aniqlangan summa:",
          parsed.amount
        );

        console.log(
          "Summa qatori:",
          parsed.amountLine
        );


        // -----------------------------------------
        // REF / TELEFON SHART
        // -----------------------------------------

        if (!parsed.ref) {

          console.log(
            "❌ Telefon/ref topilmadi."
          );

          return;
        }


        const phoneDigits =
          parsed.ref.replace(
            /[^0-9]/g,
            ""
          );


        if (!phoneDigits) {

          console.log(
            "❌ Telefon raqami topilmadi."
          );

          return;
        }


        // -----------------------------------------
        // ENG MUHIM TEKSHIRUV
        //
        // FAQAT 412 000 SO'M
        // -----------------------------------------

        if (
          parsed.amount !==
          EXPECTED_AMOUNT
        ) {

          console.log("");
          console.log(
            "❌ TO'LOV TASDIQLANMADI"
          );

          console.log(
            "Kelgan summa:",
            parsed.amount
          );

          console.log(
            "Kerakli summa:",
            EXPECTED_AMOUNT
          );

          console.log(
            "Sabab: summa aynan 412 000 so'm emas."
          );

          console.log("");

          return;
        }


        // -----------------------------------------
        // DATABASE
        // -----------------------------------------

        const db =
          loadDb();


        // -----------------------------------------
        // FAQAT 412 000 BO'LSA SAQLAYMIZ
        // -----------------------------------------

        db[phoneDigits] = {

          status: "paid",

          amount:
            EXPECTED_AMOUNT,

          paidAt:
            new Date().toISOString(),

          source:
            "click-telegram"
        };


        const saved =
          saveDb(db);


        if (!saved) {

          console.log(
            "❌ To'lovni databasega saqlab bo'lmadi."
          );

          return;
        }


        // -----------------------------------------
        // TASDIQLANGAN
        // -----------------------------------------

        console.log("");
        console.log(
          "========================================"
        );

        console.log(
          "✅ TO'LOV TASDIQLANDI"
        );

        console.log(
          "Telefon:",
          phoneDigits
        );

        console.log(
          "Summa:",
          EXPECTED_AMOUNT
        );

        console.log(
          "========================================"
        );

        console.log("");

      } catch (error) {

        console.log(
          "❌ Xabarni qayta ishlashda xato:",
          error.message
        );
      }
    }
  );


  // -----------------------------------------------
  // TELEGRAM POLLINGNI BOSHLASH
  // -----------------------------------------------

  bot.startPolling()
    .then(() => {

      console.log(
        "Telegram bot polling ishga tushdi."
      );

    })
    .catch(error => {

      console.log(
        "Telegram pollingni ishga tushirishda xato:",
        error.message
      );

    });
}


// =====================================================
// STATUS API
// =====================================================
//
// Test sayti:
// /status/998901234567
//
// paid:true  -> 412 000 to'langan
// paid:false -> to'lanmagan
// =====================================================

app.get(
  "/status/:phone",
  (req, res) => {

    res.set(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.set(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );


    const phone =
      String(req.params.phone || "")
        .replace(
          /[^0-9]/g,
          ""
        );


    if (!phone) {

      return res.json({
        paid: false,
        amount: EXPECTED_AMOUNT
      });
    }


    const db =
      loadDb();


    const record =
      db[phone];


    // FAQAT AYNAN 412000
    const isPaid =
      !!(
        record &&
        record.status === "paid" &&
        Number(record.amount) ===
          EXPECTED_AMOUNT
      );


    return res.json({

      paid:
        isPaid,

      amount:
        EXPECTED_AMOUNT

    });
  }
);


// =====================================================
// HOME
// =====================================================

app.get(
  "/",
  (req, res) => {

    res.send(
      "Payment verification server ishlamoqda."
    );
  }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
  "/health",
  (req, res) => {

    res.json({
      ok: true,
      expectedAmount:
        EXPECTED_AMOUNT
    });
  }
);


// =====================================================
// SERVER
// =====================================================

app.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      "✅ SERVER ISHLADI"
    );

    console.log(
      "Kerakli summa: 412000 so'm"
    );

    console.log(
      "Faqat aynan 412000 qabul qilinadi."
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "========================================"
    );
  }
);
