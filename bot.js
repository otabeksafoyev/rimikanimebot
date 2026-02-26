const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

// ======================
// SOZLAMALAR
// ======================
require('dotenv').config()
const TOKEN = process.env.TOKEN;
const MONGO_URL = process.env.MONGO_URL; 
const UPLOAD_CHANNEL = "Sakuramibacent"; 
const SUB_CHANNEL = "SakuramiTG";
const NEWS_CHANNEL = "SakuramiTG";
const ADMIN_IDS = [8173188671, 8248009618];
const ADMIN_USERNAME = "safoyev9225";
const BOT_VERSION = "2.5.0";

const ADMIN_CHAT_LINK = "https://t.me/safoyev9225";

// Bot – polling dastlab o‘chirilgan
const bot = new TelegramBot(TOKEN, { polling: false });
let BOT_USERNAME = 'RimikAnime_bot';

// MongoDB
let client;
let db;
let serials;
let episodes;
let users;
let settings;
let banned_users;
let partners;

// Step tracking (faqat shu user uchun ishlaydi)
const addAnimeSteps = new Map(); // user_id → { step: 'title'|'total'|'genres'|'custom_id'|'trailer', data: {} }

// ======================
const REGIONS = [
  "Andijon","Buxoro","Farg'ona","Jizzax","Namangan","Navoiy",
  "Qashqadaryo","Qoraqalpog'iston Respublikasi","Samarqand",
  "Sirdaryo","Surxondaryo","Toshkent shahri","Toshkent viloyati","Xorazm"
];

