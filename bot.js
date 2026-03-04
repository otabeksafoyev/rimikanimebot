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
let requiredChannels = [];
const SUB_CHANNEL = "SakuramiTG";
const NEWS_CHANNEL = "SakuramiTG";
const ADMIN_IDS = [8173188671];
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

    db = client.db(); // yoki db nomi: client.db('animebot')
    serials = db.collection('serials');
    episodes = db.collection('episodes');
    users = db.collection('users');
    settings = db.collection('settings');
    banned_users = db.collection('banned_users');
    partners = db.collection('partners');

    console.log("✅ MongoDB ga muvaffaqiyatli ulanildi!");

    // Mana shu yerga qo'ying — ulanishdan keyin
    // Majburiy kanallar ro'yxatini bazadan yuklash
    try {
      const channelsData = await db.collection('required_channels').find().toArray();
      requiredChannels = channelsData.map(doc => doc.channel);
      console.log('Majburiy kanallar yuklandi:', requiredChannels);
    } catch (err) {
      console.error('Majburiy kanallarni yuklashda xato:', err);
      requiredChannels = []; // xato bo'lsa bo'sh ro'yxat
    }

  } catch (err) {
    console.error("MongoDB ulanishda xato:", err);
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
    if (!anime) anime = await serials.findOne({ custom_id: payload });
    if (!anime) anime = await serials.findOne({ custom_id: { $regex: new RegExp(`^${payload}$`, 'i') } });

    if (anime && anime.added_by) {
      const addedByNum = Number(anime.added_by);
      const partner = await partners.findOne({ user_id: addedByNum });
      if (partner && partner.banned) {
        console.log(`Anime topildi lekin hamkor banlangan: ${anime.title}`);
        return null; // Vaqtincha ko'rinmas
      }
    }

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


async function get_required_channels() {
  const doc = await settings.findOne({ key: "additional_channels" });
  return [`@${SUB_CHANNEL}`].concat(doc?.channels || []);
}

async function get_user_required_channels(user_id, anime = null) {
  // 1. Global majburiy kanallar (SakuramiTG + /addchannel bilan qo‘shilganlar)
  let channels = await get_required_channels();

  // 2. Region kanallari (agar kerak bo‘lsa)
  const user = await users.findOne({ user_id });
  if (user && user.region) {
    const doc = await settings.findOne({ key: "region_channels" });
    if (doc && doc.channels && doc.channels[user.region]) {
      channels = channels.concat(doc.channels[user.region]);
    }
  }

  // 3. Hamkorning kanali – ENG MUHIM O‘ZGARTIRISH
  if (anime && anime.added_by) {
    const addedByNum = Number(anime.added_by);

    // Agar Number ga aylantirish muvaffaqiyatsiz bo'lsa, o'tkazib yuboramiz
    if (isNaN(addedByNum)) {
        console.log(`Noto'g'ri added_by qiymati: ${anime.added_by} (anime: ${anime.title || 'noma\'lum'})`);
        return; // yoki continue;
    }

    console.log(`Hamkor qidirilmoqda: added_by = ${addedByNum} (anime: ${anime.title || 'noma\'lum'})`);

    const partner = await partners.findOne({ user_id: addedByNum });

    if (partner && partner.partner_channel) {
        let partnerCh = String(partner.partner_channel).trim();

        // Bo'sh yoki faqat probel bo'lsa — qo'shmaymiz
        if (!partnerCh) {
            console.log(`Hamkorning partner_channel maydoni bo'sh yoki null: user_id=${addedByNum}`);
            return;
        }

        // Standart formatga keltiramiz
        if (!partnerCh.startsWith('@') && 
            !partnerCh.startsWith('-100') && 
            !partnerCh.startsWith('https://t.me/') && 
            !partnerCh.startsWith('+')) {
            partnerCh = `@${partnerCh}`;
        }

        // Juda qisqa yoki shubhali qiymatlarni filtrlaymiz
        if (partnerCh.length < 3 || partnerCh === '@') {
            console.log(`Noto'g'ri yoki bo'sh kanal nomi rad etildi: ${partnerCh}`);
            return;
        }

        // Nihoyat qo'shamiz
        channels.push(partnerCh);
        console.log(`Hamkor kanali qo'shildi: ${partnerCh} (user_id=${addedByNum})`);
    } else {
        console.log(
            partner 
                ? `Hamkor topildi lekin kanal o'rnatilmagan: user_id=${addedByNum}`
                : `Hamkor topilmadi: user_id=${addedByNum}`
        );
    }
}

  // 4. Anime'ga maxsus qo‘shilgan kanallar
  if (anime && anime.required_channels?.length) {
    channels = channels.concat(anime.required_channels);
  }

  // 5. Dublikatlarni olib tashlash
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
  try {
    await bot.answerCallbackQuery(query.id);
  } catch (e) {
    if (!e.message?.includes('query is too old')) {
      console.error('answerCallbackQuery xatosi:', e);
    }
  }

  if (!query.message) return;

  const chat_id    = query.message.chat.id;
  const message_id = query.message.message_id;
  const user_id    = query.from.id;
  const data       = query.data;

  // ──────────────────────────────────────────────
  // ORQAGA / ASOSIY MENYU
  // ──────────────────────────────────────────────
  if (data === "admin_main" || data === "back_to_admin" ||
      data.endsWith("_back") || data === "back" ||
      data === "back_to_start") {

    if (data === "back_to_start") {
      await send_start_banner(chat_id);
      return;
    }

    const text = "⚙️ <b>Asosiy boshqaruv paneli</b>\n\nTanlang:";
    const kb = {
      inline_keyboard: [
        [{ text: "🎬 Anime boshqaruvi",     callback_data: "admin_anime_menu" }],
        [{ text: "🤝 Hamkorlar",            callback_data: "admin_partners_menu" }],
        [{ text: "🚫 Foydalanuvchilar / Ban", callback_data: "admin_users_ban" }],
        [{ text: "⚙️ Sozlamalar",          callback_data: "admin_settings" }],
        [{ text: "📊 Statistika",           callback_data: "admin_stats" }],
        [{ text: "← Chiqish",               callback_data: "back_to_start" }]
      ]
    };

    try {
      await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
    } catch {
      bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }

  // ──────────────────────────────────────────────
  // Region tanlash
  // ──────────────────────────────────────────────
  if (data.startsWith("set_region_")) {
    const region = data.replace("set_region_", "");
    if (REGIONS.includes(region)) {
      await users.updateOne({ user_id }, { $set: { region } });
      bot.sendMessage(chat_id, `Rahmat! Siz ${region} ni tanladingiz 🌟`);
      try { await bot.deleteMessage(chat_id, message_id); } catch {}
    }
    return;
  }

  // Admin bo'limlariga kirishni cheklash
  const isAdminSection = data.includes("admin_") || data.includes("news_") || data.includes("settings_");
  if (isAdminSection && !is_admin(user_id)) {
    bot.sendMessage(chat_id, "🚫 Bu bo‘lim faqat adminlar uchun.");
    return;
  }

  // ──────────────────────────────────────────────
  // ANIME QISMLARI
  // ──────────────────────────────────────────────

  if (data.startsWith("episode:")) {
    const parts = data.split(":");
    if (parts.length !== 3) return;

    const animeId = parts[1];
    const epNumber = Number(parts[2]);

    try {
      const episode = await episodes.findOne({ serial_id: animeId, number: epNumber });
      if (!episode) {
        await bot.sendMessage(chat_id, `№${epNumber} qism topilmadi 😔`);
        return;
      }

      let caption = `🎬 ${episode.title || `Qism ${epNumber}`}`;
      if (episode.description) caption += `\n\n${episode.description}`;

      const kb = {
        inline_keyboard: [
          [
            epNumber > 1 ? { text: "◀️ Oldingi", callback_data: `episode:${animeId}:${epNumber-1}` } : { text: " ", callback_data: "ignore" },
            { text: "🔙 Ro'yxatga", callback_data: `episodes:${animeId}:1` },
            { text: "Keyingi ▶️", callback_data: `episode:${animeId}:${epNumber+1}` }
          ],
          [{ text: "← Anime tanlash", callback_data: "back_to_anime_list" }]
        ]
      };

      if (episode.file_id) {
        await bot.sendVideo(chat_id, episode.file_id, { caption, parse_mode: "HTML", reply_markup: kb });
      } else if (episode.video_url) {
        await bot.sendVideo(chat_id, episode.video_url, { caption, parse_mode: "HTML", reply_markup: kb });
      } else {
        await bot.sendMessage(chat_id, caption + "\n\nVideo hali yuklanmagan.", { parse_mode: "HTML", reply_markup: kb });
      }

      await serials.updateOne({ _id: animeId }, { $inc: { views: 1 } });
    } catch (err) {
      console.error("episode handler xatosi:", err);
      bot.sendMessage(chat_id, "Qismni ochib bo'lmadi 😢");
    }
    return;
  }

  if (data.startsWith("episodes:") || data.startsWith("page:")) {
    const parts = data.split(":");
    if (parts.length < 3) return;

    const animeId = parts[1];
    const page = Number(parts[2]) || 1;

    bot.sendMessage(chat_id, `Anime ${animeId} — sahifa ${page} (test)`);
    return;
  }

  // ──────────────────────────────────────────────
  // PLAY / CHECK_SUB_PLAY
  // ──────────────────────────────────────────────
  if (data.startsWith("check_sub_play_") || data.startsWith("play_")) {
    let cleanData = data.startsWith("check_sub_play_") ? data.replace("check_sub_play_", "play_") : data;

    const parts = cleanData.split("_");
    if (parts.length !== 3) {
      console.log("Noto'g'ri play format:", data);
      await bot.sendMessage(chat_id, "Noto'g'ri tugma formati.");
      return;
    }

    const animeUUID = parts[1].trim();
    const epNumber = Number(parts[2].trim());

    if (isNaN(epNumber) || epNumber < 1) {
      await bot.sendMessage(chat_id, "Qism raqami noto'g'ri.");
      return;
    }

    console.log(`🔍 Qidiruv → ${animeUUID} #${epNumber}`);

    try {
      const episode = await episodes.findOne({
        serial_id: animeUUID,
        part: epNumber
      });

      if (!episode) {
        console.log(`Topilmadi → ${animeUUID} #${epNumber}`);
        await bot.sendMessage(chat_id, `№${epNumber} qism topilmadi 😔`);
        return;
      }

      let caption = `🎬 ${episode.title || `Qism ${epNumber}`}`;
      if (episode.description) caption += `\n\n${episode.description}`;

      const kb = {
        inline_keyboard: [
          [
            epNumber > 1 ? { text: "◀️ Oldingi", callback_data: `check_sub_play_${animeUUID}_${epNumber-1}` } : { text: " ", callback_data: "ignore" },
            { text: "🔙 Ro'yxatga", callback_data: `episodes_${animeUUID}_1` },
            { text: "Keyingi ▶️", callback_data: `check_sub_play_${animeUUID}_${epNumber+1}` }
          ]
        ]
      };

      if (episode.file_id) {
        await bot.sendVideo(chat_id, episode.file_id, { caption, parse_mode: "HTML", reply_markup: kb });
      } else if (episode.video_url) {
        await bot.sendVideo(chat_id, episode.video_url, { caption, parse_mode: "HTML", reply_markup: kb });
      } else {
        await bot.sendMessage(chat_id, caption + "\n\n📥 Video hali yuklanmagan.", { parse_mode: "HTML", reply_markup: kb });
      }

      await serials.updateOne({ _id: animeUUID }, { $inc: { views: 1 } });
    } catch (err) {
      console.error("play handler xatosi:", err.message);
      await bot.sendMessage(chat_id, "Xatolik yuz berdi 😢");
    }
    return;
  }

  // ──────────────────────────────────────────────
  // ADMIN MENYULARI
  // ──────────────────────────────────────────────




  if (data === "admin_edit_anime") {
    if (!is_admin(user_id)) {
      return bot.sendMessage(chat_id, "🚫 Faqat adminlar uchun.");
    }
  
    bot.sendMessage(chat_id, "🎬 Tahrirlamoqchi bo‘lgan anime kodini yuboring (custom_id yoki _id):");
  
    const editListener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', editListener);
  
      const code = msg.text?.trim();
      if (!code) return bot.sendMessage(chat_id, "❌ Kod kiritilmadi.");
  
      const anime = await findAnime(code);
      if (!anime) return bot.sendMessage(chat_id, `❌ Anime topilmadi: ${code}`);
  
      // Hozircha faqat title o‘zgartirish (keyinroq boshqa maydonlarni qo‘shasiz)
      bot.sendMessage(chat_id, `✅ Topildi: <b>${anime.title}</b>\n\nYangi nomini yozing:`, { parse_mode: "HTML" });
  
      const titleListener = async (msg2) => {
        if (msg2.from.id !== user_id) return;
        bot.removeListener('message', titleListener);
  
        const newTitle = msg2.text?.trim();
        if (!newTitle) return bot.sendMessage(chat_id, "❌ Nom kiritilmadi.");
  
        await serials.updateOne(
          { _id: anime._id },
          { $set: { title: newTitle } }
        );
  
        bot.sendMessage(chat_id, `✅ Anime nomi yangilandi:\n<b>${newTitle}</b>`, { parse_mode: "HTML" });
      };
  
      bot.on('message', titleListener);
    };
  
    bot.on('message', editListener);
    return;
  }










  if (data === "admin_anime_menu") {
    const text = `🎬 <b>Anime boshqaruvi</b>\n\nTanlang:`;
    const kb = {
      inline_keyboard: [
        [{ text: "➕ Yangi anime qo'shish", callback_data: "admin_add_anime" }],
        [{ text: "✏️ Anime tahrirlash", callback_data: "admin_edit_anime" }],
        [{ text: "🗑 Anime o'chirish", callback_data: "admin_delete_anime" }],
        [{ text: "🔍 Anime ma'lumotlari", callback_data: "admin_anime_info" }],
        [{ text: "📋 Barcha animelar", callback_data: "admin_animelist" }],
        [{ text: "← Orqaga", callback_data: "admin_main" }]
      ]
    };
    try {
      await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
    } catch {
      bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }

  if (data === "admin_partners_menu") {
    const text = "🤝 <b>Hamkorlar boshqaruvi</b>\n\nTanlang:";
    const kb = {
      inline_keyboard: [
        [{ text: "➕ Hamkor qo'shish", callback_data: "admin_add_partner" }],
        [{ text: "📋 Hamkorlar ro'yxati", callback_data: "admin_partnerlist" }],
        [{ text: "← Orqaga", callback_data: "admin_main" }]
      ]
    };
    try {
      await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
    } catch {
      await bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }

  if (data === "admin_add_anime") {
    const uid = query.from.id;
    if (!is_admin(uid) && !(await is_partner(uid))) {
      return bot.sendMessage(chat_id, "❌ Bu faqat admin yoki hamkorlar uchun.");
    }
    addAnimeSteps.set(uid, { step: 'title', data: {} });
    bot.sendMessage(chat_id, "Anime nomini yozing:");
    return;
  }

  if (data === "admin_partnerlist") {
    const allPartners = await partners.find().toArray();
    if (allPartners.length === 0) return bot.sendMessage(chat_id, "Hamkor yo'q");
    let text = "<b>👥 Hamkorlar:</b>\n\n";
    allPartners.forEach(p => {
      text += `ID: ${p.user_id} | Holat: ${p.banned ? 'Banlangan' : 'Faol'}\n`;
    });
    bot.sendMessage(chat_id, text);
    return;
  }

  if (data === "admin_settings") {
    const text = `⚙️ <b>Sozlamalar bo‘limi</b>\n\nQuyidagi sozlamalardan birini tanlang:`;
    const kb = {
      inline_keyboard: [
        [{ text: "📢 Majburiy kanallar", callback_data: "settings_channels" }],
        [{ text: "📰 News kanallar", callback_data: "settings_news_channels" },
         { text: "🔄 Bot holatini yangilash", callback_data: "settings_refresh" }],
        [{ text: "← Orqaga", callback_data: "admin_main" }]
      ]
    };
    try {
      await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
    } catch {
      await bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }



// Majburiy kanallar menyusi
if (data === "settings_channels") {
  if (!is_admin(user_id)) return bot.sendMessage(chat_id, "Faqat adminlar uchun.");

  const channels = await get_required_channels(); // sizda bor funksiya

  let text = "📢 <b>Majburiy obuna kanallari</b>\n\n";
  if (channels.length === 0) {
    text += "Hozircha majburiy kanal yo‘q.";
  } else {
    channels.forEach(ch => text += `• ${ch}\n`);
  }

  const kb = {
    inline_keyboard: [
      [{ text: "➕ Kanal qo'shish", callback_data: "add_required_channel" }],
      [{ text: "🗑 Kanal o'chirish", callback_data: "remove_required_channel" }],
      [{ text: "← Orqaga", callback_data: "admin_settings" }]
    ]
  };

  try {
    await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
  } catch {
    bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
  }
  return;
}

// Majburiy kanal qo'shish
if (data === "add_required_channel") {
  if (!is_admin(user_id)) return;
  bot.sendMessage(chat_id, "➕ Majburiy kanalni yuboring (@username yoki -100... ID):");

  const addListener = async (msg) => {
    if (msg.from.id !== user_id) return;
    bot.removeListener('message', addListener);

    const channel = msg.text.trim();
    await add_required_channel(channel); // sizda bor funksiya

    bot.sendMessage(chat_id, `✅ Kanal qo'shildi: ${channel}`);
  };
  bot.on('message', addListener);
  return;
}

// Majburiy kanal o'chirish
if (data === "remove_required_channel") {
  if (!is_admin(user_id)) {
    bot.sendMessage(chat_id, "🚫 Faqat adminlar uchun.");
    return;
  }

  bot.sendMessage(chat_id, "🗑 O'chirmoqchi bo'lgan kanalni yuboring (@username yoki -100... ID):");

  const remListener = async (msg) => {
    // faqat shu foydalanuvchi yuborgan xabarni qayta ishlash
    if (msg.from.id !== user_id) return;

    // listenerni o'chirib tashlash (bir marta ishlasin)
    bot.removeListener('message', remListener);

    const channel = msg.text?.trim();
    
    if (!channel) {
      bot.sendMessage(chat_id, "❌ Hech narsa kiritilmadi.");
      return;
    }

    try {
      // Agar sizda majburiy kanallar array da saqlansa (oddiy variant)
      if (Array.isArray(requiredChannels)) {
        const index = requiredChannels.indexOf(channel);
        if (index !== -1) {
          requiredChannels.splice(index, 1);
          bot.sendMessage(chat_id, `✅ Kanal ro'yxatdan o'chirildi: ${channel}`);
        } else {
          bot.sendMessage(chat_id, `Kanal ro'yxatda topilmadi: ${channel}`);
        }
        return;
      }

      // Agar MongoDB collection da saqlansa (real loyiha uchun tavsiya)
      const result = await db.collection('required_channels').deleteOne({ channel: channel });
      
      if (result.deletedCount > 0) {
        bot.sendMessage(chat_id, `✅ Kanal bazadan o'chirildi: ${channel}`);
      } else {
        bot.sendMessage(chat_id, `Kanal bazada topilmadi: ${channel}`);
      }

    } catch (err) {
      console.error("Kanal o'chirishda xato:", err);
      bot.sendMessage(chat_id, "Xatolik yuz berdi. Kanal o'chirilmadi 😔");
    }
  };

  // listenerni qo'shamiz
  bot.on('message', remListener);

  // 5 daqiqadan keyin avtomatik o'chirib qo'yish (eski listener qolmasligi uchun)
  setTimeout(() => {
    bot.removeListener('message', remListener);
  }, 5 * 60 * 1000); // 5 daqiqa

  return;
}




if (data === "settings_refresh") {
  if (!is_admin(user_id)) {
    return bot.sendMessage(chat_id, "Faqat adminlar uchun.");
  }

  let message = "♻️ Bot yangilandi!\n\n";

  // 1. Majburiy kanallar ro'yxatini qayta yuklash (agar sizda shunday funksiya bo'lsa)
  requiredChannels = await get_required_channels();  // bazadan qayta o'qib olamiz
  message += "• Majburiy kanallar yangilandi\n";

  // 2. News kanallar ro'yxatini yangilash
  newsChannels = await get_news_channels();
  message += "• News kanallar yangilandi\n";

  // 3. Cache tozalash (agar ishlatayotgan bo'lsangiz)
  if (globalCache && typeof globalCache.clear === "function") {
    globalCache.clear();
    message += "• Cache tozalandi\n";
  }

  // 4. Statistikani qayta hisoblash (eng sodda varianti)
  const stats = {
    users: await users.countDocuments(),
    anime: await serials.countDocuments(),
    episodes: await episodes.countDocuments()
  };
  message += `• Statistikalar yangilandi\n  👥 Foydalanuvchilar: ${stats.users}\n  🎬 Animelar: ${stats.anime}\n  📼 Qismlar: ${stats.episodes}`;

  bot.sendMessage(chat_id, message, { parse_mode: "HTML" });
  return;
}





  if (data === "admin_news_menu") {
    const text = `📢 <b>Yangiliklar & E'lonlar bo‘limi</b>\n\nQuyidagi amallardan birini tanlang:`;
    const kb = {
      inline_keyboard: [
        [
          { text: "➕ Yangi anime e'lon qilish", callback_data: "news_publish_anime" },
          { text: "➕ Oddiy e'lon yuborish", callback_data: "news_send_message" }
        ],
        [
          { text: "📋 News kanallar ro'yxati", callback_data: "news_list_channels" },
          { text: "➕ News kanal qo'shish", callback_data: "news_add_channel" }
        ],
        [
          { text: "🗑 News kanal o'chirish", callback_data: "news_remove_channel" },
          { text: "← Orqaga", callback_data: "admin_main" }
        ]
      ]
    };
    try {
      await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
    } catch {
      await bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }

  if (data === "admin_users_ban") {
    const text = `🚫 <b>Foydalanuvchilar / Ban boshqaruvi</b>\n\nQuyidagi amallardan birini tanlang:`;
    const kb = {
      inline_keyboard: [
        [{ text: "➕ Yangi foydalanuvchi banlash", callback_data: "ban_new_user" }],
        [{ text: "✅ Blokdan chiqarish", callback_data: "unban_user" }],
        [{ text: "📋 Bloklanganlar ro'yxati", callback_data: "ban_list" }],
        [{ text: "← Orqaga", callback_data: "admin_main" }]
      ]
    };
    try {
      await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
    } catch {
      await bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }



  if (data === "admin_stats") {
    if (!is_admin(user_id)) {
      return bot.sendMessage(chat_id, "🚫 Faqat adminlar uchun.");
    }
  
    try {
      const totalUsers = await users.countDocuments();
      const totalAnime = await serials.countDocuments();
      const totalEpisodes = await episodes.countDocuments();
      const totalViews = await serials.aggregate([{ $group: { _id: null, sum: { $sum: "$views" } } }]).toArray();
      const views = totalViews[0] ? totalViews[0].sum : 0;
  
      const text = `📊 <b>Bot statistikasi</b>\n\n` +
                   `👥 Foydalanuvchilar: <b>${totalUsers}</b>\n` +
                   `🎬 Animelar: <b>${totalAnime}</b>\n` +
                   `📼 Qismlar: <b>${totalEpisodes}</b>\n` +
                   `👁 Umumiy ko‘rishlar: <b>${views}</b>`;
  
      bot.sendMessage(chat_id, text, { parse_mode: "HTML" });
    } catch (err) {
      bot.sendMessage(chat_id, "Statistikani yuklashda xatolik yuz berdi.");
    }
    return;
  }






  if (data === "admin_animelist") {
    if (!is_admin(user_id)) {
      return bot.sendMessage(chat_id, "🚫 Bu bo‘lim faqat adminlar uchun.");
    }

    const all = await serials.find().sort({ title: 1 }).toArray();
    if (all.length === 0) return bot.sendMessage(chat_id, "❌ Hozircha anime yo‘q");

    const episode_counts = await episodes.aggregate([
      { $group: { _id: "$serial_id", count: { $sum: 1 } } }
    ]).toArray();
    const serial_counts = new Map(episode_counts.map(c => [c._id, c.count]));

    let text = `<b>📋 Anime Ro‘yxati (${all.length} ta)</b>\n\n`;
    for (let a of all) {
      const eps = serial_counts.get(a._id) || 0;
      text += `<b>${a.title}</b>\nKod: ${a.custom_id || 'yo‘q'} | ${eps}/${a.total} qism\n\n`;
    }

    if (text.length > 4000) {
      text = text.substring(0, 3900) + "\n... (ko'p animelar bor)";
    }

    bot.sendMessage(chat_id, text, { parse_mode: "HTML" });
    return;
  }

  // ──────────────────────────────────────────────
  // NEWS va BAN / UNBAN / DELETE handlerlari
  // ──────────────────────────────────────────────

  if (data === "news_publish_anime") {
    if (!is_admin(user_id)) {
      return bot.sendMessage(chat_id, "🚫 Bu funksiya faqat adminlar uchun.");
    }

    bot.sendMessage(chat_id, "🎬 Qaysi animeni e'lon qilmoqchisiz?\nAnime kodini yuboring (custom_id yoki _id):");

    const listener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', listener);

      const animeCode = msg.text.trim();
      if (!animeCode) return bot.sendMessage(chat_id, "❌ Anime kodi kiritilmadi.");

      const anime = await findAnime(animeCode);
      if (!anime) return bot.sendMessage(chat_id, `❌ Anime topilmadi: ${animeCode}`);

      const confirmText = `✅ ${anime.title} ni yangilik sifatida yuborishni xohlaysizmi?\nKod: ${anime.custom_id || anime._id}`;

      const kb = {
        inline_keyboard: [
          [
            { text: "Ha, yubor!", callback_data: `confirm_publish_${anime._id}` },
            { text: "Yo'q, bekor qil", callback_data: "cancel_publish" }
          ]
        ]
      };

      bot.sendMessage(chat_id, confirmText, { reply_markup: kb, parse_mode: "HTML" });
    };

    bot.on('message', listener);
    return;
  }

  if (data === "news_list_channels") {
    if (!is_admin(user_id)) {
      return bot.sendMessage(chat_id, "🚫 Bu bo‘lim faqat adminlar uchun.");
    }

    const channels = await get_news_channels();

    let text = `<b>📰 News kanallar ro'yxati</b>\n\n`;
    if (channels.length === 0) {
      text += "Hozircha hech qanday news kanal qo'shilmagan.\nAsosiy kanal: @SakuramiTG";
    } else {
      channels.forEach(ch => text += `• ${ch}\n`);
      text += `\nJami: ${channels.length} ta kanal`;
    }

    const kb = {
      inline_keyboard: [
        [{ text: "← Orqaga (Yangiliklar bo'limiga)", callback_data: "admin_news_menu" }],
        [{ text: "← Asosiy menyuga", callback_data: "admin_main" }]
      ]
    };

    try {
      await bot.editMessageText(text, { chat_id, message_id, parse_mode: "HTML", reply_markup: kb });
    } catch {
      await bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: kb });
    }
    return;
  }

  if (data === "admin_edit_anime") {
    if (!is_admin(user_id)) {
      return bot.sendMessage(chat_id, "🚫 Faqat adminlar uchun.");
    }
    bot.sendMessage(chat_id, "Tahrir qilmoqchi bo'lgan anime kodini yuboring (custom_id yoki _id):");

    const editListener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', editListener);

      const code = msg.text?.trim();
      if (!code) return bot.sendMessage(chat_id, "Kod kiritilmadi.");

      const anime = await findAnime(code);
      if (!anime) return bot.sendMessage(chat_id, `Anime topilmadi: ${code}`);

      bot.sendMessage(chat_id, `Topildi: ${anime.title}\n\nNima o'zgartirmoqchisiz?`);
      // Bu yerda keyingi step qo'shishingiz mumkin
    };
    bot.on('message', editListener);
    return;
  }

  if (data === "admin_delete_anime") {
    if (!is_admin(user_id)) return bot.sendMessage(chat_id, "Faqat adminlar uchun.");
    bot.sendMessage(chat_id, "O'chirmoqchi bo'lgan anime kodini yuboring (custom_id yoki _id):");

    const deleteListener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', deleteListener);

      const code = msg.text?.trim();
      if (!code) return bot.sendMessage(chat_id, "Kod kiritilmadi.");

      const anime = await findAnime(code);
      if (!anime) return bot.sendMessage(chat_id, `Topilmadi: ${code}`);

      const confirmKb = {
        inline_keyboard: [[
          { text: "Ha, o'chir!", callback_data: `confirm_delete_${anime._id}` },
          { text: "Yo'q", callback_data: "cancel_delete" }
        ]]
      };
      bot.sendMessage(chat_id, `Haqiqatan ham ${anime.title} ni o'chirasizmi?`, { reply_markup: confirmKb });
    };
    bot.on('message', deleteListener);
    return;
  }

  if (data.startsWith("confirm_delete_")) {
    if (!is_admin(user_id)) return;
    const animeId = data.replace("confirm_delete_", "");

    await serials.deleteOne({ _id: animeId });
    await episodes.deleteMany({ serial_id: animeId });

    bot.sendMessage(chat_id, "✅ Anime o'chirildi.");
    return;
  }

  if (data === "cancel_delete") {
    bot.sendMessage(chat_id, "O'chirish bekor qilindi.");
    return;
  }

  if (data === "admin_anime_info") {
    if (!is_admin(user_id)) {
      return bot.sendMessage(chat_id, "🚫 Faqat adminlar uchun.");
    }

    bot.sendMessage(chat_id, "Ma'lumotini ko'rmoqchi bo'lgan anime kodini yuboring (custom_id yoki _id):");

    const infoListener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', infoListener);

      const code = msg.text?.trim();
      if (!code) return bot.sendMessage(chat_id, "❌ Kod kiritilmadi.");

      const anime = await findAnime(code);
      if (!anime) return bot.sendMessage(chat_id, `❌ Anime topilmadi: ${code}`);

      let genresText = "—";
      if (Array.isArray(anime.genres)) {
        genresText = anime.genres.length > 0 ? anime.genres.join(", ") : "—";
      } else if (typeof anime.genres === 'string' && anime.genres.trim()) {
        genresText = anime.genres.trim();
      }

      const descriptionText = anime.description ? 
        `\n<b>Tavsif:</b> ${anime.description.substring(0, 300)}${anime.description.length > 300 ? '...' : ''}` : "";

      const text = 
        `🎬 <b>${anime.title || "Noma'lum"}</b>\n\n` +
        `ID: <code>${anime._id}</code>\n` +
        `Custom ID: ${anime.custom_id || "yo'q"}\n` +
        `Qismlar soni: ${anime.total || "?"} ta\n` +
        `Ko'rishlar: ${anime.views || 0}\n` +
        `Janrlar: ${genresText}\n` +
        `Trailer: ${anime.trailer || "yo'q"}\n` +
        `Poster: ${anime.poster ? "mavjud" : "yo'q"}\n` +
        descriptionText;

      bot.sendMessage(chat_id, text, { parse_mode: "HTML" });
    };

    bot.on('message', infoListener);
    return;
  }

  if (data === "ban_new_user") {
    if (!is_admin(user_id)) return bot.sendMessage(chat_id, "Faqat adminlar uchun.");
    bot.sendMessage(chat_id, "Ban qilmoqchi bo'lgan user ID sini yuboring:");

    const banListener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', banListener);

      const targetId = Number(msg.text.trim());
      if (isNaN(targetId)) return bot.sendMessage(chat_id, "Noto'g'ri ID.");

      if (is_admin(targetId)) return bot.sendMessage(chat_id, "Adminlarni ban qilib bo'lmaydi!");

      const kb = {
        inline_keyboard: [[
          { text: "Ha, ban qil", callback_data: `do_ban_${targetId}` },
          { text: "Yo'q", callback_data: "cancel_ban" }
        ]]
      };
      bot.sendMessage(chat_id, `ID: ${targetId}\n\nBan qilasizmi?`, { reply_markup: kb });
    };
    bot.on('message', banListener);
    return;
  }

  if (data.startsWith("do_ban_")) {
    if (!is_admin(user_id)) return;
    const targetId = Number(data.replace("do_ban_", ""));

    await users.updateOne(
      { user_id: targetId },
      { $set: { banned: true, banned_by: user_id, banned_at: new Date() } },
      { upsert: true }
    );

    bot.sendMessage(chat_id, `✅ User ${targetId} ban qilindi.`);
    try { await bot.sendMessage(targetId, "Siz botdan bloklandingiz."); } catch {}
    return;
  }

  if (data === "cancel_ban") {
    bot.sendMessage(chat_id, "Ban bekor qilindi.");
    return;
  }

  if (data === "unban_user") {
    if (!is_admin(user_id)) return bot.sendMessage(chat_id, "Faqat adminlar uchun.");
    bot.sendMessage(chat_id, "Blokdan chiqarmoqchi bo'lgan user ID sini yuboring:");

    const unbanListener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', unbanListener);

      const targetId = Number(msg.text.trim());
      if (isNaN(targetId)) return bot.sendMessage(chat_id, "Noto'g'ri ID.");

      const result = await users.updateOne(
        { user_id: targetId },
        { $set: { banned: false, banned_by: null, banned_at: null } }
      );

      if (result.matchedCount === 0) {
        bot.sendMessage(chat_id, `User ${targetId} topilmadi yoki ban qilinmagan.`);
      } else {
        bot.sendMessage(chat_id, `✅ User ${targetId} blokdan chiqarildi.`);
        try { await bot.sendMessage(targetId, "Blokingiz ochildi!"); } catch {}
      }
    };
    bot.on('message', unbanListener);
    return;
  }

  if (data === "ban_list") {
    if (!is_admin(user_id)) return bot.sendMessage(chat_id, "Faqat adminlar uchun.");
    
    const banned = await users.find({ banned: true }).toArray();
    let txt = "<b>🚫 Bloklangan foydalanuvchilar:</b>\n\n";
    
    if (banned.length === 0) {
      txt += "Hozircha yo'q.";
    } else {
      banned.forEach(u => {
        txt += `• ID: ${u.user_id} | Ban qilgan: ${u.banned_by || "—"} | Sana: ${u.banned_at ? new Date(u.banned_at).toLocaleDateString() : "—"}\n`;
      });
    }
    bot.sendMessage(chat_id, txt, { parse_mode: "HTML" });
    return;
  }

  if (data === "admin_add_partner") {
    if (!is_admin(user_id)) return bot.sendMessage(chat_id, "Faqat adminlar uchun.");
    bot.sendMessage(chat_id, "Hamkor qilmoqchi bo'lgan user ID sini yuboring:");

    const partnerListener = async (msg) => {
      if (msg.from.id !== user_id) return;
      bot.removeListener('message', partnerListener);

      const partnerId = Number(msg.text.trim());
      if (isNaN(partnerId)) return bot.sendMessage(chat_id, "Noto'g'ri ID.");

      await partners.updateOne(
        { user_id: partnerId },
        { $setOnInsert: { user_id: partnerId, added_by: user_id, added_at: new Date(), banned: false } },
        { upsert: true }
      );

      bot.sendMessage(chat_id, `✅ User ${partnerId} hamkor sifatida qo'shildi.`);
    };
    bot.on('message', partnerListener);
    return;
  }

  // ──────────────────────────────────────────────
  // NOMA'LUM CALLBACK
  // ──────────────────────────────────────────────
  console.log(`Noma'lum callback data: ${data}`);
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
  try {
    const anime = await serials.findOne({ _id: serial_id });
    if (!anime) {
      return bot.sendMessage(chat_id, "❌ Anime topilmadi...");
    }

    const episode = await episodes.findOne({ serial_id, part });
    if (!episode) {
      return bot.sendMessage(chat_id, "❌ Bu qism hali yuklanmagan, azizim! Tez orada yuklaymiz! 😊");
    }

    // Muhim tekshiruv: file_id mavjud va string ekanligini tekshirish
    if (!episode.file_id || typeof episode.file_id !== 'string' || episode.file_id.trim() === '') {
      console.error(`[INVALID FILE_ID] Anime: ${anime.title || serial_id}, Part: ${part}, file_id: ${episode.file_id}`);
      return bot.sendMessage(chat_id, `❌ ${anime.title} — ${part}-qism video yuklanmagan yoki buzilgan. Admin bilan bog'laning (@${ADMIN_USERNAME})`);
    }

    // Debug log (muammoni aniqlash uchun)
    console.log(`[SEND EPISODE] Anime: ${anime.title || serial_id}, Part: ${part}, file_id: ${episode.file_id.substring(0, 20)}...`);

    // Views ni oshirish
    await serials.updateOne({ _id: serial_id }, { $inc: { views: 1 } });

    // Markup va tugmalar (sizning eski kodingiz)
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

    // Video yuborish – try-catch ichida
    await bot.sendVideo(chat_id, episode.file_id, {
      caption: `${anime.title} — ${part}-qism – Zavq oling, azizim! 😘`,
      reply_markup: markup
    });

  } catch (err) {
    console.error(`[SEND_EPISODE_ERROR] Anime: ${serial_id}, Part: ${part}`, err.message);

    // Foydalanuvchiga tushunarli xabar
    bot.sendMessage(chat_id, 
      "❌ Video yuborishda xato yuz berdi.\n" +
      "Bu qism yuklanmagan yoki eskirgan bo'lishi mumkin.\n" +
      "Admin bilan bog'laning: @" + ADMIN_USERNAME
    );
  }
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
// -------------------------------
// Admin panel menyusi
// -------------------------------
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const uid = msg.from.id;

  if (!is_admin(uid)) {
    return bot.sendMessage(chatId, "🚫 Bu buyruq faqat adminlar uchun.");
  }

  const adminMenuText = `
👑 <b>ADMIN PANELI</b>  |  Rimika Anime Bot

Quyidagi bo‘limlardan birini tanlang:

⚙️ Asosiy boshqaruv
🎬 Anime va qismlar
📢 E'lon va yangiliklar
👥 Foydalanuvchilar / Ban
🤝 Hamkorlar boshqaruvi
📊 Statistika va monitoring
🛠 Qo‘shimcha sozlamalar
  `.trim();

  const markup = {
    inline_keyboard: [
      [
        { text: "🎬 Anime boshqaruvi", callback_data: "admin_anime_menu" },
      ],
      [
        { text: "🌟 Yangi anime qo'shish", callback_data: "admin_add_anime" }
      ],
      [
        { text: "👥 Foydalanuvchilar", callback_data: "admin_users_ban" },
        { text: "🤝 Hamkorlar", callback_data: "admin_partners_menu" }
      ],
      [
        { text: "📊 Statistika", callback_data: "admin_stats" },
        { text: "⚙️ Sozlamalar", callback_data: "admin_settings" }
      ],
      [
        { text: "🔙 Bosh menyuga", callback_data: "back_to_start" }
      ]
    ]
  };

  await bot.sendMessage(chatId, adminMenuText, {
    parse_mode: "HTML",
    reply_markup: markup
  });
});







