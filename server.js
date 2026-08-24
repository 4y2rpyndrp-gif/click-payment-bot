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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_CHAT_ID = String(
  process.env.CLICK_GROUP_CHAT_ID || ""
);

// FAQAT SHU SUMMA QABUL QILINADI
const EXPECTED_AMOUNT = 412000;

// To'lovlar saqlanadigan fayl
const DB_FILE = path.join(__dirname, "payments.json");

// Render port
const PORT = process.env.PORT || 3000;


// =====================================================
// DATABASE
// =====================================================

function loadPayments() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return [];
    }

    const data = fs.readFileSync(DB_FILE, "utf8");

    if (!data.trim()) {
      return [];
    }

    return JSON.parse(data);
  } catch (error) {
    console.error("Database o'qishda xato:", error);
    return [];
  }
}

function savePayments(payments) {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(payments, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Database saqlashda xato:", error);
  }
}


// =====================================================
// SUMMANI ANIQLASH
// =====================================================

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[₽$€]/g, "")
    .replace(/,/g, " ")
    .trim();
}


function extractAmount(text) {
  const normalized = normalizeText(text);

  /*
    Quyidagilarning barchasi 412000 deb olinadi:

    412000
    412 000
    412 000 so'm
    412 000 сўм
    412 000 сум
    412000 so'm
  */

  const matches = normalized.match(/\b\d{1,3}(?:[\s.]?\d{3})+\b|\b\d{4,7}\b/g);

  if (!matches) {
    return null;
  }

  for (const item of matches) {
    const number = Number(
      item
        .replace(/\s/g, "")
        .replace(/\./g, "")
    );

    if (!Number.isNaN(number)) {
      return number;
    }
  }

  return null;
}


// =====================================================
// TELEFON / REF ANIQLASH
// =====================================================

function extractPhone(text) {
  const matches = String(text || "").match(/\+?\d[\d\s()-]{7,18}\d/g);

  if (!matches) {
    return null;
  }

  return matches[0]
    .replace(/[^\d+]/g, "")
    .trim();
}