// ======================
// MongoDB ulanish
// ======================
async function connectToMongo() {
  try {
    console.log("MongoDB ga ulanish boshlanmoqda...");
    client = await MongoClient.connect(MONGO_URL, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    db = client.db("anime_bot");

    serials     = db.collection("serials");
    episodes    = db.collection("episodes");
    users       = db.collection("users");
    settings    = db.collection("settings");
    banned_users = db.collection("banned_users");
    partners    = db.collection("partners");

    console.log("✅ MongoDB ga muvaffaqiyatli ulanildi!");
  } catch (err) {
    console.error("❌ MongoDB ulanishda JIDDIY XATO:");
    console.error(err.message || err);
    process.exit(1);
  }
}

// ======================
// DB tayyorligini tekshirish
// ======================
function isDbReady() {
  return !!serials && !!users && !!settings;
}

// ======================
// Anime qidirish – himoyalangan
// ======================
async function findAnime(payload) {
  if (!isDbReady()) {
    console.error("[DB XATOSI] Ma'lumotlar bazasi ulanmagan");
    return null;
  }
  if (!payload || typeof payload !== 'string') return null;
  payload = payload.trim();

  try {
    let anime = await serials.findOne({ _id: payload });
    if (anime) return anime;
    anime = await serials.findOne({ custom_id: payload });
    if (anime) return anime;
    anime = await serials.findOne({
      custom_id: { $regex: new RegExp(`^${payload}$`, 'i') }
    });
    return anime;
  } catch (err) {
    console.error("findAnime xatosi:", err.message);
    return null;
  }
}

// ======================
// Botni ishga tushirish – polling faqat ulanishdan keyin
// ======================
async function startBot() {
  console.log("Bot ishga tushmoqda...");
  await connectToMongo();
  await update_required_channels();

  try {
    const me = await bot.getMe();
    BOT_USERNAME = me.username;
    console.log(`🤖 Bot muvaffaqiyatli ulandi: @${BOT_USERNAME}`);

    // Pollingni qo‘lda boshlaymiz
    bot.startPolling();
    console.log("Polling muvaffaqiyatli ishga tushdi");
  } catch (err) {
    console.error("Botni ishga tushirishda xato:", err.message);
    process.exit(1);
  }
}

// ======================
// Admin va hamkor tekshiruvi
// ======================
function is_admin(uid) {
  return ADMIN_IDS.includes(uid);
}

async function is_partner(uid) {
  if (!partners) return false;
  return await partners.findOne({ user_id: uid }) !== null;
}

let required_channels = [`@${SUB_CHANNEL}`];
async function update_required_channels() {
  if (!settings) return;
  const doc = await settings.findOne({ key: "additional_channels" });
  required_channels = [`@${SUB_CHANNEL}`].concat(doc?.channels || []);
}

async function get_required_channels() {
  return required_channels;
}

async function get_user_required_channels(user_id, anime = null) {
  let channels = [];

  // 🔹 GLOBAL har doim majburiy
  channels.push(`@${SUB_CHANNEL}`);

  // 🔹 Foydalanuvchi region kanallari
  const user = await users.findOne({ user_id });
  if (user && user.region) {
    const doc = await settings.findOne({ key: "region_channels" });
    if (doc && doc.channels && doc.channels[user.region]) {
      channels = channels.concat(doc.channels[user.region]);
    }
  }

  // 🔹 Agar anime hamkor tomonidan qo‘shilgan bo‘lsa
  if (anime && anime.added_by) {
    const partner = await partners.findOne({ user_id: anime.added_by });
    if (partner && partner.partner_channel) {
      channels.push(partner.partner_channel);
    }
  }

  // 🔹 Anime ichidagi maxsus majburiy kanallar
  if (anime && anime.required_channels) {
    channels = channels.concat(anime.required_channels);
  }

  // 🔹 Dublikatlarni olib tashlash
  return [...new Set(channels)];
}

async function get_subscription_statuses(user_id, channels) {
  const promises = channels.map(async (original_ch) => {
    try {
      let chat_id = original_ch;
      let display_name = original_ch;

      // Agar @username bo'lsa → real chat ID ni olish
      if (original_ch.startsWith('@')) {
        const chat = await bot.getChat(original_ch);
        chat_id = chat.id;
        display_name = chat.title || chat.username || original_ch;
      } else if (typeof original_ch === 'string' && original_ch.startsWith('-100')) {
        // allaqachon ID bo'lsa
        chat_id = Number(original_ch);
        const chat = await bot.getChat(chat_id);
        display_name = chat.title || original_ch;
      }

      const member = await bot.getChatMember(chat_id, user_id);

      let url;
      const chat = await bot.getChat(chat_id);
      if (chat.username) {
        url = `https://t.me/${chat.username.replace('@', '')}`;
      } else {
        // private/super-group uchun
        url = `https://t.me/c/${String(chat_id).replace('-100', '')}`;
      }

      return {
        chat_id: chat_id,
        original: original_ch,
        title: display_name,
        subscribed: ['member', 'creator', 'administrator'].includes(member.status),
        url: url
      };
    } catch (err) {
      console.error(`Obuna tekshirish xatosi kanal ${original_ch}:`, err.message, err.description || '');

      let fallback_url = original_ch.startsWith('@')
        ? `https://t.me/${original_ch.slice(1)}`
        : (String(original_ch).startsWith('-100')
          ? `https://t.me/c/${String(original_ch).replace('-100', '')}`
          : original_ch);

      return {
        chat_id: original_ch,
        original: original_ch,
        title: original_ch,
        subscribed: false,
        url: fallback_url,
        error: err.message || 'Noma\'lum xato'
      };
    }
  });

  const results = await Promise.all(promises);

  // Debugging uchun har safar konsolga chiqarib turamiz (keyin o'chirib qo'yishingiz mumkin)
  console.log(`[${new Date().toISOString()}] Obuna holatlari user ${user_id}:`, 
    results.map(r => `${r.title}: ${r.subscribed ? '✅' : '❌'} (${r.error || 'OK'})`));

  return results;
}

async function is_subscribed(user_id, channels) {
  if (!channels || channels.length === 0) return true;

  const statuses = await get_subscription_statuses(user_id, channels);
  const all_subscribed = statuses.every(s => s.subscribed === true);

  if (!all_subscribed) {
    console.log(`User ${user_id} obuna bo'lmagan kanallar:`,
      statuses.filter(s => !s.subscribed).map(s => s.title));
  }

  return all_subscribed;
}

async function is_banned(user_id) {
  return await banned_users.findOne({ user_id }) !== null;
}

async function check_subscription_and_proceed(chat_id, serial_id, part = 1) {
  const user_id = chat_id;

  if (await is_banned(user_id)) {
    return bot.sendMessage(chat_id, `🚫 Siz botdan bloklangansiz. Admin: @${ADMIN_USERNAME}`);
  }

  const anime = await serials.findOne({ _id: serial_id });
  if (!anime) {
    return bot.sendMessage(chat_id, "Anime topilmadi...");
  }

  const channels = await get_user_required_channels(user_id, anime);

  if (channels.length === 0) {
    return send_episode(chat_id, serial_id, part);
  }

  const statuses = await get_subscription_statuses(user_id, channels);
  const unsubscribed = statuses.filter(s => !s.subscribed);

  if (unsubscribed.length > 0) {
    let messageText = "🌟 Anime tomosha qilish uchun quyidagi joylarga obuna bo‘ling, aziz do‘stim! Bu sizga yanada ko'proq zavq bag‘ishlaydi! 😊\n\n";
    const markup = { inline_keyboard: [] };
    unsubscribed.forEach(status => {
      markup.inline_keyboard.push([{
        text: "Obuna bo'lish! 🎉",
        url: status.url
      }]);
    });
    if (markup.inline_keyboard.length > 0) {
      markup.inline_keyboard.push([{ text: "✅ Tekshirib ko'rdim, tomosha qilay! ✨", callback_data: `check_sub_play_${serial_id}_${part}` }]);
    }
    bot.sendMessage(chat_id, messageText, { reply_markup: markup });
    return;
  }
  send_episode(chat_id, serial_id, part);
}

// ======================
// Start banner
// ======================
async function send_start_banner(chat_id) {
  if (!isDbReady()) {
    return bot.sendMessage(chat_id, "Bot hali to‘liq ishga tushmagan. Bir oz kutib turing, yoki admin bilan gaplashib ko'ring: @" + ADMIN_USERNAME + " 😊");
  }

  try {
    const total_users = await users.countDocuments({});
    const top_anime = await serials.findOne({}, { sort: { views: -1 } }) || { title: "Hali anime yo‘q", views: 0 };
    const banner_url = "https://i.postimg.cc/yYXCsTkw/photo-2026-01-05-15-32-43.jpg";
    const caption = (
      ". . ── •✧⛩✧• ── . .\n" +
      "• ❤️ Rimika Uz bilan hammasi yanada osonroq va qiziqarli, azizim! o((≧ω≦ ))o\n" +
      "-\n" +
      `📺 Hozirda 👤 <b>${total_users}</b> ta do'stim anime tomosha qilmoqda! Siz ham qo'shiling!\n` +
      `🔥 Eng ko‘p ko‘rilgan anime — <b>${top_anime.title}</b>! Bu sizga yoqishi aniq! ❤️\n` +
      `👁 Jami ko‘rishlar: <b>${top_anime.views || 0}</b>\n` +
      `👨‍💻 Dasturchi: @${ADMIN_USERNAME}\n` +
      ". . ── •✧⛩✧• ── . ."
    );
    const markup = {
      inline_keyboard: [
        [{ text: "🔍 Anime qidirish", switch_inline_query_current_chat: "" }],
        [{ text: "🎭 Janr bo‘yicha", callback_data: "genres_list" }, { text: "📢 Yangiliklar", callback_data: "news" }],
        [{ text: "🧠 Qanday ishlaydi?", callback_data: "how_it_works" }],
        [{ text: "👑 Hamkor Bo‘lish", callback_data: "become_partner" }]
      ]
    };
    try {
      await bot.sendPhoto(chat_id, banner_url, { caption, reply_markup: markup, parse_mode: "HTML" });
    } catch {
      await bot.sendMessage(chat_id, caption, { reply_markup: markup, parse_mode: "HTML" });
    }

    const enabledDoc = await settings.findOne({ key: "region_survey_enabled" });
    const enabled = enabledDoc ? enabledDoc.value : false;
    if (enabled) {
      const user = await users.findOne({ user_id: chat_id });
      if (!user || !user.region) {
        await send_region_survey(chat_id);
      }
    }
  } catch (err) {
    console.error("send_start_banner xatosi:", err.message);
    bot.sendMessage(chat_id, "Xatolik yuz berdi. Admin bilan bog‘laning: @" + ADMIN_USERNAME + " 😔");
  }
}

function send_trailer_with_poster(chat_id, anime) {
  if (anime.poster_file_id) {
    bot.sendPhoto(chat_id, anime.poster_file_id, { caption: `🎬 ${anime.title} – Bu ajoyib anime! Ko'ring! 😍` });
  }
  if (anime.trailer) {
    bot.sendVideo(chat_id, anime.trailer, { caption: `🎬 ${anime.title} (Treyler) – Qiziqarli, shunday emasmi? ✨` });
  }
}

async function send_region_survey(chat_id) {
  const markup = { inline_keyboard: [] };
  let row = [];
  for (let i = 0; i < REGIONS.length; i++) {
    row.push({ text: REGIONS[i], callback_data: `set_region_${REGIONS[i]}` });
    if (row.length === 2 || i === REGIONS.length - 1) {
      markup.inline_keyboard.push(row);
      row = [];
    }
  }
  await bot.sendMessage(chat_id, "Assalomu alaykum, aziz do‘stim! Botdan to'liq zavqlanish uchun, qaysi viloyatdan ekanligingizni tanlang! 🌟", { reply_markup: markup });
}

// ======================
// Message handler (bitta global handler, step va oddiy message ni ichida boshqarish)
// ======================










bot.on('message', async (msg) => {
  if (!msg.text) return;

  const text = msg.text.trim();
  const uid = msg.from.id;

  // 🔴 1. Agar komanda bo‘lsa:
  // Faqat /start payload ishlaydi, qolgan komandalarni to‘xtatamiz
  if (text.startsWith('/') && !text.startsWith('/start ')) {
    return;
  }

  // 2. Foydalanuvchini bazaga qo'shish
  await users.updateOne(
    { user_id: uid },
    { $setOnInsert: { user_id: uid } },
    { upsert: true }
  );

  const stepData = addAnimeSteps.get(uid);

  // 🔵 STEP MODE
  if (stepData) {
    const chat_id = msg.chat.id;

    switch (stepData.step) {
      case 'title':
        stepData.data.title = text;
        stepData.step = 'total';
        return bot.sendMessage(chat_id, "Nechta qismi bor? 😊");

      case 'total':
        stepData.data.total = parseInt(text) || 1;
        stepData.step = 'genres';
        return bot.sendMessage(chat_id, "Janrlarini yozing (masalan: Action, Fantasy) ✨");

      case 'genres':
        stepData.data.genres = text;
        stepData.step = 'custom_id';
        return bot.sendMessage(chat_id, "Custom ID kiriting (masalan: naruto, one-piece) 🌟");

      case 'custom_id':
        // 🔹 Custom ID bandligini tekshirish
        const existing = await serials.findOne({ custom_id: text.trim() });
        if (existing) {
          return bot.sendMessage(chat_id, "❌ Bu custom ID band. Iltimos, boshqasini kiriting:");
        }

        stepData.data.custom_id = text.trim();
        stepData.step = 'trailer';
        return bot.sendMessage(chat_id, "Treyler videoni yuboring 🎬");

      default:
        addAnimeSteps.delete(uid);
        return;
    }
  }

  // 🔵 ODDIY MESSAGE HANDLER
  let payload = text;

  // Agar /start payload bo‘lsa
  if (payload.startsWith('/start ')) {
    payload = payload.replace('/start ', '').trim();
  }

  if (payload.length < 1) return;

  let id = payload;
  let part = 1;

  if (payload.includes('_')) {
    const parts = payload.split('_');
    id = parts[0].trim();
    part = parseInt(parts[1]) || 1;
  }

  const anime = await findAnime(id);

  if (!anime) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Anime topilmadi! Yana urinib ko‘ring 😊"
    );
  }



  if (await episodes.findOne({ serial_id: anime._id, part })) {
    return check_subscription_and_proceed(msg.chat.id, anime._id, part);
  }

  if (await episodes.findOne({ serial_id: anime._id, part: 1 })) {
    return check_subscription_and_proceed(msg.chat.id, anime._id, 1);
  }

  return send_trailer_with_poster(msg.chat.id, anime);
});