bot.onText(/\/news_list_channels/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!is_admin(userId)) {
    return bot.sendMessage(chatId, "🚫 Bu buyrug‘ faqat adminlar uchun.");
  }

  const channels = await get_news_channels(); // sizda allaqachon bor funksiya

  let text = "📰 <b>News kanallar ro'yxati</b>\n\n";
  
  if (channels.length === 0) {
    text += "Hozircha hech qanday news kanal qo'shilmagan.\nAsosiy kanal: @SakuramiTG";
  } else {
    channels.forEach(ch => {
      let display = ch;
      if (ch.startsWith('@')) display = ch;
      else if (ch.startsWith('-100')) display = `Guruh ID: ${ch}`;
      else display = ch;
      text += `• ${display}\n`;
    });
    text += `\nJami: ${channels.length} ta kanal`;
  }

  bot.sendMessage(chatId, text, { parse_mode: "HTML" });
});









// Admin uchun: istalgan hamkorning animelari va qismlari holatini ko'rish
bot.onText(/\/checkpartneranimes(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "❌ Bu buyruq faqat adminlar uchun.");
  }

  if (!match[1]) {
    return bot.sendMessage(msg.chat.id, "Foydalanish: /checkpartneranimes <hamkor_user_id>\nMasalan: /checkpartneranimes 123456789");
  }

  const targetUid = parseInt(match[1].trim());
  if (isNaN(targetUid)) {
    return bot.sendMessage(msg.chat.id, "❌ User ID raqam bo'lishi kerak.");
  }

  const partner = await partners.findOne({ user_id: targetUid });
  if (!partner) {
    return bot.sendMessage(msg.chat.id, `❌ ${targetUid} hamkor emas yoki topilmadi.`);
  }

  if (!partner.added_animes?.length) {
    return bot.sendMessage(msg.chat.id, `${targetUid} hamkor bo'lsa ham hali hech qanday anime qo'shmagan.`);
  }

  let text = `<b>🎬 Hamkor ${targetUid} qo'shgan animelar (${partner.added_animes.length} ta):</b>\n\n`;

  for (let animeId of partner.added_animes) {
    const anime = await serials.findOne({ _id: animeId });
    if (!anime) {
      text += `⚠️ Anime topilmadi (ID: ${animeId})\n\n`;
      continue;
    }

    // Yuklangan qismlar soni
    const loadedCount = await episodes.countDocuments({ serial_id: anime._id });

    // Yuklanmagan qismlarni aniqlash
    const missingParts = [];
    for (let p = 1; p <= anime.total; p++) {
      const exists = await episodes.findOne({ serial_id: anime._id, part: p });
      if (!exists) missingParts.push(p);
    }

    text += `🎥 <b>${anime.title}</b>\n`;
    text += `Kod: ${anime.custom_id || anime._id}\n`;
    text += `Umumiy qismlar: ${anime.total}\n`;
    text += `Yuklangan: ${loadedCount} ta\n`;

    if (missingParts.length === 0) {
      text += `✅ Barcha qismlar yuklangan\n`;
    } else if (missingParts.length > 10) {
      text += `❌ Yuklanmagan qismlar: ${missingParts.length} ta (masalan: ${missingParts.slice(0,5).join(', ')} ...)\n`;
    } else {
      text += `❌ Yuklanmagan: ${missingParts.join(', ')}\n`;
    }

    text += `Ko'rishlar: ${anime.views || 0}\n\n`;
  }

  // Matn uzunligi chegarasini hisobga olish
  if (text.length > 4000) {
    text = text.substring(0, 3900) + "\n... (ko'p animelar bor, batafsil ma'lumot uchun admin panel yoki loglarni tekshiring)";
  }

  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/deletepartneranimes/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "Barcha animelari o'chiriladigan hamkor user ID:").then(() => {
    bot.once('message', async (response) => {
      const uid = parseInt(response.text.trim());
      if (isNaN(uid)) {
        bot.sendMessage(response.chat.id, "❌ User ID raqam bo'lishi kerak");
        return;
      }
      const partner = await partners.findOne({ user_id: uid });
      if (!partner || !partner.added_animes.length) {
        bot.sendMessage(response.chat.id, "❌ Hamkor yoki animelar topilmadi");
        return;
      }
      // Animelarni o'chirish
      await serials.deleteMany({ _id: { $in: partner.added_animes } });
      await episodes.deleteMany({ serial_id: { $in: partner.added_animes } });
      // Partnerdan added_animes ni tozalash (agar kerak bo'lsa)
      await partners.updateOne({ user_id: uid }, { $set: { added_animes: [] } });
      bot.sendMessage(response.chat.id, `✅ ${uid} ning ${partner.added_animes.length} ta animelari o'chirildi.`);
    });
  });
});

