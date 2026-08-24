# Telegram bot orqali to'lovni avtomatik tasdiqlash — o'rnatish

Bu yechim Click'ning maxfiy kalitini (secret_key) TALAB QILMAYDI.
Faqat sizda mavjud narsalardan foydalanadi: pay-havola va Click
avtomatik yozib turadigan Telegram guruhingiz.

## Qanday ishlaydi

1. Mijoz to'lov qiladi (avvalgidek, o'zgarish yo'q)
2. Click, odatdagidek, sizning guruhingizga "Успешно подтвержден" xabarini yuboradi
3. Bizning bot shu guruh a'zosi bo'lgani uchun xabarni o'qiydi va ichidan
   telefon raqami va summani ajratib oladi
4. Agar summa 412 000 so'm bo'lsa — o'sha telefon raqami "to'landi" deb belgilanadi
5. Test sahifasi shu ma'lumotni so'rab turadi va avtomatik ochiladi

Hech kim tugma bosmaydi.

## 1-qadam — Bot yarating (2 daqiqa)

1. Telegram'da **@BotFather** ga yozing
2. `/newbot` buyrug'ini yuboring, botga nom bering
3. Sizga **token** beradi (masalan `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`) — buni saqlab qo'ying

## 2-qadam — Botning "maxfiylik rejimini" o'chiring (MUHIM)

Standart holatda botlar guruhdagi barcha xabarlarni emas, faqat o'ziga
qaratilgan xabarlarni ko'radi. Buni o'chirish kerak:

1. @BotFather ga qayting → `/mybots` → botingizni tanlang
2. **Bot Settings** → **Group Privacy** → **Turn off**

## 3-qadam — Botni Click guruhiga qo'shing

Botingizni (masalan `@sizning_bot`) Click bildirishnomalari keladigan
o'sha Telegram guruhga oddiy a'zo sifatida qo'shing.

## 4-qadam — Serverni joylashtiring (Render.com, bepul reja yetarli)

1. https://render.com — ro'yxatdan o'ting
2. "New Web Service" → shu papkadagi fayllarni (`server.js`, `package.json`)
   GitHub repo orqali yoki manual upload orqali yuklang
3. Build command: `npm install`   Start command: `npm start`
4. Environment o'zgaruvchilar qo'shing:
   - `TELEGRAM_BOT_TOKEN` = 1-qadamda olgan token
   - `CLICK_GROUP_CHAT_ID` = hozircha bo'sh qoldiring (5-qadamda to'ldiramiz)
5. Deploy qiling — sizga doimiy manzil beriladi, masalan
   `https://sizning-nom.onrender.com`

## 5-qadam — Guruh ID raqamini aniqlang

Server ishga tushgach, guruhga istalgan xabar yozing (yoki Click'ning
navbatdagi bildirishnomasini kuting). Render'dagi "Logs" bo'limida
shunday qator chiqadi:

```
Xabar keldi. chat.id = -1001234567890 | chat.title = Click to'lovlar
```

Shu `chat.id` raqamini nusxalab, Render sozlamalaridagi
`CLICK_GROUP_CHAT_ID` o'zgaruvchisiga qo'ying va serverni qayta
ishga tushiring (Render buni avtomatik qiladi). Bu — botning FAQAT
shu guruhdagi xabarlarni qabul qilishini ta'minlaydi.

## 6-qadam — Sinab ko'ring

Skrinshotingizdagi kabi kichik summali (masalan 1000 so'mlik) test
to'lovini amalga oshiring va guruhga xabar tushishini kuting. Keyin:

```
https://sizning-nom.onrender.com/status/998901234567
```

manziliga kirib (o'zingizning test raqamingiz bilan) `{"paid":true}`
javobini ko'rishingiz kerak — 412 000 so'mdan kam summalar
e'tiborsiz qoldiriladi, shuning uchun to'liq testni 412 000 so'm bilan
sinang.

## 7-qadam — Menga xabar bering

Server manzilingiz tayyor bo'lgach, shu manzilni (`https://sizning-nom.onrender.com`)
menga yuboring — men test-sahifasidagi to'lov bosqichini shu serverni
avtomatik so'rab turadigan qilib ulab beraman. Xavfsizlik uchun
joriy "admin tasdiqlaydi" tizimini ham zaxira (fallback) sifatida
saqlab qolamiz — agar bot biror sababdan xabarni o'qiy olmasa, siz
baribir admin panel orqali qo'lda tasdiqlay olasiz.

## Eslatma — nozik joylari

- Click xabar formatini ozgina o'zgartirsa (masalan emoji yoki
  qator tartibi), tahlil qiluvchi kod (`parseClickMessage`) moslashtirish
  talab qilishi mumkin — shuning uchun 6-qadamdagi sinovni albatta
  o'tkazing va menga natijani ko'rsating, kerak bo'lsa tuzataman.
- `payments.json` — oddiy fayl-baza, kichik hajmda ishonchli. Mijozlar
  ko'payib borsa, buni haqiqiy bazaga ko'chirishga yordam beraman.
- Render'ning bepul rejasi bir muddat foydalanilmasa "uxlab qoladi" va
  birinchi so'rovga sekinroq javob beradi — agar bu muammo tug'dirsa,
  arzon "always on" rejaga o'tish tavsiya etiladi.