// /start
bot.onText(/\/start$/, async (msg) => {
  await send_start_banner(msg.chat.id);
});

// Web App data
bot.on('web_app_data', async (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    if (data.anime_id) {
      await check_subscription_and_proceed(msg.chat.id, data.anime_id, 1);
    } else if (data.action === "random") {
      if (!isDbReady()) return bot.sendMessage(msg.chat.id, "Ma'lumotlar bazasi ulanmagan, azizim! 😔");
      const all_anime = await serials.find().toArray();
      if (all_anime.length) {
        const anime = all_anime[Math.floor(Math.random() * all_anime.length)];
        await check_subscription_and_proceed(msg.chat.id, anime._id, 1);
      }
    }
  } catch {
    bot.sendMessage(msg.chat.id, "❌ Web App ma'lumotida xato, yana urinib ko'ring! 😊");
  }
});

// ======================
// Callback query
// ======================
bot.on('callback_query', async (query) => {
  bot.answerCallbackQuery(query.id);
  const chat_id = query.message.chat.id;

  if (query.data.startsWith("set_region_")) {
    const region = query.data.replace("set_region_", "");
    if (REGIONS.includes(region)) {
      await users.updateOne({ user_id: query.from.id }, { $set: { region } });
      bot.sendMessage(chat_id, `Rahmat, aziz do‘stim! Siz ${region} ni tanladingiz. Endi anime dunyosiga xush kelibsiz! 🌟`);
      try { await bot.deleteMessage(chat_id, query.message.message_id); } catch {}
    }
    return;
  }

  if (query.data === "genres_list") {
    const markup = {
      inline_keyboard: [
        [{ text: "🔥 Action", callback_data: "genre_Action" }, { text: "⚔️ Adventure", callback_data: "genre_Adventure" }],
        [{ text: "😂 Comedy", callback_data: "genre_Comedy" }, { text: "😢 Drama", callback_data: "genre_Drama" }],
        [{ text: "🧙 Fantasy", callback_data: "genre_Fantasy" }, { text: "💕 Romance", callback_data: "genre_Romance" }],
        [{ text: "🚀 Sci-Fi", callback_data: "genre_Sci-Fi" }, { text: "👊 Shounen", callback_data: "genre_Shounen" }],
        [{ text: "☀️ Slice of Life", callback_data: "genre_Slice of Life" }],
        [{ text: "🔙 Orqaga", callback_data: "back_to_start" }]
      ]
    };
    bot.sendMessage(chat_id, "🎭 Janrni tanlang, azizim! Bu sizga mos anime topishga yordam beradi! 😍", { parse_mode: "HTML", reply_markup: markup });
  } else if (query.data.startsWith("genre_")) {
    const genre = query.data.replace("genre_", "");
    const anime_list = await serials.find({ genres: { $regex: genre, $options: "i" } }).limit(20).toArray();
    if (anime_list.length === 0) {
      bot.sendMessage(chat_id, `❌ "${genre}" janrida anime topilmadi, azizim! Boshqa janrni sinab ko'ring! 😊`, {
        reply_markup: { inline_keyboard: [[{ text: "🔙 Janrlarga qaytish", callback_data: "genres_list" }]] }
      });
      return;
    }
    let text = `🎭 <b>${genre}</b> janridagi animelar (${anime_list.length} ta): Bu sizga yoqishi aniq! ✨\n\n`;
    const markup = { inline_keyboard: [] };
    const anime_ids = anime_list.map(a => a._id);
    const first_episodes = await episodes.find({ serial_id: { $in: anime_ids }, part: 1 }).toArray();
    const has_first_map = new Map(first_episodes.map(ep => [ep.serial_id, true]));
    for (let anime of anime_list) {
      const has_episode = has_first_map.has(anime._id);
      const button_text = has_episode ? "▶️ Tomosha qilish" : "📺 Treyler";
      markup.inline_keyboard.push([{
        text: `${button_text} ${anime.title}`,
        url: `https://t.me/${BOT_USERNAME}?start=${anime.custom_id || anime._id}`
      }]);
    }
    markup.inline_keyboard.push([
      { text: "🔙 Janrlarga qaytish", callback_data: "genres_list" },
      { text: "🏠 Bosh menyuga", callback_data: "back_to_start" }
    ]);
    bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: markup });
  } else if (query.data === "back_to_start") {
    await send_start_banner(chat_id);
  } else if (query.data === "news") {
    bot.sendMessage(chat_id, `📢 Yangiliklar uchun kanalimiz: @${NEWS_CHANNEL} – Har doim yangi va qiziqarli narsalar! 😍`, {
      reply_markup: { inline_keyboard: [[{ text: "📢 Kanalga o'tish", url: `https://t.me/${NEWS_CHANNEL}` }]] }
    });
  } else if (query.data === "how_it_works") {
    const text = (
      "🧠 <b>Bot qanday ishlaydi?</b>\n\n" +
      "1. Oddiy xabarga anime kodini yozing (masalan: naruto, 85) – Oson va tez! 🌟\n" +
      "2. 🎭 Janr bo‘yicha tugmasidan janr tanlang – Sizga mosini toping! 😊\n" +
      "3. Majburiy joylarga obuna bo'ling – Bu sizga yanada ko'proq imkoniyatlar beradi! ❤️\n" +
      "4. Qismlarni ketma-ket tomosha qiling – Zavq oling! ✨\n\n" +
      "Rahmat foydalanganingiz uchun, aziz do‘stim! Doim siz bilanmiz! 😘"
    );
    bot.sendMessage(chat_id, text, { parse_mode: "HTML" });
  } else if (query.data === "become_partner") {
    const partnerText = 
`👑 **Hamkor Bo‘lish**

O‘z anime kanalingizni o‘stirib, obunachi yig‘ishni xohlaysizmi, azizim? 😍

Biz bilan hamkorlik orqali siz:
✔️ Anime qo‘shasiz va o‘z kanalingizga obunachi yig‘asiz – O'sish oson bo'ladi!
✔️ Kanal orqali daromad qilish imkoniga ega bo‘lasiz – Ajoyib!
✔️ Alohida bot sotib olishingiz shart emas – Hammasi bepul!
✔️ Hamkorlik bepul — boshlash uchun to‘lov yo‘q – Tez boshlang!
✔️ Anime qo‘shish va kanallarni ulash to‘liq o‘rgatiladi – Biz yordam beramiz!

Savollaringiz bo‘lsa, admin bilan bevosita bog‘laning, azizim!

Hamkorlikni boshlash uchun pastdagi tugmani bosing 👇`;

    const markup = {
      inline_keyboard: [
        [{ text: "🔘 Adminga yozish", url: ADMIN_CHAT_LINK }],
        [{ text: "🏠 Bosh menyuga", callback_data: "back_to_start" }]
      ]
    };

    bot.sendMessage(chat_id, partnerText, { parse_mode: "Markdown", reply_markup: markup });
  }
  
  
  else if (query.data.startsWith("check_sub_play_")) {
    const parts = query.data.split("_");
    const serial_id = parts[3];
    const part = parseInt(parts[4]);
    await check_subscription_and_proceed(chat_id, serial_id, part);
  }


  
   else if (query.data.startsWith("play_")) {
    const [, serial_id, part] = query.data.split("_");
    await check_subscription_and_proceed(chat_id, serial_id, parseInt(part));
  }
});