// Hamkor banlash
bot.onText(/\/banpartner/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "Ban qilinadigan hamkor user ID:").then(() => {
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
      await partners.updateOne({ user_id: uid }, { $set: { banned: true } });
      bot.sendMessage(response.chat.id, `🚫 ${uid} hamkor banlandi. Uning animelari vaqtincha ko'rinmaydi.`);
    });
  });
});

// Hamkor bandan chiqarish
bot.onText(/\/unbanpartner/, (msg) => {
  if (!is_admin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, "Bandan chiqariladigan hamkor user ID:").then(() => {
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
      await partners.updateOne({ user_id: uid }, { $set: { banned: false } });
      bot.sendMessage(response.chat.id, `✅ ${uid} hamkor bandan chiqdi. Uning animelari endi ko'rinadi.`);
    });
  });
});

bot.onText(/\/addadmin(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const uid = msg.from.id;

  if (!is_admin(uid)) {
    return bot.sendMessage(chatId, "❌ Sizda bu buyruqni ishlatish huquqi yo'q. Faqat adminlar qo'sha oladi.");
  }

  const newAdminIdStr = match[1]?.trim();
  if (!newAdminIdStr) {
    return bot.sendMessage(chatId, "Foydalanish: /addadmin <user_id>\nMasalan: /addadmin 123456789");
  }

  const newAdminId = parseInt(newAdminIdStr);
  if (isNaN(newAdminId)) {
    return bot.sendMessage(chatId, "❌ User ID raqam bo'lishi kerak.");
  }

  if (is_admin(newAdminId)) {
    return bot.sendMessage(chatId, `❌ ${newAdminId} allaqachon admin.`);
  }

  // Yangi adminni qo'shamiz
  ADMIN_IDS.push(newAdminId);

  bot.sendMessage(chatId, `✅ ${newAdminId} adminlar ro'yxatiga qo'shildi!`);

  // Yangi adminni xabardor qilish (ixtiyoriy)
  try {
    await bot.sendMessage(newAdminId, "Siz botda admin huquqlariga ega bo'ldingiz! 🎉\nEndi /addanime, /stats va boshqa admin buyruqlarini ishlatishingiz mumkin.");
  } catch (e) {
    console.log(`Yangi admin (${newAdminId}) ga xabar yuborib bo'lmadi:`, e.message);
  }

  console.log(`Admin qo'shildi: ${newAdminId} tomonidan ${uid}`);
});

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
// ======================
// Kanal qo'shish / o'chirish / ro'yxatni ko'rsatish buyruqlari
// ======================
bot.onText(/\/(addchannel|removechannel|listchannels)(?:\s+(.+))?/, async (msg, match) => {
  if (!is_admin(msg.from.id)) return;

  const chatId = msg.chat.id;
  const cmd = match[1];
  const directArg = match[2] ? match[2].trim() : null;

  // Agar argument to'g'ridan-to'g'ri berilgan bo'lsa (masalan: /addchannel @test yoki /addchannel https://t.me/+xxx)
  if (directArg) {
    if (cmd === "addchannel") {
      await add_channel({ text: directArg, chat: { id: chatId } });
    } else if (cmd === "removechannel") {
      await remove_channel({ text: directArg, chat: { id: chatId } });
    }
    return;
  }

  // Aks holda – eski usul: savol berib, keyingi xabarni kutamiz
  if (cmd === "addchannel") {
    await bot.sendMessage(chatId, "Yangi kanal yuboring:\n\nMisollar:\n• @username\n• -1001234567890\n• https://t.me/+G24Ob_Ru_TKWkzNjQytsdfsd\n• +GOb_Ru_TKWkzNjQy");
    
    const listener = async (res) => {
      if (res.from.id !== msg.from.id) return;
      bot.removeListener('message', listener);
      await add_channel(res);
    };
    bot.on('message', listener);

  } else if (cmd === "removechannel") {
    await bot.sendMessage(chatId, "O‘chiriladigan kanalni yuboring:\n\nMisollar:\n• @username\n• -1001234567890\n• +GOb_Ru_TKWkzNjQy");

    const listener = async (res) => {
      if (res.from.id !== msg.from.id) return;
      bot.removeListener('message', listener);
      await remove_channel(res);
    };
    bot.on('message', listener);

  } else if (cmd === "listchannels") {
    // Har safar bazadan yangi o'qib olamiz – ishonchli
    const channels = await get_required_channels();

    if (channels.length === 0) {
      return bot.sendMessage(chatId, "Hozircha global majburiy kanal yo‘q (faqat asosiy @SakuramiTG ishlaydi)");
    }

    let text = "📋 Global majburiy obuna kanallari:\n\n";
    
    channels.forEach(ch => {
      if (ch.startsWith('@')) {
        text += `• ${ch} (public kanal)\n`;
      } else if (ch.startsWith('-100')) {
        text += `• ${ch} (guruh / super guruh)\n`;
      } else if (ch.startsWith('+')) {
        text += `• ${ch} (maxfiy invite link)\n`;
      } else {
        text += `• ${ch}\n`;
      }
    });

    text += `\nAsosiy kanal: @${SUB_CHANNEL} (har doim majburiy)`;

    bot.sendMessage(chatId, text);
  }
});



