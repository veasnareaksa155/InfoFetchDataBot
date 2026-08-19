import { Telegraf, Markup } from 'telegraf';
import { config, getFormattedDateTime } from './config.js';
import { appendRowToTab, updateOrAppendSalesRow, calculateAndSyncDailyGrandTotal, getFinancialAnalyticsRange, generateBossReportText, getSheetStats, SALES_TAB, SUMMARY_TAB, GENERAL_TAB } from './googleSheets.js';
import { parseMessageData } from './parser.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve('./bot_state.json');

function loadBotState() {
  const groups = new Set();
  const admins = new Set();
  const owners = new Set();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (Array.isArray(data.groups)) data.groups.forEach(g => groups.add(g));
      if (Array.isArray(data.admins)) data.admins.forEach(a => admins.add(a));
      if (Array.isArray(data.owners)) data.owners.forEach(o => owners.add(o));
    }
  } catch (e) {}
  return { groups, admins, owners };
}

function saveBotState(groupsSet, adminsSet, ownersSet) {
  try {
    const data = {
      groups: Array.from(groupsSet),
      admins: Array.from(adminsSet),
      owners: Array.from(ownersSet || [])
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function createBot() {
  const bot = new Telegraf(config.botToken);

  // Persistent Sets for known group chat IDs, verified Admin User IDs, and Permanent Owner User IDs
  const initialState = loadBotState();
  const knownGroupChatIds = initialState.groups;
  const verifiedAdminIds = initialState.admins;
  const permanentOwnerIds = initialState.owners;

  // Map to track bot confirmation receipts per user report message
  const reportBotMessageMap = new Map();

  // Automatically delete "Bot joined/left group" service messages to keep bot hidden
  bot.on(['new_chat_members', 'left_chat_member'], async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) {}
  });

  // Global Error Boundary - Prevents process crash from unhandled exceptions
  bot.catch((err, ctx) => {
    console.error(`[GLOBAL BOT ERROR] Error on ${ctx?.updateType || 'update'}:`, err.message || err);
  });

  // Helper for commands
  async function autoDeleteCommand(ctx) {
    return;
  }

  async function syncGroupAdminsForChat(telegram, chatId) {
    try {
      const admins = await telegram.getChatAdministrators(chatId);
      const currentActiveAdminIds = new Set();
      admins.forEach(admin => {
        if (admin.user && admin.user.id) {
          currentActiveAdminIds.add(admin.user.id);
          if (admin.status === 'creator') {
            permanentOwnerIds.add(admin.user.id);
          }
          verifiedAdminIds.add(admin.user.id);
        }
      });
      // Synchronize verifiedAdminIds: Keep owners & current active admins, remove demoted admins
      for (const id of verifiedAdminIds) {
        if (!permanentOwnerIds.has(id) && !currentActiveAdminIds.has(id)) {
          verifiedAdminIds.delete(id);
        }
      }
      saveBotState(knownGroupChatIds, verifiedAdminIds, permanentOwnerIds);
    } catch (e) {}
  }

  // Helper to check if user is Group Admin or Owner (Real-time demotion detection + Owner Immunity)
  async function isGroupAdmin(ctx) {
    if (!ctx.from || !ctx.from.id) return false;
    const userId = ctx.from.id;

    // Track group chat ID whenever a request comes from a group
    if (ctx.chat && ctx.chat.type !== 'private') {
      knownGroupChatIds.add(ctx.chat.id);
      syncGroupAdminsForChat(ctx.telegram, ctx.chat.id);
    }

    // A. Anonymous Admin / Channel Owner post check
    if (
      userId === 1087788882 || userId === 777000 ||
      ctx.from.username === 'GroupAnonymousBot' || ctx.from.is_anonymous ||
      (ctx.senderChat && (ctx.senderChat.id === ctx.chat?.id || ctx.senderChat.type === 'channel'))
    ) {
      return true;
    }

    // B. Permanent Group Owners Immunity Check (Owners can NEVER be blocked)
    if (permanentOwnerIds.has(userId)) {
      return true;
    }

    // C. Config ADMIN_IDS from .env Check (Dynamic Live Reloading + Multi-attribute matching)
    try { dotenv.config(); } catch (e) {}
    const liveAdminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (liveAdminIds.length > 0) {
      const uIdStr = String(userId).trim().toLowerCase();
      const uNameStr = ctx.from.username ? ctx.from.username.toLowerCase().trim() : '';
      const fullNameStr = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ').toLowerCase().trim();

      const isConfigAdmin = liveAdminIds.some(rawId => {
        const clean = String(rawId).trim().toLowerCase().replace(/^@/, '');
        if (!clean) return false;
        return clean === uIdStr || (uNameStr && clean === uNameStr) || (fullNameStr && (fullNameStr.includes(clean) || clean.includes(fullNameStr)));
      });

      if (isConfigAdmin) {
        return true;
      }
    }

    // D. Cached verified admins check
    if (verifiedAdminIds.has(userId)) {
      return true;
    }

    // E. If in a Group Chat, perform live status check in this group
    if (ctx.chat && ctx.chat.type !== 'private') {
      try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
        if (member && member.status === 'creator') {
          permanentOwnerIds.add(userId);
          verifiedAdminIds.add(userId);
          saveBotState(knownGroupChatIds, verifiedAdminIds, permanentOwnerIds);
          return true;
        }
        if (member && member.status === 'administrator') {
          verifiedAdminIds.add(userId);
          saveBotState(knownGroupChatIds, verifiedAdminIds, permanentOwnerIds);
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    }

    // F. If in Private Chat (PM): Check live status across all known group chats
    if (knownGroupChatIds.size > 0) {
      for (const groupId of knownGroupChatIds) {
        try {
          const member = await ctx.telegram.getChatMember(groupId, userId);
          if (member && member.status === 'creator') {
            permanentOwnerIds.add(userId);
            verifiedAdminIds.add(userId);
            saveBotState(knownGroupChatIds, verifiedAdminIds, permanentOwnerIds);
            return true;
          }
          if (member && member.status === 'administrator') {
            verifiedAdminIds.add(userId);
            saveBotState(knownGroupChatIds, verifiedAdminIds, permanentOwnerIds);
            return true;
          }
        } catch (e) {}
      }
    }

    return false;
  }

  // 1. Regular Users in Group Chats (all_group_chats Scope: ONLY /form)
  bot.telegram.setMyCommands([
    { command: 'form', description: '📝 យក Form របាយការណ៍' }
  ], { scope: { type: 'all_group_chats' } }).catch(err => console.warn('Group chats commands set notice:', err.message));

  // 2. Group Administrators (all_chat_administrators Scope: ALL commands)
  bot.telegram.setMyCommands([
    { command: 'boss', description: '📤 របាយការណ៍ផ្ញើជូនមេ' },
    { command: 'admin', description: '🔐 របាយការណ៍ហិរញ្ញវត្ថុ Admin' },
    { command: 'today', description: '📅 របាយការណ៍លក់ថ្ងៃនេះ' },
    { command: 'month', description: '🗓️ របាយការណ៍លក់ខែនេះ' },
    { command: 'form', description: '📝 យក Form របាយការណ៍' },
    { command: 'daily', description: '📊 ផលសរុបលក់ប្រចាំថ្ងៃ' },
    { command: 'stats', description: '📈 ស្ថិតិ Google Sheet' },
    { command: 'menu', description: '📋 បើកមេនយូបញ្ជា' },
    { command: 'ping', description: '⚡ ពិនិត្យប្រព័ន្ធ' }
  ], { scope: { type: 'all_chat_administrators' } }).catch(err => console.warn('Admin commands set notice:', err.message));

  // 3. Private Chats (all_private_chats Scope: ALL commands)
  bot.telegram.setMyCommands([
    { command: 'boss', description: '📤 របាយការណ៍ផ្ញើជូនមេ' },
    { command: 'admin', description: '🔐 របាយការណ៍ហិរញ្ញវត្ថុ Admin' },
    { command: 'today', description: '📅 របាយការណ៍លក់ថ្ងៃនេះ' },
    { command: 'month', description: '🗓️ របាយការណ៍លក់ខែនេះ' },
    { command: 'form', description: '📝 យក Form របាយការណ៍' },
    { command: 'daily', description: '📊 ផលសរុបលក់ប្រចាំថ្ងៃ' },
    { command: 'stats', description: '📈 ស្ថិតិ Google Sheet' },
    { command: 'menu', description: '📋 បើកមេនយូបញ្ជា' },
    { command: 'ping', description: '⚡ ពិនិត្យប្រព័ន្ធ' }
  ], { scope: { type: 'all_private_chats' } }).catch(err => console.warn('Private chat commands set notice:', err.message));

  // 4. Default Fallback Scope (default Scope: ONLY /form)
  bot.telegram.setMyCommands([
    { command: 'form', description: '📝 យក Form របាយការណ៍' }
  ], { scope: { type: 'default' } }).catch(err => console.warn('Default commands set notice:', err.message));

  // Main Persistent Keyboard Menu (Bottom Chat Bar for Admin)
  const mainKeyboard = Markup.keyboard([
    ['📤 របាយការណ៍ផ្ញើជូនមេ', '🔐 របាយការណ៍ Admin'],
    ['📝 Copy Form របាយការណ៍', '📊 ផលសរុបប្រចាំថ្ងៃ'],
    ['📈 ស្ថិតិលក់', '⚡ ពិនិត្យប្រព័ន្ធ']
  ]).resize();

  // Admin Analytics Period Selector Inline Keyboard
  const adminPeriodKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📅 ថ្ងៃនេះ (Today)', 'admin_analytics_today'),
      Markup.button.callback('🗓️ ម្សិលមិញ (Yesterday)', 'admin_analytics_yesterday')
    ],
    [
      Markup.button.callback('📆 ៧ ថ្ងៃចុងក្រោយ', 'admin_analytics_7days'),
      Markup.button.callback('🗓️ ខែនេះ (Month)', 'admin_analytics_month')
    ],
    [
      Markup.button.callback('📅 ខែមុន (Last Month)', 'admin_analytics_last_month'),
      Markup.button.callback('📊 សរុបទាំងអស់ (All-Time)', 'admin_analytics_all')
    ]
  ]);

  // Main Interactive Control Dashboard Inline Menu
  const inlineMenu = Markup.inlineKeyboard([
    [
      Markup.button.callback('📤 របាយការណ៍ផ្ញើជូនមេ', 'action_boss_report'),
      Markup.button.callback('🔐 របាយការណ៍ Admin', 'action_admin_analytics')
    ],
    [
      Markup.button.callback('📝 Copy Form របាយការណ៍', 'action_copy_form'),
      Markup.button.callback('📊 ផលសរុបប្រចាំថ្ងៃ', 'action_daily_summary')
    ],
    [
      Markup.button.callback('📅 របាយការណ៍ថ្ងៃនេះ', 'admin_analytics_today'),
      Markup.button.callback('🗓️ របាយការណ៍ខែនេះ', 'admin_analytics_month')
    ],
    [
      Markup.button.callback('📈 ស្ថិតិ Google Sheet', 'action_stats'),
      Markup.button.callback('⚡ ពិនិត្យប្រព័ន្ធ', 'action_ping')
    ]
  ]);

  // Register Global Telegram Bot Menu Commands (Visible in [/] Menu across ALL groups)
  try {
    bot.telegram.setMyCommands([
      { command: 'form', description: '📝 យក Form គំរូសម្រាប់ផ្ញើរបាយការណ៍' },
      { command: 'daily', description: '📊 មើលផលសរុបការលក់ប្រចាំថ្ងៃ' },
      { command: 'boss', description: '📤 បង្កើតរបាយការណ៍ជូនមេ (1-Tap Copy Boss Report)' },
      { command: 'admin', description: '🔐 របាយការណ៍ហិរញ្ញវត្ថុ Admin' },
      { command: 'stats', description: '📈 ស្ថិតិ Google Sheet' },
      { command: 'ping', description: '⚡ ពិនិត្យប្រព័ន្ធ' }
    ]).catch(() => {});
  } catch (e) {}

  // Command: /start, /menu, /help (Welcomes all users & shows control dashboard)
  bot.command(['start', 'menu', 'help'], async (ctx) => {
    await autoDeleteCommand(ctx);
    try {
      let msg = `💎 <b>SMART SALES LOGGER & CONTROL PANEL</b>\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `👋 <b>ស្វាគមន៍មកកាន់ប្រព័ន្ធគ្រប់គ្រង និងបូកសរុបទិន្នន័យលក់!</b>\n\n`;
      msg += `ប្រព័ន្ធស្វ័យប្រវត្តិនេះកត់ត្រា បំបែកទិន្នន័យ និងបូកសរុបប្រាក់លក់ពីគ្រប់ក្រុមទាំងអស់ចូលទៅកាន់ <b>Google Sheets</b> ដោយផ្ទាល់។\n\n`;
      msg += `📌 <b>មុខងារបញ្ជារហ័ស (Quick Commands):</b>\n`;
      msg += `• 📝 <b>/form</b> ➔ ទាញយក Form គំរូសម្រាប់ផ្ញើរបាយការណ៍\n`;
      msg += `• 📊 <b>/daily</b> ➔ មើលផលសរុបការលក់គ្រប់ក្រុមប្រចាំថ្ងៃ\n`;
      msg += `• 📤 <b>/boss</b> ➔ បង្កើតរបាយការណ៍ 1-Tap Copy ផ្ញើជូនមេ (Admin 🔒)\n`;
      msg += `• 🔐 <b>/admin</b> ➔ មជ្ឈមណ្ឌលវិភាគហិរញ្ញវត្ថុសម្រាប់ Admin (Admin 🔒)\n\n`;
      msg += `👇 <b>សូមជ្រើសរើសមុខងារពី Menu ខាងក្រោម៖</b>`;

      await ctx.reply(msg, { parse_mode: 'HTML', ...inlineMenu, ...mainKeyboard });
    } catch (e) {
      console.error('Error on start command:', e.message);
    }
  });

  // Admin Analytics Handler Function
  async function showAdminAnalyticsMenu(ctx) {
    try {
      const isAdmin = await isGroupAdmin(ctx);
      if (!isAdmin) {
        if (ctx.callbackQuery) {
          return ctx.answerCbQuery('⚠️ មុខងាររបាយការណ៍ Admin សម្រាប់តែ Admin ឬប្រធានក្រុមប៉ុណ្ណោះ! 🔒', { show_alert: true });
        }
        try { await ctx.setMessageReaction([{ type: 'emoji', emoji: '❌' }]); } catch (e) {}
        await autoDeleteCommand(ctx);
        return;
      }

      let msg = `🔐 <b>មជ្ឈមណ្ឌលរបាយការណ៍ហិរញ្ញវត្ថុ Admin (Financial Analytics)</b>\n\n`;
      msg += `សូមជ្រើសរើសចន្លោះពេលដែលលោកអ្នកចង់ពិនិត្យមើលប្រាក់លក់សរុបពីគ្រប់ក្រុមទាំងអស់ (១ ថ្ងៃ, ១ ខែ, សរុប...)៖`;

      await ctx.reply(msg, { parse_mode: 'HTML', ...adminPeriodKeyboard });
    } catch (e) {
      console.error('Error on showAdminAnalyticsMenu:', e.message);
    }
  }

  // Helper to send period analytics card with HTML formatting & inline editing
  async function sendPeriodAnalyticsCard(ctx, periodKey) {
    try {
      const isAdmin = await isGroupAdmin(ctx);
      if (!isAdmin) {
        if (ctx.callbackQuery) {
          return ctx.answerCbQuery('⚠️ មុខងារនេះសម្រាប់តែ Admin ឬប្រធានក្រុមប៉ុណ្ណោះ! 🔒', { show_alert: true });
        }
        try { await ctx.setMessageReaction([{ type: 'emoji', emoji: '❌' }]); } catch (e) {}
        await autoDeleteCommand(ctx);
        return;
      }

      const data = await getFinancialAnalyticsRange(periodKey);
      let replyCard = `📊 <b>របាយការណ៍ហិរញ្ញវត្ថុ & សមាជិកលក់សម្រាប់ Admin</b>\n`;
      replyCard += `🗓️ <b>ថិរវេលា:</b> <code>${escapeHtml(data.periodLabel)}</code>\n\n`;

      if (data.reportCount === 0) {
        replyCard += `⚠️ <b>ពុំទាន់មានក្រុមណាឡើងរបាយការណ៍សម្រាប់ចន្លោះពេលនេះនៅឡើយទេ។</b>\n`;
        replyCard += `👉 <i>លោកអ្នកអាចចុចមើល <b>[🗓️ ម្សិលមិញ]</b>, <b>[🗓️ ខែនេះ (1 Month)]</b> ឬ <b>[📊 សរុបទាំងអស់]</b> ខាងក្រោម!</i>\n\n`;
      } else {
        replyCard += `🏢 <b>ចំនួនក្រុមរាយការណ៍សរុប:</b> <code>${data.uniqueTeamsCount} ក្រុម</code>\n`;
        replyCard += `👥 <b>សរុបចំនួនមនុស្ស/សមាជិក:</b> <code>${data.totalPeopleCount || data.activeSellersCount} នាក់</code>\n`;
        replyCard += `📝 <b>ចំនួនរបាយការណ៍សរុប:</b> <code>${data.reportCount} របាយការណ៍</code>\n\n`;
        replyCard += `💰 <b>ប្រាក់លក់បានសរុប (Total Revenue):</b> <code>${escapeHtml(data.totalMoneyFormatted)}</code>\n`;
        replyCard += `💵 <b>សរុបលុយក្រៅ (Total Cash):</b> <code>${escapeHtml(data.cashMoneyFormatted)}</code>\n`;
        replyCard += `💳 <b>សរុបលុយក្នុងកុង (Total Bank):</b> <code>${escapeHtml(data.bankMoneyFormatted)}</code>\n\n`;

        if (data.groupBreakdownList && data.groupBreakdownList.length > 0) {
          replyCard += `🏢 <b>ទិន្នន័យលក់តាមក្រុមនីមួយៗ (${data.groupBreakdownList.length} ក្រុម):</b>\n`;
          data.groupBreakdownList.forEach((g, idx) => {
            const sellerInfo = g.sellerCount > 0 ? ` (${g.sellerCount} នាក់)` : '';
            replyCard += `${idx + 1}. <b>${escapeHtml(g.teamName)}</b>${sellerInfo}: <code>${escapeHtml(g.totalMoneyStr)}</code>\n`;
          });
          replyCard += `\n`;
        }

        if (data.sellersList && data.sellersList.length > 0) {
          replyCard += `👥 <b>បញ្ជីឈ្មោះសមាជិកចុះលក់ (${data.sellersList.length} នាក់):</b>\n`;
          data.sellersList.slice(0, 15).forEach((item, index) => {
            replyCard += `${index + 1}. ${escapeHtml(item.name)} (${item.count} លើក)\n`;
          });
          if (data.sellersList.length > 15) {
            replyCard += `... និង ${data.sellersList.length - 15} នាក់ផ្សេងទៀត\n`;
          }
          replyCard += `\n`;
        }
      }

      replyCard += `✨ <i>ទិន្នន័យត្រូវបានផ្ទៀងផ្ទាត់ និងទាញចេញពី Google Sheet រួចរាល់!</i>`;

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(replyCard, { parse_mode: 'HTML', ...adminPeriodKeyboard });
          return;
        } catch (e) {
          // If editMessageText fails, proceed to reply
        }
      }

      await ctx.reply(replyCard, { parse_mode: 'HTML', ...adminPeriodKeyboard });
    } catch (err) {
      console.error('Error fetching admin analytics:', err);
      await ctx.reply(`⚠️ ពុំអាចទាញយកទិន្នន័យ Analytics បានទេ: ${err.message}`);
    }
  }

  bot.command('today', async (ctx) => {
    await autoDeleteCommand(ctx);
    await sendPeriodAnalyticsCard(ctx, 'today');
  });
  bot.command('month', async (ctx) => {
    await autoDeleteCommand(ctx);
    await sendPeriodAnalyticsCard(ctx, 'month');
  });

  bot.command(['admin', 'analytics'], async (ctx) => {
    await autoDeleteCommand(ctx);
    await showAdminAnalyticsMenu(ctx);
  });
  bot.hears(['🔐 របាយការណ៍ Admin', '🔐 របាយការណ៍ហិរញ្ញវត្ថុ Admin'], async (ctx) => {
    await showAdminAnalyticsMenu(ctx);
  });
  bot.action('action_admin_analytics', async (ctx) => {
    const isAdmin = await isGroupAdmin(ctx);
    if (!isAdmin) {
      return ctx.answerCbQuery('⚠️ មុខងាររបាយការណ៍ Admin សម្រាប់តែ Admin ឬប្រធានក្រុមប៉ុណ្ណោះ! 🔒', { show_alert: true });
    }
    try { await ctx.answerCbQuery(); } catch (e) {}
    await showAdminAnalyticsMenu(ctx);
  });

  const periodsMap = {
    admin_analytics_today: 'today',
    admin_analytics_yesterday: 'yesterday',
    admin_analytics_7days: '7days',
    admin_analytics_month: 'month',
    admin_analytics_last_month: 'last_month',
    admin_analytics_all: 'all'
  };

  for (const [actionName, periodKey] of Object.entries(periodsMap)) {
    bot.action(actionName, async (ctx) => {
      const isAdmin = await isGroupAdmin(ctx);
      if (!isAdmin) {
        return ctx.answerCbQuery('⚠️ មុខងារនេះសម្រាប់តែ Admin ឬប្រធានក្រុមប៉ុណ្ណោះ! 🔒', { show_alert: true });
      }
      try { await ctx.answerCbQuery('📊 កំពុងទាញយកទិន្នន័យ...'); } catch (e) {}
      await sendPeriodAnalyticsCard(ctx, periodKey);
    });
  }

  async function sendBossReport(ctx, dateStr = null) {
    try {
      const isAdmin = await isGroupAdmin(ctx);
      if (!isAdmin) {
        if (ctx.callbackQuery) {
          return ctx.answerCbQuery('⚠️ មុខងាររបាយការណ៍ជូនមេ (/boss) សម្រាប់តែ Admin ឬប្រធានក្រុមប៉ុណ្ណោះ! 🔒', { show_alert: true });
        }
        try { await ctx.setMessageReaction([{ type: 'emoji', emoji: '❌' }]); } catch (e) {}
        await autoDeleteCommand(ctx);
        return;
      }

      let targetDate = dateStr;
      if (!targetDate && ctx.message && ctx.message.text) {
        const parts = ctx.message.text.trim().split(/\s+/);
        if (parts.length > 1 && parts[1].match(/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/)) {
          targetDate = parts[1];
        }
      }
      const bossReportText = await generateBossReportText(targetDate);

      let replyMsg = `📤 <b>សាររបាយការណ៍បូកសរុបស្វ័យប្រវត្តិសម្រាប់ផ្ញើជូនមេ (1-Tap Copy Boss Report)</b>:\n\n`;
      replyMsg += `<pre>${escapeHtml(bossReportText)}</pre>\n\n`;
      replyMsg += `👉 <b>ការណែនាំ:</b> ចុចលើ <b>ប្រអប់អក្សរខាងលើ</b> តែ ១ ដង Telegram នឹង <b>Copy របាយការណ៍នេះ</b> ដោយស្វ័យប្រវត្តិ សម្រាប់ Admin យកទៅ Forward ឬ ផ្ញើជូនមេ! ✨`;

      await ctx.reply(replyMsg, { parse_mode: 'HTML' });
    } catch (e) {
      console.error('Error sending boss report:', e.message);
    }
  }

  bot.command(['boss', 'report'], async (ctx) => {
    await autoDeleteCommand(ctx);
    await sendBossReport(ctx);
  });
  bot.hears(['📤 របាយការណ៍ផ្ញើជូនមេ', '📤 របាយការណ៍បូកសរុបផ្ញើជូនមេ'], async (ctx) => sendBossReport(ctx));
  bot.action('action_boss_report', async (ctx) => {
    const isAdmin = await isGroupAdmin(ctx);
    if (!isAdmin) {
      return ctx.answerCbQuery('⚠️ មុខងាររបាយការណ៍ជូនមេ (/boss) សម្រាប់តែ Admin ឬប្រធានក្រុមប៉ុណ្ណោះ! 🔒', { show_alert: true });
    }
    try { await ctx.answerCbQuery(); } catch (e) {}
    await sendBossReport(ctx);
  });

  async function sendCopyForm(ctx) {
    try {
      const todayDate = getFormattedDateTime().split(' ')[0].split('-').reverse().join('/');

      let formText = `គោរពបងៗនេះទិន្នន័យលក់ថ្ងៃនេះ ${todayDate}🙏 @everyone\n`;
      formText += `+ ក្រុមទី2\n`;
      formText += `+ អ្នកគ្រប់គ្រង ពូរួ\n`;
      formText += `+ ទីតាំង ចល័ត\n`;
      formText += `+សមាជិកលក់រួមមាន\n`;
      formText += `1. នៀម ស្រីនិត\n`;
      formText += `2. ហូរ កែវ\n`;
      formText += `3. វាសនា រក្សា\n\n`;
      formText += `+ ផលិតផលលក់បានសរុប\n`;
      formText += `- សាប៊ូDR កក់សក់ 12 ដបធំ = 96000៛\n`;
      formText += `- សាប៊ូ DR បន្ទន់សក់ 4 ដបធំ = 32000៛\n\n`;
      formText += `+ លុយសរុប = 128000៛\n`;
      formText += `+ លុយក្រៅ = 96000៛\n`;
      formText += `+ លុយក្នុងកុង = 32000៛`;

      let replyMsg = `📋 <b>ទម្រង់សាររបាយការណ៍លក់ត្រឹមត្រូវ (1-Tap Copy)</b>:\n\n`;
      replyMsg += `<pre>${escapeHtml(formText)}</pre>\n\n`;
      replyMsg += `👉 <b>ការណែនាំ:</b> ចុចលើ <b>ប្រអប់អក្សរខាងលើ</b> តែ ១ ដង Telegram នឹង <b>Copy</b> ដោយស្វ័យប្រវត្តិ! រួចលោកអ្នកគ្រាន់តែ <b>Paste</b> និងផ្លាស់ប្ដូរឈ្មោះ/តួលេខជាការស្រេច! ✨\n\n`;
      replyMsg += `⏳ <i>សារ Form នេះនឹងត្រូវលុបដោយស្វ័យប្រវត្តិក្នុងរយៈពេល ៥ នាទី!</i>`;

      const sentMsg = await ctx.reply(replyMsg, { parse_mode: 'HTML' });

      // Automatically delete the Form template message after 5 minutes in group chats
      if (sentMsg && sentMsg.message_id && ctx.chat && ctx.chat.type !== 'private') {
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id);
            console.log(`[🧹 AUTO-DELETED FORM TEMPLATE AFTER 5 MINS] ChatID: ${ctx.chat.id} | MsgID: ${sentMsg.message_id}`);
          } catch (delErr) {
            // Ignore if message was already deleted or bot lacks permission
          }
        }, 5 * 60 * 1000);
      }
    } catch (e) {
      console.error('Error sending copy form:', e.message);
    }
  }

  // Register commands & hears for Form with command auto-delete
  bot.command(['form', 'template', 'copy'], async (ctx) => {
    await autoDeleteCommand(ctx);
    await sendCopyForm(ctx);
  });
  bot.hears(['📋 Copy Form របាយការណ៍'], async (ctx) => sendCopyForm(ctx));
  bot.action('action_copy_form', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    await sendCopyForm(ctx);
  });

  async function sendDailySummary(ctx) {
    try {
      const isAdmin = await isGroupAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply(`⚠️ <b>ការការពារសិទ្ធិ (Permission Denied):</b>\n\nមុខងារ <b>ផលសរុបប្រចាំថ្ងៃ (/daily)</b> ត្រូវបានអនុញ្ញាតសម្រាប់តែ <b>Admin ឬប្រធានក្រុម</b> ប៉ុណ្ណោះ! 🔒`, { parse_mode: 'HTML' });
      }

      const todayStr = getFormattedDateTime().split(' ')[0];
      const summary = await calculateAndSyncDailyGrandTotal(todayStr);
      let replyMsg = `📊 <b>របាយការណ៍ផលសរុបការលក់គ្រប់ក្រុមប្រចាំថ្ងៃ</b>\n\n`;
      replyMsg += `📅 <b>កាលបរិច្ឆេទ:</b> <code>${escapeHtml(todayStr)}</code>\n`;
      replyMsg += `🏢 <b>ចំនួនក្រុមបានរាយការណ៍:</b> <code>${summary.teamCount} ក្រុម</code>\n\n`;
      replyMsg += `💰 <b>ប្រាក់សរុបគ្រប់ក្រុម:</b> <code>${escapeHtml(summary.grandTotal)}</code>\n`;
      replyMsg += `💵 <b>សរុបលុយក្រៅ (Cash):</b> <code>${escapeHtml(summary.grandCash)}</code>\n`;
      replyMsg += `💳 <b>សរុបលុយក្នុងកុង (Bank):</b> <code>${escapeHtml(summary.grandBank)}</code>\n\n`;
      replyMsg += `📂 <b>Google Sheet Tab:</b> <code>${escapeHtml(SUMMARY_TAB)}</code>\n`;
      replyMsg += `🟢 <b>ស្ថានភាពប្រព័ន្ធ:</b> បូកសរុបទិន្នន័យរួចរាល់ 100%`;

      await ctx.reply(replyMsg, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`⚠️ ពុំអាចគណនាផលសរុបបានទេ: ${err.message}`);
    }
  }

  bot.command(['daily', 'summary'], async (ctx) => {
    await autoDeleteCommand(ctx);
    await sendDailySummary(ctx);
  });
  bot.hears(['📊 ផលសរុបប្រចាំថ្ងៃ'], async (ctx) => sendDailySummary(ctx));
  bot.action('action_daily_summary', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    await sendDailySummary(ctx);
  });

  async function sendStats(ctx) {
    try {
      const isAdmin = await isGroupAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply(`⚠️ <b>ការការពារសិទ្ធិ (Permission Denied):</b>\n\nមុខងារ <b>ស្ថិតិលក់ (/stats)</b> ត្រូវបានអនុញ្ញាតសម្រាប់តែ <b>Admin ឬប្រធានក្រុម</b> ប៉ុណ្ណោះ! 🔒`, { parse_mode: 'HTML' });
      }

      const stats = await getSheetStats();
      let replyMsg = `📈 <b>ស្ថិតិការកត់ត្រាទិន្នន័យលក់ក្នុង Google Sheet</b>\n\n`;
      replyMsg += `• 📊 <b>ចំនួនរបាយការណ៍សរុប:</b> ${stats.totalRows} របាយការណ៍\n`;
      replyMsg += `• 📂 <b>Worksheet Tabs:</b> <code>${escapeHtml(SALES_TAB)}</code> និង <code>${escapeHtml(SUMMARY_TAB)}</code>\n`;
      replyMsg += `• 🟢 <b>ស្ថានភាពប្រព័ន្ធ:</b> សកម្ម និងដំណើរការល្អ (Smooth & Online)`;

      await ctx.reply(replyMsg, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`⚠️ ពុំអាចទាញយកស្ថិតិបានទេ: ${err.message}`);
    }
  }

  bot.command(['stats'], async (ctx) => {
    await autoDeleteCommand(ctx);
    await sendStats(ctx);
  });
  bot.hears(['📈 ស្ថិតិលក់'], async (ctx) => sendStats(ctx));
  bot.action('action_stats', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    await sendStats(ctx);
  });

  async function sendPing(ctx) {
    try {
      const isAdmin = await isGroupAdmin(ctx);
      if (!isAdmin) {
        return ctx.reply(`⚠️ <b>ការការពារសិទ្ធិ (Permission Denied):</b>\n\nមុខងារ <b>ពិនិត្យប្រព័ន្ធ (/ping)</b> ត្រូវបានអនុញ្ញាតសម្រាប់តែ <b>Admin ឬប្រធានក្រុម</b> ប៉ុណ្ណោះ! 🔒`, { parse_mode: 'HTML' });
      }
      await ctx.reply('⚡ <b>ប្រព័ន្ធកំពុងដំណើរការយ៉ាងរលូន (Online 100%)!</b>', { parse_mode: 'HTML' });
    } catch (e) {}
  }

  bot.command(['ping'], async (ctx) => {
    await autoDeleteCommand(ctx);
    await sendPing(ctx);
  });
  bot.hears(['⚡ ពិនិត្យប្រព័ន្ធ'], async (ctx) => sendPing(ctx));
  bot.action('action_ping', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    await sendPing(ctx);
  });

  // Handle all group messages & edited messages with safe error boundary
  bot.on(['message', 'edited_message'], async (ctx) => {
    try {
      const msg = ctx.message || ctx.editedMessage;
      if (!msg) return;

      const isEdited = Boolean(ctx.editedMessage);

      if (msg.text && msg.text.startsWith('/')) {
        return;
      }

      const timestamp = getFormattedDateTime(new Date(msg.date * 1000));
      const chatTitle = ctx.chat.title || ctx.chat.type || 'Private Chat';
      
      const user = msg.from || {};
      const username = user.username ? `@${user.username}` : 'N/A';
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'N/A';

      let content = msg.text || msg.caption || '';

      if (!content) {
        if (msg.photo) content = '[រូបថត]';
        else if (msg.document) content = `[ឯកសារ] ${msg.document.file_name || ''}`;
        else content = '[សារផ្សេងៗ]';
      }

      // Parse data with Telegram Group Title auto-extraction
      const parsed = parseMessageData(content, chatTitle);

      if (parsed.khmerReport && parsed.khmerReport.isKhmerSalesReport) {
        const kr = parsed.khmerReport;

        // Input Validation: Check if financial total or details are missing
        if (kr.totalMoneyNum === 0 && kr.sellerCount === 0 && !kr.productsText) {
          return ctx.reply(`⚠️ <b>សាររបាយការណ៍របស់អ្នកហាក់ដូចជាខ្វះតួលេខលុយ ឬទម្រង់ពុំទាន់ត្រឹមត្រូវ!</b>\n\nសូមចុចប៊ូតុង <b>[📋 Copy Form របាយការណ៍]</b> ឬវាយ <code>/form</code> ដើម្បីយកទម្រង់គំរូ! ✨`, { parse_mode: 'HTML' });
        }

        const reportDate = kr.reportDate || timestamp.split(' ')[0];

        if (kr.isMultiGroup && kr.subGroups && kr.subGroups.length > 0) {
          // Log each sub-group as an individual team row in Google Sheets
          for (const sg of kr.subGroups) {
            let sgGroup = sg.groupTitle;
            let sgMgr = 'N/A';
            const matchMgr = sg.groupTitle.match(/^([^\(\=]+)\(([^\)]+)\)/);
            if (matchMgr) {
              sgGroup = matchMgr[1].trim();
              sgMgr = matchMgr[2].trim();
            }

            const rawSingleLine = content.split('\n').map(s => s.trim()).filter(Boolean).join(' | ');
            const sgRowData = [
              reportDate,
              sgGroup,
              sgMgr,
              'ចល័ត',
              fullName,
              sg.sellerCount || 0,
              sg.groupTitle,
              sg.subtotalStr,
              sg.subtotalStr,
              '0៛',
              sg.detailsText || 'N/A',
              isEdited ? `[កែប្រែ/EDITED SUMMARY] ${rawSingleLine}` : rawSingleLine
            ];
            await updateOrAppendSalesRow(SALES_TAB, sgRowData);
          }
          console.log(`[📊 MULTI-GROUP SALES REPORT SAVED] ${kr.subGroups.length} Groups | Total: ${kr.totalMoneyStr}`);
        } else {
          // Single team report row (12 Columns: Date, Remork, Manager, Location, Sender, SellerCount, SellersList, Total, Cash, Bank, Products, Raw)
          const rawSingleLine = content.split('\n').map(s => s.trim()).filter(Boolean).join(' | ');
          const salesRowData = [
            reportDate,
            kr.groupTitle || kr.groupName || 'ក្រុមចល័ត',
            kr.managerName || 'N/A',
            kr.rawLocation || 'ចល័ត',
            fullName,
            kr.sellerCount || 0,
            kr.sellersList || 'N/A',
            kr.totalMoneyStr || '0៛',
            kr.cashMoneyStr || '0៛',
            kr.bankMoneyStr || '0៛',
            kr.productsText || 'N/A',
            isEdited ? `[កែប្រែ/EDITED] ${rawSingleLine}` : rawSingleLine
          ];
          await updateOrAppendSalesRow(SALES_TAB, salesRowData);
        }

        // 2. Calculate & Re-sync Running Daily Grand Total across ALL teams!
        await calculateAndSyncDailyGrandTotal(reportDate);

        // 3. React directly to the user's report message with 👍 emoji
        try {
          if (typeof ctx.react === 'function') {
            await ctx.react(isEdited ? '✏️' : '👍');
          } else {
            await ctx.telegram.setMessageReaction(ctx.chat.id, msg.message_id, [{ type: 'emoji', emoji: isEdited ? '✏️' : '👍' }]);
          }
        } catch (reactErr) {
          try {
            await ctx.telegram.setMessageReaction(ctx.chat.id, msg.message_id, [{ type: 'emoji', emoji: '👍' }]);
          } catch (e2) {}
        }
        console.log(`[${isEdited ? '✏️ EDITED' : '👍'} REPORT PROCESSED] MsgID: ${msg.message_id}`);

        // 4. Send concise "Noted!" reply when a report message is EDITED
        if (isEdited) {
          await ctx.reply('Noted! 👌', { reply_to_message_id: msg.message_id }).catch(() => {
            ctx.reply('Noted! 👌');
          });
        }
      } else {
        // Non-report chat message in group -> Keep user message intact!
        console.log(`[💬 CHAT MESSAGE RECEIVED] [${chatTitle}] ${fullName}: ${content.slice(0, 30)}`);

        // General message log backup to Google Sheets
        const generalRowData = [
          timestamp,
          chatTitle,
          fullName,
          username,
          parsed.name || '',
          parsed.phone || '',
          parsed.amount || '',
          parsed.category || '',
          parsed.note || '',
          isEdited ? `[EDITED] ${content}` : content
        ];

        await appendRowToTab(GENERAL_TAB, generalRowData).catch(() => {});
      }
    } catch (err) {
      console.error(`[MESSAGE HANDLER ERROR] Safe catch on message processing:`, err.message);
    }
  });

  return bot;
}