// ======================
// Inline query – bo'sh queryda va qidiruvda top 30 ta, qidiruvda views bo'yicha sort
// ======================
bot.on('inline_query', async (query) => {
  const results = [];
  const q = query.query.trim().toLowerCase();

  let anime_list = [];

  if (q.length === 0) {
    // Hech narsa yozilmaganda → TOP 30 mashhur anime
    anime_list = await serials.find().sort({ views: -1 }).limit(30).toArray();
  } else {
    // Ism bo‘yicha qidiruv + views bo'yicha sort + limit 30
    anime_list = await serials.find({ title: { $regex: q, $options: "i" } }).sort({ views: -1 }).limit(30).toArray();
  }

  const anime_ids = anime_list.map(a => a._id);
  const first_episodes = await episodes.find({ serial_id: { $in: anime_ids }, part: 1 }).toArray();
  const has_first_map = new Map(first_episodes.map(ep => [ep.serial_id, true]));

  for (let anime of anime_list) {
    const has_first = has_first_map.has(anime._id);
    const button_text = has_first ? "▶️ Tomosha qilish" : "📺 Treyler";
    
    // Linkda custom_id ni ishlatamiz (agar yo‘q bo‘lsa _id)
    const startCode = anime.custom_id || anime._id;
    const url = `https://t.me/${BOT_USERNAME}?start=${startCode}`;

    results.push({
      type: 'article',
      id: anime._id,
      title: anime.title,
      description: `🎭 ${anime.genres || 'Noma\'lum'} • ${anime.total} qism • 👁 ${anime.views || 0} ko‘rish`,
      thumb_url: "https://i.postimg.cc/NjS4n3Q4/photo-2026-01-05-15-35-26.jpg",
      input_message_content: {
        message_text: `🎬 ${anime.title}\n` +
                      `🎭 Janr: ${anime.genres || 'N/A'}\n` +
                      `📦 Qismlar: ${anime.total}\n` +
                      `👁 Ko‘rilgan: ${anime.views || 0}\n` +
                      `Kod: ${anime.custom_id || anime._id}`
      },
      reply_markup: { inline_keyboard: [[{ text: button_text, url }]] }
    });
  }

  bot.answerInlineQuery(query.id, results, { cache_time: q.length > 0 ? 1 : 300 });
});

// ======================
// Episode jo‘natish
// ======================
async function send_episode(chat_id, serial_id, part = 1) {
  const anime = await serials.findOne({ _id: serial_id });
  const episode = await episodes.findOne({ serial_id, part });
  if (!episode) {
    bot.sendMessage(chat_id, "❌ Bu qism hali yuklanmagan, azizim! Tez orada yuklaymiz! 😊");
    return;
  }
  await serials.updateOne({ _id: serial_id }, { $inc: { views: 1 } });
  const markup = { inline_keyboard: [] };
  const total_parts = anime.total;
  const PAGE_SIZE = 50;
  const BUTTONS_PER_ROW = 5;
  let start, end;
  if (total_parts <= PAGE_SIZE) {
    start = 1;
    end = total_parts + 1;
  } else {
    const current_page = Math.ceil(part / PAGE_SIZE);
    start = (current_page - 1) * PAGE_SIZE + 1;
    end = Math.min(start + PAGE_SIZE, total_parts + 1);
  }
  const existing_parts_docs = await episodes.find({ serial_id, part: { $gte: start, $lt: end } }).project({ part: 1 }).toArray();
  const existing_parts = new Set(existing_parts_docs.map(doc => doc.part));
  const buttons = [];
  for (let p = start; p < end; p++) {
    const exists = existing_parts.has(p);
    const label = p === part ? `▶️ ${p}` : (exists ? `${p}` : `${p} ⚠️`);
    buttons.push({ text: label, callback_data: exists ? `play_${serial_id}_${p}` : "none" });
  }
  while (buttons.length > 0) {
    markup.inline_keyboard.push(buttons.splice(0, BUTTONS_PER_ROW));
  }
  const nav = [];
  if (start > 1) {
    nav.push({ text: "◀️ Orqaga", callback_data: `play_${serial_id}_${start - PAGE_SIZE}` });
  }
  if (end <= total_parts) {
    nav.push({ text: "Keyingi ▶️", callback_data: `play_${serial_id}_${end}` });
  }
  if (nav.length) {
    markup.inline_keyboard.push(nav);
  }
  bot.sendVideo(chat_id, episode.file_id, { caption: `${anime.title} — ${part}-qism – Zavq oling, azizim! 😘`, reply_markup: markup });
}


