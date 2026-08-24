// ============================================================
// TELEGRAM CLICK PAYMENT BOT
// FAQAT 412 000 SO'M TO'LOVNI TASDIQLAYDI
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// ============================================================
// SOZLAMALAR
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ALLOWED_CHAT_ID = String(process.env.CLICK_GROUP_CHAT_ID || '');

const EXPECTED_AMOUNT = 412000;

// To'lovlar saqlanadigan fayl
const DB_FILE = path.join(__dirname, 'payments.json');

// Render porti
const PORT = process.env.PORT || 3000;


// ============================================================
// TOKEN TEKSHIRISH
// ============================================================

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN topilmadi!');
    process.exit(1);
}

if (!ALLOWED_CHAT_ID) {
    console.error('❌ CLICK_GROUP_CHAT_ID topilmadi!');
    process.exit(1);
}


// ============================================================
// DATABASE
// ============================================================

function loadDb() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            return {
                payments: []
            };
        }

        const data = JSON.parse(
            fs.readFileSync(DB_FILE, 'utf8')
        );

        if (!data.payments || !Array.isArray(data.payments)) {
            return {
                payments: []
            };
        }

        return data;

    } catch (error) {
        console.error('❌ DB o‘qishda xato:', error.message);

        return {
            payments: []
        };
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
        console.error('❌ DB saqlashda xato:', error.message);
    }
}


// ============================================================
// SUMMANI TOZALASH
// ============================================================

// Masalan:
// "412 000"  -> 412000
// "412,000"  -> 412000
// "412.000"  -> 412000
// "412000"   -> 412000

function normalizeAmount(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const digits = String(value).replace(/[^\d]/g, '');

    if (!digits) {
        return null;
    }

    const amount = Number(digits);

    if (!Number.isFinite(amount)) {
        return null;
    }

    return amount;
}


// ============================================================
// CLICK XABARIDAN SUMMANI TOPISH
// ============================================================

function extractAmount(text) {

    if (!text) {
        return null;
    }

    const normalizedText = String(text)
        .replace(/\u00A0/g, ' ')
        .replace(/₽/g, ' ')
        .trim();


    // --------------------------------------------------------
    // 1. AVVAL "SUMMA" QATORINI QIDIRAMIZ
    // --------------------------------------------------------

    const lines = normalizedText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);


    for (const line of lines) {

        // Faqat summa/to'lov/mablag' kabi qatorlardan izlaymiz
        const isAmountLine =
            /(?:summa|сумма|to.?lov|tolov|төлов|mablag|маблаг|amount|click)/i.test(line) ||
            /(?:💰|💵|💳)/u.test(line);

        if (!isAmountLine) {
            continue;
        }


        // 412 000 so'm
        // 412000 so'm
        // 412,000 сум
        // 412.000 сум
        const match = line.match(
            /(\d{1,3}(?:[\s.,]\d{3})+|\d{4,})(?:\s*(?:so.?m|sum|сум|сўм|uzs))?/iu
        );

        if (match) {

            const amount = normalizeAmount(match[1]);

            if (amount !== null) {
                return amount;
            }
        }
    }


    // --------------------------------------------------------
    // 2. AGAR YUQORIDAGI USUL TOPMASA,
    //    FAQAT VALYUTA BILAN YOZILGAN SUMMANI QIDIRAMIZ
    // --------------------------------------------------------

    const currencyMatches = normalizedText.matchAll(
        /(\d{1,3}(?:[\s.,]\d{3})+|\d{4,})\s*(?:so.?m|sum|сум|сўм|uzs)\b/giu
    );

    for (const match of currencyMatches) {

        const amount = normalizeAmount(match[1]);

        if (amount !== null) {
            return amount;
        }
    }


    return null;
}


// ============================================================
// CLICK XABARINI TEKSHIRISH
// ============================================================

function isSuccessfulClickPayment(text) {

    if (!text) {
        return false;
    }

    const lower = String(text).toLowerCase();


    // Click muvaffaqiyatli to'lov xabarlarida
    // quyidagi iboralardan biri bo'lishi kerak.

    const successWords = [
        'muvaffaqiyatli tasdiqlandi',
        'успешно подтвержден',
        'успешно подтверждено',
        'successful',
        'successfully',
        'muvaffaqiyatli'
    ];

    const hasSuccessWord = successWords.some(word =>
        lower.includes(word)
    );


    if (!hasSuccessWord) {
        return false;
    }


    // Faqat 412000
    const amount = extractAmount(text);

    if (amount !== EXPECTED_AMOUNT) {
        return false;
    }


    return true;
}