async function add_channel(msg) {
  let input = msg.text.trim();

  if (!input) {
    return bot.sendMessage(msg.chat.id, "❌ Kanal nomi yoki linkini kiriting!");
  }

  let channelIdentifier;

  try {
    if (input.startsWith('https://t.me/+') || input.startsWith('+')) {
      // Maxfiy invite link
      const hash = input.startsWith('https://t.me/+') 
        ? input.split('https://t.me/+')[1].split(/[/?# ]/)[0]
        : input.split(/[/?# ]/)[0];

      // Bot invite link orqali kanalga kirishga urinadi
      const chat = await bot.getChat(`https://t.me/+${hash}`);
      channelIdentifier = String(chat.id);  // -100xxxxxxxxxx formatida keladi

      if (!channelIdentifier.startsWith('-100')) {
        throw new Error("Invalid chat ID");
      }
    }
    else if (input.startsWith('https://t.me/c/')) {
      const idPart = input.split('https://t.me/c/')[1].split(/[/?# ]/)[0];
      channelIdentifier = `-100${idPart}`;
    }
    else if (input.startsWith('@')) {
      const chat = await bot.getChat(input);
      channelIdentifier = String(chat.id);
    }
    else if (input.startsWith('-100')) {
      channelIdentifier = input.split(/[ ]/)[0];
    }
    else {
      const username = `@${input.replace(/^@/, '')}`;
      const chat = await bot.getChat(username);
      channelIdentifier = String(chat.id);
    }

    // Bazaga -100... formatida saqlaymiz (eng ishonchli)
    const result = await settings.updateOne(
      { key: "additional_channels" },
      { $addToSet: { channels: channelIdentifier } },
      { upsert: true }
    );

    await update_required_channels();

    let response = result.modifiedCount || result.upsertedCount
      ? `✅ ${channelIdentifier} qo‘shildi`
      : `⚠️ ${channelIdentifier} allaqachon mavjud`;

    bot.sendMessage(msg.chat.id, response);

  } catch (err) {
    console.error("Kanal qo'shishda xato:", err.message);
    bot.sendMessage(msg.chat.id, `❌ Xato: ${err.message || "Kanal topilmadi yoki botda huquq yo'q"}\n\nBotni kanalga admin qiling yoki to'g'ri link yuboring.`);
  }
}



async function remove_channel(msg) {
  let input = msg.text.trim();

  if (!input) {
    return bot.sendMessage(msg.chat.id, "❌ O‘chiriladigan kanalni kiriting!");
  }

  let channelIdentifier;

  try {
    if (input.startsWith('https://t.me/+') || input.startsWith('+')) {
      const hash = input.startsWith('https://t.me/+') 
        ? input.split('https://t.me/+')[1].split(/[/?# ]/)[0]
        : input.split(/[/?# ]/)[0];
      const chat = await bot.getChat(`https://t.me/+${hash}`);
      channelIdentifier = String(chat.id);
    }
    else if (input.startsWith('https://t.me/c/')) {
      const idPart = input.split('https://t.me/c/')[1].split(/[/?# ]/)[0];
      channelIdentifier = `-100${idPart}`;
    }
    else if (input.startsWith('@')) {
      const chat = await bot.getChat(input);
      channelIdentifier = String(chat.id);
    }
    else if (input.startsWith('-100')) {
      channelIdentifier = input.split(/[ ]/)[0];
    }
    else {
      const username = `@${input.replace(/^@/, '')}`;
      const chat = await bot.getChat(username);
      channelIdentifier = String(chat.id);
    }

    const result = await settings.updateOne(
      { key: "additional_channels" },
      { $pull: { channels: channelIdentifier } }
    );

    

    bot.sendMessage(msg.chat.id, 
      result.modifiedCount 
        ? `✅ ${channelIdentifier} o‘chirildi` 
        : `❌ ${channelIdentifier} topilmadi yoki allaqachon o‘chirilgan`
    );

  } catch (err) {
    console.error("Kanal o'chirishda xato:", err.message);
    bot.sendMessage(msg.chat.id, `❌ Xato: ${err.message || "Kanal topilmadi yoki botda huquq yo'q"}`);
  }
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

bot.onText(/\/partnerlist/, async (msg) => {
  if (!is_admin(msg.from.id)) return;
  const allPartners = await partners.find().toArray();
  if (allPartners.length === 0) return bot.sendMessage(msg.chat.id, "❌ Hamkor yo'q");

  let text = "<b>👥 Hamkorlar ro'yxati:</b>\n\n";
  for (let p of allPartners) {
    let username = 'Noma\'lum';
    try {
      const user = await bot.getChat(p.user_id);
      username = user.username ? `@${user.username}` : (user.first_name || 'Noma\'lum');
    } catch (err) {
      console.error(`Username olish xatosi user ${p.user_id}:`, err.message);
    }
    const bannedStatus = p.banned ? '🚫 Banlangan' : '✅ Faol';
    text += `ID: ${p.user_id}\nUsername: ${username}\nKanal: ${p.partner_channel || 'Yo‘q'}\nAnimelar soni: ${p.added_animes.length}\nHolati: ${bannedStatus}\n\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
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
      await partners.insertOne({ user_id: uid, added_animes: [], partner_channel: null, banned: false });
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
      // Animelarni o'chirmaymiz, faqat hamkorlikni olamiz
      bot.sendMessage(response.chat.id, `✅ ${uid} hamkorlikdan chiqarildi. Animelar qoldi, kanal majburiy emas endi.`);
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

bot.onText(/\/myanimes/, async (msg) => {
  const uid = msg.from.id;

  // Faqat hamkorlar ko‘ra oladi
  if (!await is_partner(uid)) {
    return bot.sendMessage(msg.chat.id, "❌ Bu buyruq faqat hamkorlar uchun. /become_partner tugmasi orqali hamkor bo‘ling.");
  }

  const partner = await partners.findOne({ user_id: uid });
  if (!partner || !partner.added_animes?.length) {
    return bot.sendMessage(msg.chat.id, "Siz hali hech qanday anime qo‘shmadingiz.");
  }

  let text = `<b>🎬 Siz qo‘shgan animelar ro‘yxati (${partner.added_animes.length} ta):</b>\n\n`;

  // Har bir anime bo‘yicha ma’lumot olish
  for (let animeId of partner.added_animes) {
    const anime = await serials.findOne({ _id: animeId });
    if (!anime) {
      text += `⚠️ Anime topilmadi (ID: ${animeId})\n\n`;
      continue;
    }

    // Yuklangan qismlar sonini hisoblash
    const loadedCount = await episodes.countDocuments({ serial_id: anime._id });

    // Yuklanmagan qismlarni topish (masalan, 1 dan total gacha)
    const missingParts = [];
    for (let p = 1; p <= anime.total; p++) {
      const exists = await episodes.findOne({ serial_id: anime._id, part: p });
      if (!exists) missingParts.push(p);
    }

    text += `🎥 <b>${anime.title}</b>\n`;
    text += `Kod: ${anime.custom_id || anime._id}\n`;
    text += `Umumiy qismlar: ${anime.total}\n`;
    text += `Yuklangan: ${loadedCount} ta\n`;

    if (missingParts.length === 0) {
      text += `✅ Barcha qismlar yuklangan\n`;
    } else if (missingParts.length > 10) {
      text += `❌ Yuklanmagan qismlar: ${missingParts.length} ta (masalan: ${missingParts.slice(0, 5).join(', ')} ... va boshqalar)\n`;
    } else {
      text += `❌ Yuklanmagan qismlar: ${missingParts.join(', ')}\n`;
    }

    text += `Ko‘rishlar: ${anime.views || 0}\n\n`;
  }

  // Agar matn juda uzun bo‘lsa, Telegram chegarasini hisobga olamiz (4096 belgi)
  if (text.length > 4000) {
    text = text.substring(0, 3900) + "\n... (davomi uchun admin bilan bog‘laning yoki qismlarga bo‘lib ko‘ring)";
  }

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