async function sendWithLoader(chat_id, callback) {
  const loaderFrames = ["⌛", "⏳", "💫", "✨"];
  let i = 0;
  const interval = setInterval(() => {
    bot.sendChatAction(chat_id, 'typing'); // typing holati
    bot.sendMessage(chat_id, `${loaderFrames[i % loaderFrames.length]} Anime tayyorlanmoqda…`).catch(() => {});
    i++;
  }, 500);

  try {
    await callback(); // anime yuborish yoki check_subscription
  } finally {
    clearInterval(interval);
  }
}

















// ======================
// ADMIN BUYRUQLARI
// ======================


bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  const uid = msg.from.id;

  if (!ADMIN_IDS.includes(uid)) {
    return bot.sendMessage(chatId, "❌ Sizda bu buyruqni ishlatish huquqi yo'q.");
  }

  // Faqat shu foydalanuvchining /addanime stepini bekor qilish
  if (addAnimeSteps.has(uid)) {
    addAnimeSteps.delete(uid);
    bot.sendMessage(chatId, "✅ /addanime jarayoni bekor qilindi.");
  } else {
    bot.sendMessage(chatId, "ℹ️ Hech qanday /addanime jarayoni topilmadi.");
  }
});

bot.onText(/\/editid(?:\s+(.+))\s+(.+)/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;

  const oldId = match[1]?.trim();
  const newId = match[2]?.trim();

  if (!oldId || !newId) {
    return bot.sendMessage(msg.chat.id, 
      "Foydalanish:\n/editid <anime_id> <yangi_custom_id>");
  }

  const anime = await findAnime(oldId);
  if (!anime) {
    return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  }

  // yangi ID band emasligini tekshiramiz
  const exists = await serials.findOne({ custom_id: newId });
  if (exists) {
    return bot.sendMessage(msg.chat.id, 
      "❌ Bu custom ID allaqachon mavjud");
  }

  await serials.updateOne(
    { _id: anime._id },
    { $set: { custom_id: newId } }
  );

  bot.sendMessage(msg.chat.id, 
    `✅ Custom ID yangilandi:\nEski: ${anime.custom_id}\nYangi: ${newId}`);
});










bot.onText(/\/resendtrailer(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  if (!sid) return bot.sendMessage(msg.chat.id, "❌ Foydalanish: /resendtrailer <anime_id>");
  let anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  await send_anime_card(msg.chat.id, anime._id);
  try {
    await send_anime_card(`@${SUB_CHANNEL}`, anime._id);
  } catch {}
  bot.sendMessage(msg.chat.id, `✅ ${anime.title} treyleri yuborildi`);
});

async function send_anime_card(chat_id, serial_id) {
  const anime = await serials.findOne({ _id: serial_id });
  if (!anime) return;
  const markup = {
    inline_keyboard: [[{ text: "🧧 Ko‘rish", url: `https://t.me/${BOT_USERNAME}?start=${anime.custom_id || anime._id}` }]]
  };
  const caption = `
🎌 <b>Yangi Anime Qo‘shildi!</b> 🎌
🎬 <b>Nomi:</b> ${anime.title}
📦 <b>Qismlar soni:</b> ${anime.total}
🎭 <b>Janr:</b> ${anime.genres}
🆔 <b>Anime kodi:</b> <code>${anime.custom_id}</code>
❤️ Rimika Uz bilan birga tomosha qiling!
    `.trim();
  await bot.sendVideo(chat_id, anime.trailer, {
    caption,
    reply_markup: markup,
    parse_mode: "HTML"
  });
}

// Treylerni o'zgartirish
bot.onText(/\/changetrailer(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /changetrailer <anime_id>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  bot.sendMessage(msg.chat.id, `Yangi treyler videoni yuboring (${anime.title} uchun):`);
  bot.once('video', async (videoMsg) => {
    if (videoMsg.from.id !== msg.from.id) return;
    await serials.updateOne({ _id: anime._id }, { $set: { trailer: videoMsg.video.file_id } });
    bot.sendMessage(msg.chat.id, `✅ ${anime.title} treyleri yangilandi!`);
    try { await send_anime_card(`@${SUB_CHANNEL}`, anime._id); } catch {}
  });
});

// Poster qo'shish
bot.onText(/\/addposter(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /addposter <anime_id>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  bot.sendMessage(msg.chat.id, `Poster rasmni yuboring (${anime.title} uchun):`);
  bot.once('photo', async (photoMsg) => {
    if (photoMsg.from.id !== msg.from.id) return;
    const file_id = photoMsg.photo[photoMsg.photo.length - 1].file_id;
    await serials.updateOne({ _id: anime._id }, { $set: { poster_file_id: file_id } });
    bot.sendMessage(msg.chat.id, `✅ ${anime.title} poster qo‘shildi/yangilandi!`);
  });
});