function extractReference(text) {
  const normalized = String(text || "");

  // REF: +998...
  const refMatch = normalized.match(
    /(?:REF|ref|ID|id)\s*[:#-]?\s*([+\d][\d\s()-]{5,25})/
  );

  if (refMatch) {
    return refMatch[1]
      .replace(/[^\d+]/g, "")
      .trim();
  }

  // Telefon raqam bo'lsa
  return extractPhone(normalized);
}


// =====================================================
// TO'LOVNI TEKSHIRISH
// =====================================================

function registerPayment(messageText, messageId, chatId) {
  const text = String(messageText || "");

  const amount = extractAmount(text);

  console.log("======================================");
  console.log("Xabar matni:");
  console.log(text);
  console.log("Aniqlangan summa:", amount);

  // 412 000 BO'LMASA — TO'LOV HISOBLANMAYDI
  if (amount !== EXPECTED_AMOUNT) {
    console.log("❌ To'lov tasdiqlanmadi.");
    console.log("Sabab: summa 412 000 emas.");
    console.log("======================================");

    return {
      success: false,
      reason: "WRONG_AMOUNT",
      amount
    };
  }

  const reference = extractReference(text);

  if (!reference) {
    console.log("❌ REF/telefon topilmadi.");

    return {
      success: false,
      reason: "NO_REFERENCE",
      amount
    };
  }

  const payments = loadPayments();

  // Bir xil REF qayta kelgan bo'lsa ikkinchi marta ochilmaydi
  const alreadyPaid = payments.find(
    p => p.reference === reference
  );

  if (alreadyPaid) {
    console.log("⚠️ Bu REF oldin to'langan.");

    return {
      success: true,
      alreadyPaid: true,
      payment: alreadyPaid
    };
  }

  const payment = {
    id: Date.now().toString(),
    reference,
    amount: EXPECTED_AMOUNT,
    status: "paid",
    chatId: String(chatId),
    messageId: String(messageId),
    paidAt: new Date().toISOString(),
    testAccess: true
  };

  payments.push(payment);
  savePayments(payments);

  console.log("✅ 412 000 SO'M TO'LOV TASDIQLANDI");
  console.log("REF:", reference);
  console.log("TEST OCHILDI");
  console.log("======================================");

  return {
    success: true,
    alreadyPaid: false,
    payment
  };
}


// =====================================================
// TELEGRAM BOT
// =====================================================

let bot = null;

if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, {
    polling: true
  });

  console.log("Telegram bot ishga tushdi.");

  bot.on("message", async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const text = msg.text || msg.caption || "";

      console.log("");
      console.log("📩 Yangi Telegram xabar");
      console.log("Chat ID:", chatId);
      console.log("Title:", msg.chat.title || "");
      console.log("Text:", text);

      // Faqat belgilangan Click guruhidan
      if (
        ALLOWED_CHAT_ID &&
        chatId !== ALLOWED_CHAT_ID
      ) {
        console.log("⛔ Boshqa chat. E'tiborsiz qoldirildi.");
        return;
      }

      const result = registerPayment(
        text,
        msg.message_id,
        chatId
      );

      // Faqat REAL 412 000 to'lov bo'lsa javob
      if (result.success && result.payment) {
        try {
          await bot.sendMessage(
            msg.chat.id,
            "✅ TO'LOV TASDIQLANDI\n\n" +
            "💰 Summa: 412 000 so'm\n" +
            "🟢 Testga kirish ochildi.\n" +
            "🆔 REF: " + result.payment.reference
          );
        } catch (sendError) {
          console.error(
            "Telegram javob yuborishda xato:",
            sendError.message
          );
        }
      }

    } catch (error) {
      console.error(
        "Telegram message error:",
        error
      );
    }
  });

  bot.on("polling_error", (error) => {
    console.error(
      "Telegram polling error:",
      error.message
    );
  });

} else {
  console.log(
    "⚠️ TELEGRAM_BOT_TOKEN mavjud emas."
  );
}


// =====================================================
// API
// =====================================================

// Server ishlayotganini tekshirish
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "telegram-click-payment-bot",
    requiredAmount: EXPECTED_AMOUNT,
    currency: "UZS"
  });
});


// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "running"
  });
});


// =====================================================
// TO'LOVNI TEKSHIRISH
// =====================================================

app.get("/api/payment-status", (req, res) => {
  const ref = String(
    req.query.ref ||
    req.query.phone ||
    ""
  ).trim();

  if (!ref) {
    return res.status(400).json({
      success: false,
      paid: false,
      message: "REF yoki telefon raqam kerak."
    });
  }

  const normalizedRef = ref.replace(
    /[^\d+]/g,
    ""
  );

  const payments = loadPayments();

  const payment = payments.find(
    p =>
      p.reference === ref ||
      p.reference === normalizedRef
  );

  if (!payment) {
    return res.json({
      success: true,
      paid: false,
      amount: EXPECTED_AMOUNT
    });
  }

  if (
    payment.status === "paid" &&
    payment.amount === EXPECTED_AMOUNT
  ) {
    return res.json({
      success: true,
      paid: true,
      amount: EXPECTED_AMOUNT,
      testAccess: true,
      paymentId: payment.id
    });
  }

  return res.json({
    success: true,
    paid: false,
    amount: EXPECTED_AMOUNT
  });
});


// =====================================================
// BARCHA TO'LOVLAR
// =====================================================

app.get("/api/payments", (req, res) => {
  const payments = loadPayments();

  res.json({
    success: true,
    count: payments.length,
    payments
  });
});


// =====================================================
// SERVER
// =====================================================

app.listen(PORT, () => {
  console.log("");
  console.log("======================================");
  console.log("🚀 SERVER ISHLADI");
  console.log("💰 TALAB QILINADIGAN SUMMA: 412000");
  console.log("🌐 PORT:", PORT);
  console.log("======================================");
});