// ============================================================
// REF / TELEFON / ID TOPISH
// ============================================================

function extractReference(text) {

    if (!text) {
        return null;
    }


    // Telefon raqam
    const phoneMatch = text.match(
        /(?:\+998|998)\s*[\d\s\-()]{9,}/
    );

    if (phoneMatch) {

        const phone = phoneMatch[0]
            .replace(/[^\d+]/g, '');

        return phone;
    }


    // ID
    const idMatch = text.match(
        /(?:id|ID|🆔)\s*[:\-]?\s*(\d{5,})/u
    );

    if (idMatch) {
        return idMatch[1];
    }


    return null;
}


// ============================================================
// CLICK XABARINI TAHLIL QILISH
// ============================================================

function parseClickMessage(text) {

    if (!text) {
        return null;
    }


    // Faqat muvaffaqiyatli to'lov
    if (!isSuccessfulClickPayment(text)) {
        return null;
    }


    const amount = extractAmount(text);

    // Juda muhim:
    // summa AYNAN 412000 bo'lishi kerak.
    if (amount !== EXPECTED_AMOUNT) {
        return null;
    }


    const ref = extractReference(text);


    return {
        ref: ref,
        amount: amount,
        currency: 'UZS',
        status: 'paid',
        originalText: text
    };
}


// ============================================================
// DATABASE'DA DUPLIKATNI TEKSHIRISH
// ============================================================

function paymentAlreadyExists(db, payment, message) {

    // Telegram message ID orqali tekshirish
    if (
        message &&
        message.chat &&
        message.message_id
    ) {

        const existsByMessageId = db.payments.find(item =>
            item.chatId === String(message.chat.id) &&
            item.messageId === message.message_id
        );

        if (existsByMessageId) {
            return true;
        }
    }


    // Agar telefon/ref bo'lsa,
    // bir xil ref bilan oldin to'lov o'tganini tekshiramiz.
    if (payment.ref) {

        const existsByRef = db.payments.find(item =>
            item.ref === payment.ref &&
            item.amount === EXPECTED_AMOUNT &&
            item.status === 'paid'
        );

        if (existsByRef) {
            return true;
        }
    }


    return false;
}


// ============================================================
// TELEGRAM BOT
// ============================================================

const bot = new TelegramBot(
    BOT_TOKEN,
    {
        polling: true
    }
);


// ============================================================
// TELEGRAM XATOLAR
// ============================================================

bot.on('polling_error', (error) => {

    console.error(
        '❌ TELEGRAM POLLING ERROR:',
        error.response?.body || error.message
    );

});


// ============================================================
// HAR BIR TELEGRAM XABARINI QABUL QILISH
// ============================================================

bot.on('message', async (msg) => {

    try {

        // Chat ID
        const chatId = String(msg.chat.id);

        // Chat nomi
        const chatTitle = msg.chat.title || msg.chat.username || '';


        console.log(
            '📩 Xabar keldi:',
            'chat_id =',
            chatId,
            '|',
            'title =',
            chatTitle
        );


        // ----------------------------------------------------
        // FAQAT KERAKLI GROUP'DAN XABAR QABUL QILAMIZ
        // ----------------------------------------------------

        if (chatId !== ALLOWED_CHAT_ID) {

            console.log(
                '⚠️ Boshqa chat. O‘tkazib yuborildi:',
                chatId
            );

            return;
        }


        // ----------------------------------------------------
        // MATN
        // ----------------------------------------------------

        const text = msg.text || msg.caption || '';


        if (!text) {
            return;
        }


        console.log('📝 Xabar matni:');
        console.log(text);


        // ----------------------------------------------------
        // CLICK XABARINI TAHLIL QILAMIZ
        // ----------------------------------------------------

        const payment = parseClickMessage(text);


        // Oddiy xabar yoki noto'g'ri summa
        if (!payment) {

            console.log(
                '❌ To‘lov tasdiqlanmadi.'
            );

            return;
        }


        console.log(
            '💰 Aniqlangan summa:',
            payment.amount
        );


        // ----------------------------------------------------
        // DATABASE
        // ----------------------------------------------------

        const db = loadDb();


        // ----------------------------------------------------
        // DUPLIKAT
        // ----------------------------------------------------

        if (paymentAlreadyExists(db, payment, msg)) {

            console.log(
                '⚠️ Bu to‘lov oldin hisoblangan.'
            );

            return;
        }


        // ----------------------------------------------------
        // TO‘LOVNI SAQLAYMIZ
        // ----------------------------------------------------

        const record = {

            id: Date.now(),

            ref: payment.ref,

            amount: EXPECTED_AMOUNT,

            currency: 'UZS',

            status: 'paid',

            chatId: chatId,

            chatTitle: chatTitle,

            messageId: msg.message_id,

            date: new Date().toISOString(),

            text: text
        };


        db.payments.push(record);

        saveDb(db);


        // ----------------------------------------------------
        // NATIJA
        // ----------------------------------------------------

        console.log('');
        console.log('========================================');
        console.log('✅ TO‘LOV TASDIQLANDI');
        console.log('💰 SUMMA: 412 000 SO‘M');
        console.log('📱 REF:', payment.ref || 'topilmadi');
        console.log('🆔 MESSAGE ID:', msg.message_id);
        console.log('========================================');
        console.log('');


    } catch (error) {

        console.error(
            '❌ MESSAGE HANDLER ERROR:',
            error
        );
    }

});