// Anime ma'lumotlari
bot.onText(/\/animeinfo(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /animeinfo <anime_id>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  const epsCount = await episodes.countDocuments({ serial_id: anime._id });
  const text = `
🎬 <b>Anime Ma'lumotlari</b>
<b>Nom:</b> ${anime.title}
<b>Anime kodi:</b> <code>${anime.custom_id}</code>
<b>Internal ID:</b> <code>${anime._id}</code>
<b>Umumiy qismlar:</b> ${anime.total}
<b>Yuklangan qismlar:</b> ${epsCount}
<b>Janrlar:</b> ${anime.genres || 'Yo‘q'}
<b>Ko‘rishlar:</b> ${anime.views || 0}
<b>Majburiy kanallar:</b> ${anime.required_channels ? anime.required_channels.join(', ') : 'Yo‘q'}
  `.trim();
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// Anime ro'yxati
bot.onText(/\/animelist/, async (msg) => {
  if (!is_admin(msg.from.id)) return;
  const all = await serials.find().sort({ title: 1 }).toArray();
  if (all.length === 0) return bot.sendMessage(msg.chat.id, "❌ Hozircha anime yo‘q");
  const episode_counts = await episodes.aggregate([
    { $group: { _id: "$serial_id", count: { $sum: 1 } } }
  ]).toArray();
  const serial_counts = new Map(episode_counts.map(c => [c._id, c.count]));
  let text = `<b>📋 Anime Ro‘yxati (${all.length} ta)</b>\n\n`;
  for (let a of all) {
    const eps = serial_counts.get(a._id) || 0;
    text += `<b>${a.title}</b>\nKod: ${a.custom_id || 'yo‘q'} | ${eps}/${a.total} qism\n\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// Adminlar ro'yxati
bot.onText(/\/adminlist/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  const list = ADMIN_IDS.map(id => `• <code>${id}</code>`).join("\n");
  bot.sendMessage(msg.chat.id, `<b>👑 Adminlar:</b>\n${list}`, { parse_mode: "HTML" });
});

// Qism o'chirish
bot.onText(/\/deletepart(?:\s+(.+))\s+(\d+)/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  const part = parseInt(match[2]);
  if (!sid || isNaN(part)) return bot.sendMessage(msg.chat.id, "Foydalanish: /deletepart <anime_id> <qism>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  const result = await episodes.deleteOne({ serial_id: anime._id, part });
  if (result.deletedCount > 0) {
    bot.sendMessage(msg.chat.id, `✅ ${anime.title} — ${part}-qism o‘chirildi`);
  } else {
    bot.sendMessage(msg.chat.id, "❌ Bu qism topilmadi");
  }
});

// Ko'rishlar sonini nolga tushirish
bot.onText(/\/resetviews(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /resetviews <anime_id>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  await serials.updateOne({ _id: anime._id }, { $set: { views: 0 } });
  bot.sendMessage(msg.chat.id, `✅ ${anime.title} ko‘rishlar soni 0 ga tushirildi`);
});

// Statistika
bot.onText(/\/stats/, async (msg) => {
  if (!is_admin(msg.from.id)) return;
  const total_users = await users.countDocuments({});
  const total_anime = await serials.countDocuments({});
  const total_episodes = await episodes.countDocuments({});
  const total_views = (await serials.aggregate([{ $group: { _id: null, total: { $sum: "$views" } } }]).toArray())[0]?.total || 0;
  const top5 = await serials.find().sort({ views: -1 }).limit(5).toArray();
  let text = (
    "📊 <b>Bot Statistika</b>\n\n" +
    `👥 Foydalanuvchilar: <b>${total_users}</b>\n` +
    `🎬 Anime soni: <b>${total_anime}</b>\n` +
    `📼 Qismlar soni: <b>${total_episodes}</b>\n` +
    `👁 Jami ko‘rishlar: <b>${total_views}</b>\n\n` +
    "<b>🔥 Top 5 anime:</b>\n"
  );
  top5.forEach((a, i) => {
    text += `${i + 1}. ${a.title} — ${a.views || 0} ko‘rish\n`;
  });
  const regionCounts = await users.aggregate([{ $group: { _id: "$region", count: { $sum: 1 } } }]).toArray();
  const unanswered = await users.countDocuments({ region: { $exists: false } });
  text += "\n<b>Viloyatlar bo'yicha:</b>\n";
  regionCounts.forEach(rc => {
    text += `${rc._id || "Noma'lum"}: ${rc.count}\n`;
  });
  text += `Javob bermagan: ${unanswered}\n`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// Anime o'chirish
bot.onText(/\/deleteanime/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "🗑 O‘chiriladigan anime ID:").then(() => {
    bot.once('message', async (response) => {
      const sid = response.text.trim();
      const anime = await findAnime(sid);
      if (!anime) {
        bot.sendMessage(response.chat.id, "❌ Topilmadi");
        return;
      }
      await serials.deleteOne({ _id: anime._id });
      await episodes.deleteMany({ serial_id: anime._id });
      bot.sendMessage(response.chat.id, `✅ ${anime.title} o‘chirildi`);
    });
  });
});

// Anime tahrirlash
bot.onText(/\/editanime/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "✏️ Tahrirlanadigan anime ID:").then(() => {
    bot.once('message', async (response) => {
      const sid = response.text.trim();
      const anime = await findAnime(sid);
      if (!anime) {
        bot.sendMessage(response.chat.id, "❌ Topilmadi");
        return;
      }
      const context = { sid: anime._id, chatId: response.chat.id };
      bot.sendMessage(response.chat.id, `Joriy nom: ${anime.title}\nYangi nom (/skip):`).then(() => {
        bot.once('message', (res) => edit_title(res, context));
      });
    });
  });
});

async function edit_title(msg, ctx) {
  if (msg.text !== "/skip") {
    await serials.updateOne({ _id: ctx.sid }, { $set: { title: msg.text } });
  }
  bot.sendMessage(ctx.chatId, "Yangi qismlar soni (/skip):").then(() => {
    bot.once('message', (res) => edit_total(res, ctx));
  });
}

async function edit_total(msg, ctx) {
  if (msg.text !== "/skip") {
    try {
      const total = parseInt(msg.text);
      await serials.updateOne({ _id: ctx.sid }, { $set: { total } });
    } catch {}
  }
  bot.sendMessage(ctx.chatId, "Yangi janrlar (/skip):").then(() => {
    bot.once('message', (res) => edit_genres(res, ctx));
  });
}

async function edit_genres(msg, ctx) {
  if (msg.text !== "/skip") {
    await serials.updateOne({ _id: ctx.sid }, { $set: { genres: msg.text } });
  }
  bot.sendMessage(ctx.chatId, "✅ Yangilandi!");
}

// Qism yuklash (admin va hamkor)
bot.on('video', async (msg) => {
  const uid = msg.from.id;
  const stepData = addAnimeSteps.get(uid);

  if (stepData && stepData.step === 'trailer') {
    // Trailer step da – add anime trailer
    const chat_id = msg.chat.id;

    if (!msg.video) {
      bot.sendMessage(chat_id, "❌ Video yuboring!");
      return;
    }

    const data = stepData.data;
    const internal_id = uuidv4();

    const animeDoc = {
      _id: internal_id,
      custom_id: data.custom_id,
      title: data.title,
      total: data.total,
      genres: data.genres,
      trailer: msg.video.file_id,
      poster_file_id: null,
      views: 0,
      required_channels: []
    };

    if (await is_partner(uid)) {
      animeDoc.added_by = uid;
    }

    await serials.insertOne(animeDoc);

    if (await is_partner(uid)) {
      await partners.updateOne({ user_id: uid }, { $push: { added_animes: internal_id } });
    }

    await send_anime_card(chat_id, internal_id);
    bot.sendMessage(chat_id, `✅ Anime qo‘shildi!\n\nInternal ID: ${internal_id}\nCustom ID: ${data.custom_id}`);

    addAnimeSteps.delete(uid); // step tugadi
    return;
  }

  // Agar trailer emas bo'lsa, uploadpart ni tekshir
  if ((await is_partner(msg.from.id) || is_admin(msg.from.id)) && msg.caption && msg.caption.trim().toLowerCase() === "/uploadpart") {
    bot.replyToMessage(msg.chat.id, msg.message_id, "Video qabul qilindi! Anime ID yuboring:").then(() => {
      bot.once('message', (res) => upload_part_id(res, msg.video.file_id));
    });
  }
});

async function upload_part_id(msg, file_id) {
  const sid = msg.text.trim();
  const anime = await findAnime(sid);
  if (!anime) {
    bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
    return;
  }
  const context = { sid: anime._id, file_id: file_id, chatId: msg.chat.id };
  bot.sendMessage(msg.chat.id, "Qism raqami:").then(() => {
    bot.once('message', (res) => upload_part_num(res, context));
  });
}

async function upload_part_num(msg, ctx) {
  try {
    const part = parseInt(msg.text);
    await episodes.updateOne(
      { serial_id: ctx.sid, part },
      { $set: { file_id: ctx.file_id } },
      { upsert: true }
    );
    bot.sendMessage(ctx.chatId, `✅ ${ctx.sid} — ${part}-qism saqlandi`);
  } catch {
    bot.sendMessage(ctx.chatId, "❌ Raqam kiriting");
  }
}

// Ban / Unban
bot.onText(/\/ban/, async (msg) => {
  if (!is_admin(msg.from.id)) return;
  try {
    const uid = parseInt(msg.text.split(' ')[1]);
    await banned_users.updateOne({ user_id: uid }, { $set: { user_id: uid } }, { upsert: true });
    bot.sendMessage(msg.chat.id, `🚫 ${uid} bloklandi`);
  } catch {
    bot.sendMessage(msg.chat.id, "Foydalanish: /ban <user_id>");
  }
});

bot.onText(/\/unban/, async (msg) => {
  if (!is_admin(msg.from.id)) return;
  try {
    const uid = parseInt(msg.text.split(' ')[1]);
    await banned_users.deleteOne({ user_id: uid });
    bot.sendMessage(msg.chat.id, `✅ ${uid} blokdan chiqdi`);
  } catch {
    bot.sendMessage(msg.chat.id, "Foydalanish: /unban <user_id>");
  }
});

// About
bot.onText(/\/about/, (msg) => {
  const text = (
    "🤖 <b>Rimika Anime Bot</b>\n" +
    `📌 Versiya: <b>${BOT_VERSION}</b>\n` +
    `👨‍💻 Yaratuvchi: @${ADMIN_USERNAME}\n\n` +
    "Anime qidirish, ketma-ket tomosha bilan! Siz uchun doim tayyor! 😘"
  );
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// Elon (ommaga xabar)
bot.onText(/\/addelon/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "📢 Rasm yuboring (yo‘q bo‘lsa /skip):").then(() => {
    bot.once('message', (res) => add_elon_photo(res));
  });
});

async function add_elon_photo(msg) {
  const ctx = { chatId: msg.chat.id };
  if (msg.photo) {
    ctx.photo = msg.photo[msg.photo.length - 1].file_id;
    bot.sendMessage(ctx.chatId, "Matnni yozing:").then(() => {
      bot.once('message', (res) => add_elon_text(res, ctx));
    });
  } else if (msg.text === "/skip") {
    ctx.photo = null;
    bot.sendMessage(ctx.chatId, "Matnni yozing:").then(() => {
      bot.once('message', (res) => add_elon_text(res, ctx));
    });
  } else {
    bot.sendMessage(ctx.chatId, "❌ Rasm yoki /skip");
  }
}

async function add_elon_text(msg, ctx) {
  const text = msg.text;
  let sent = 0;
  const cursor = users.find();
  for await (const user of cursor) {
    try {
      if (ctx.photo) {
        await bot.sendPhoto(user.user_id, ctx.photo, { caption: text, parse_mode: "HTML" });
      } else {
        await bot.sendMessage(user.user_id, text, { parse_mode: "HTML" });
      }
      sent++;
    } catch {}
  }
  bot.sendMessage(ctx.chatId, `✅ ${sent} ta foydalanuvchiga yuborildi`);
}

bot.onText(/\/(addchannel|removechannel|listchannels)/, async (msg) => {
  if (!is_admin(msg.from.id)) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const cmd = msg.text.split(' ')[0].slice(1);

  if (cmd === "addchannel") {

    await bot.sendMessage(chatId, "Yangi kanal yuboring:\n(@username yoki -100ID)");

    const listener = async (res) => {
      if (res.from.id !== userId) return; // faqat shu admin javobi

      bot.removeListener('message', listener);
      await add_channel(res);
    };

    bot.on('message', listener);

  } else if (cmd === "removechannel") {

    await bot.sendMessage(chatId, "O‘chiriladigan kanal yuboring:\n(@username yoki -100ID)");

    const listener = async (res) => {
      if (res.from.id !== userId) return;

      bot.removeListener('message', listener);
      await remove_channel(res);
    };

    bot.on('message', listener);

  } else if (cmd === "listchannels") {

    if (!required_channels.length) {
      return bot.sendMessage(chatId, "❌ Majburiy kanallar yo‘q");
    }

    const text = "📋 Majburiy kanallar:\n\n" +
      required_channels.map(c => `• ${c}`).join("\n");

    bot.sendMessage(chatId, text);
  }
});


async function add_channel(msg) {
  let ch = msg.text.trim();
  if (!ch.startsWith('@') && !ch.startsWith('-')) {
    ch = `@${ch}`;
  }
  await settings.updateOne({ key: "additional_channels" }, { $addToSet: { channels: ch } }, { upsert: true });
  await update_required_channels();
  bot.sendMessage(msg.chat.id, `✅ ${ch} qo‘shildi`);
}

async function remove_channel(msg) {
  let ch = msg.text.trim();
  if (!ch.startsWith('@') && !ch.startsWith('-')) {
    ch = `@${ch}`;
  }
  const result = await settings.updateOne({ key: "additional_channels" }, { $pull: { channels: ch } });
  await update_required_channels();
  bot.sendMessage(msg.chat.id, result.modifiedCount ? "✅ O‘chirildi" : "❌ Topilmadi");
}

// Anime uchun majburiy kanal qo'shish
bot.onText(/\/add_anime_channel(?:\s+(.+))\s+(.+)/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  let ch = match[2]?.trim();
  if (!sid || !ch) return bot.sendMessage(msg.chat.id, "Foydalanish: /add_anime_channel <anime_id> <@username or -100ID>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  if (!ch.startsWith('@') && !ch.startsWith('-')) {
    ch = `@${ch}`;
  }
  await serials.updateOne({ _id: anime._id }, { $addToSet: { required_channels: ch } });
  bot.sendMessage(msg.chat.id, `✅ ${ch} ${anime.title} uchun qo‘shildi`);
});

// Anime uchun majburiy kanal o'chirish
bot.onText(/\/remove_anime_channel(?:\s+(.+))\s+(.+)/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  const sid = match[1]?.trim();
  let ch = match[2]?.trim();
  if (!sid || !ch) return bot.sendMessage(msg.chat.id, "Foydalanish: /remove_anime_channel <anime_id> <@username or -100ID>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  if (!ch.startsWith('@') && !ch.startsWith('-')) {
    ch = `@${ch}`;
  }
  const result = await serials.updateOne({ _id: anime._id }, { $pull: { required_channels: ch } });
  bot.sendMessage(msg.chat.id, result.modifiedCount ? `✅ ${ch} o‘chirildi` : "❌ Topilmadi");
});

// Anime qo'shish (admin va hamkor)
bot.onText(/\/addanime/, async (msg) => {
  const uid = msg.from.id;
  if (!is_admin(uid) && !(await is_partner(uid))) return;
  addAnimeSteps.set(uid, { step: 'title', data: {} });
  bot.sendMessage(msg.chat.id, "Anime nomini yozing:");
});

// Kanalga qism yuklash
bot.on('channel_post', async (msg) => {
  if (msg.chat.username !== UPLOAD_CHANNEL || !msg.video || !msg.caption) return;
  let serial_id = null;
  let part = null;
  for (let line of msg.caption.split("\n")) {
    if (line.toLowerCase().startsWith("id:")) {
      serial_id = line.split(":", 2)[1].trim();
    }
    if (line.toLowerCase().startsWith("qism:")) {
      try {
        part = parseInt(line.split(":", 2)[1].trim());
      } catch {}
    }
  }
  if (serial_id && part) {
    const anime = await findAnime(serial_id);
    if (anime) {
      await episodes.updateOne(
        { serial_id: anime._id, part },
        { $set: { file_id: msg.video.file_id } },
        { upsert: true }
      );
      bot.sendMessage(ADMIN_IDS[0], `✅ ${anime.title} — ${part}-qism saqlandi!`);
    }
  }
});

// Hamkorlar boshqaruvi
bot.onText(/\/addpartner/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "Hamkor qo'shiladigan user ID:").then(() => {
    bot.once('message', async (response) => {
      const uid = parseInt(response.text.trim());
      if (isNaN(uid)) {
        bot.sendMessage(response.chat.id, "❌ User ID raqam bo'lishi kerak");
        return;
      }
      if (await is_partner(uid)) {
        bot.sendMessage(response.chat.id, "❌ Bu user allaqachon hamkor");
        return;
      }
      await partners.insertOne({ user_id: uid, added_animes: [], partner_channel: null });
      bot.sendMessage(response.chat.id, `✅ ${uid} hamkor qo'shildi`);
    });
  });
});

bot.onText(/\/removepartner/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "Hamkor chiqariladigan user ID:").then(() => {
    bot.once('message', async (response) => {
      const uid = parseInt(response.text.trim());
      if (isNaN(uid)) {
        bot.sendMessage(response.chat.id, "❌ User ID raqam bo'lishi kerak");
        return;
      }
      const partner = await partners.findOne({ user_id: uid });
      if (!partner) {
        bot.sendMessage(response.chat.id, "❌ Hamkor topilmadi");
        return;
      }
      await partners.deleteOne({ user_id: uid });
      bot.sendMessage(response.chat.id, `✅ ${uid} hamkorlikdan chiqarildi. Animelar qoladi, kanal o'chirildi`);
    });
  });
});

bot.onText(/\/setchannel/, (msg) => {
  const uid = msg.from.id;
  if (!is_partner(uid)) return;
  bot.sendMessage(msg.chat.id, "Majburiy kanal ( @username yoki -100ID ):").then(() => {
    bot.once('message', async (res) => {
      let ch = res.text.trim();
      if (!ch.startsWith('@') && !ch.startsWith('-')) {
        ch = `@${ch}`;
      }
      await partners.updateOne({ user_id: uid }, { $set: { partner_channel: ch } });
      bot.sendMessage(res.chat.id, `✅ ${ch} majburiy kanal o'rnatildi`);
    });
  });
});