// ============================================================
// /START
// ============================================================

bot.onText(/^\/start$/i, async (msg) => {

    try {

        await bot.sendMessage(
            msg.chat.id,
            '✅ Bot ishlayapti.\n\nFaqat 412 000 so‘mlik Click to‘lovlari hisoblanadi.'
        );

    } catch (error) {

        console.error(
            '❌ /start xatosi:',
            error.message
        );
    }

});


// ============================================================
// /STATUS
// ============================================================

bot.onText(/^\/status$/i, async (msg) => {

    try {

        const db = loadDb();

        const totalPayments = db.payments.length;

        const totalAmount =
            totalPayments * EXPECTED_AMOUNT;


        await bot.sendMessage(
            msg.chat.id,
            [
                '📊 TO‘LOV HISOBOTI',
                '',
                `✅ To‘lovlar: ${totalPayments} ta`,
                `💰 Har bir to‘lov: 412 000 so‘m`,
                `💵 Jami: ${totalAmount.toLocaleString('uz-UZ')} so‘m`
            ].join('\n')
        );

    } catch (error) {

        console.error(
            '❌ /status xatosi:',
            error.message
        );
    }

});


// ============================================================
// /PAYMENTS
// ============================================================

bot.onText(/^\/payments$/i, async (msg) => {

    try {

        const db = loadDb();

        if (db.payments.length === 0) {

            await bot.sendMessage(
                msg.chat.id,
                'Hozircha 412 000 so‘mlik tasdiqlangan to‘lov yo‘q.'
            );

            return;
        }


        const lastPayments = db.payments
            .slice(-20)
            .reverse();


        let response = '💰 OXIRGI TO‘LOVLAR\n\n';


        lastPayments.forEach((payment, index) => {

            response +=
                `${index + 1}. ` +
                `412 000 so‘m\n` +
                `📱 ${payment.ref || 'Noma’lum'}\n` +
                `🕐 ${payment.date}\n\n`;

        });


        await bot.sendMessage(
            msg.chat.id,
            response
        );

    } catch (error) {

        console.error(
            '❌ /payments xatosi:',
            error.message
        );
    }

});


// ============================================================
// WEB SERVER
// ============================================================

app.get('/', (req, res) => {

    res.send(
        'Bot ishlayapti. Faqat 412 000 so‘mlik Click to‘lovlar hisoblanadi.'
    );

});


// ============================================================
// STATUS API
// ============================================================

app.get('/status', (req, res) => {

    try {

        const db = loadDb();

        const totalPayments = db.payments.length;

        const totalAmount =
            totalPayments * EXPECTED_AMOUNT;


        res.json({

            ok: true,

            paid: totalPayments,

            amountPerPayment: EXPECTED_AMOUNT,

            totalAmount: totalAmount,

            currency: 'UZS'

        });

    } catch (error) {

        res.status(500).json({

            ok: false,

            error: error.message

        });

    }

});


// ============================================================
// PAYMENTS API
// ============================================================

app.get('/payments', (req, res) => {

    try {

        const db = loadDb();

        res.json({

            ok: true,

            count: db.payments.length,

            expectedAmount: EXPECTED_AMOUNT,

            payments: db.payments

        });

    } catch (error) {

        res.status(500).json({

            ok: false,

            error: error.message

        });

    }

});


// ============================================================
// SERVER
// ============================================================

app.listen(PORT, () => {

    console.log('');
    console.log('========================================');
    console.log('🚀 SERVER ISHLAYAPTI');
    console.log('========================================');
    console.log('PORT:', PORT);
    console.log('EXPECTED AMOUNT:', EXPECTED_AMOUNT);
    console.log('ALLOWED CHAT:', ALLOWED_CHAT_ID);
    console.log('========================================');
    console.log('');

});