bot.onText(/\/removechannel/, async (msg) => {
  const uid = msg.from.id;
  if (!is_partner(uid)) return;
  await partners.updateOne({ user_id: uid }, { $set: { partner_channel: null } });
  bot.sendMessage(msg.chat.id, "✅ Majburiy kanal o'chirildi");
});

bot.onText(/\/mystats/, async (msg) => {
  const uid = msg.from.id;
  if (!is_partner(uid)) return;
  const partner = await partners.findOne({ user_id: uid });
  if (!partner.added_animes.length) {
    bot.sendMessage(msg.chat.id, "Siz hali anime qo'shmagansiz");
    return;
  }
  const animes = await serials.find({ _id: { $in: partner.added_animes } }).toArray();
  let text = "<b>Sizning statistikangiz:</b>\n\n";
  let total_views = 0;
  for (let anime of animes) {
    text += `${anime.title} — ${anime.views || 0} ko'rish\n`;
    total_views += anime.views || 0;
  }
  text += `\nJami ko'rishlar: ${total_views}`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// ======================
// News kanallarga e'lon qilish
// ======================
async function get_news_channels() {
  if (!settings) return [`@${NEWS_CHANNEL}`];
  const doc = await settings.findOne({ key: "news_channels" });
  return [`@${NEWS_CHANNEL}`].concat(doc?.channels || []);
}

bot.onText(/\/publish(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;
  if (!isDbReady()) return bot.sendMessage(msg.chat.id, "Ma'lumotlar bazasi ulanmagan.");
  const sid = match[1]?.trim();
  if (!sid) return bot.sendMessage(msg.chat.id, "❌ Foydalanish: /publish <anime_id>");
  const anime = await findAnime(sid);
  if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
  const news_channels = await get_news_channels();
  let success = 0;
  for (let ch of news_channels) {
    try {
      await send_anime_card(ch, anime._id);
      success++;
    } catch (e) {
      console.log(`${ch} ga yuborishda xato:`, e.message);
    }
  }
  bot.sendMessage(msg.chat.id, `✅ ${anime.title} ${success} ta news kanalga yuborildi`);
});

bot.onText(/\/addnewschannel/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "Yangi news kanal ( @username yoki -100ID ):").then(() => {
    bot.once('message', async (res) => {
      let ch = res.text.trim();
      if (!ch.startsWith('@') && !ch.startsWith('-')) {
        ch = `@${ch}`;
      }
      await settings.updateOne({ key: "news_channels" }, { $addToSet: { channels: ch } }, { upsert: true });
      bot.sendMessage(res.chat.id, `✅ ${ch} qo‘shildi`);
    });
  });
});

bot.onText(/\/removenewschannel/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "O‘chiriladigan news kanal ( @username yoki -100ID ):").then(() => {
    bot.once('message', async (res) => {
      let ch = res.text.trim();
      if (!ch.startsWith('@') && !ch.startsWith('-')) {
        ch = `@${ch}`;
      }
      const result = await settings.updateOne({ key: "news_channels" }, { $pull: { channels: ch } });
      bot.sendMessage(res.chat.id, result.modifiedCount ? "✅ O‘chirildi" : "❌ Topilmadi");
    });
  });
});

// ======================
// Botni ishga tushiramiz
// ======================
startBot();

// Express server (Railway uchun health check)
const app = express();
app.get("/", (req, res) => {
  res.status(200).send("Anime Bot ishlayapti ✨");
});
app.listen(process.env.PORT || 5000, () => {
  console.log(`Express server ${process.env.PORT || 5000}-portda ishlamoqda`);
});