import http from 'http';
import { config, validateConfig } from './config.js';
import { initializeSheet } from './googleSheets.js';
import { createBot } from './bot.js';

// Free Tier Render Port Listener (Enables 100% FREE $0/month Web Service on Render)
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 Telegram Sales Logger Bot is RUNNING 24/7 (Free Web Service Active)!');
}).listen(port, () => {
  console.log(`🌐 Free Web Service HTTP server listening on port ${port}`);
});

async function main() {
  console.log('🚀 Starting Telegram Group Data Logger Bot...');

  // Validate configuration
  const validation = validateConfig();
  if (!validation.isValid) {
    console.error('\n❌ Configuration Error!');
    console.error('The following items are missing or unconfigured in your .env file:');
    validation.missing.forEach(item => console.error(`  - ${item}`));
    console.error('\nPlease copy .env.example to .env and fill in your credentials.');
    console.error('For full step-by-step setup instructions, please see README.md\n');
    process.exit(1);
  }

  // Initialize Google Sheet Connection
  try {
    console.log(`📊 Connecting to Google Sheet (ID: ${config.spreadsheetId})...`);
    await initializeSheet();
    console.log('✅ Google Sheet connection established & sheet header verified!');
  } catch (err) {
    console.error('\n❌ Google Sheets Connection Failed:');
    console.error(err.message);
    console.error('\nTroubleshooting tips:');
    console.error('1. Make sure your Google Sheet is shared with your Service Account email (give Editor access).');
    console.error('2. Verify the SPREADSHEET_ID in your .env file.');
    console.error('3. Check that your credentials.json file or environment variables are valid.\n');
    process.exit(1);
  }

  let activeBot = null;

  process.once('SIGINT', () => {
    if (activeBot) activeBot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    if (activeBot) activeBot.stop('SIGTERM');
  });

  // Initialize & Launch Telegram Bot with clean retry
  async function launchBotWithRetry(attempt = 1) {
    try {
      if (activeBot) {
        try { activeBot.stop(); } catch (e) {}
      }

      activeBot = createBot();
      console.log('🤖 Clearing webhook and initializing long polling...');
      try {
        await activeBot.telegram.deleteWebhook({ drop_pending_updates: false });
      } catch (e) {
        // ignore
      }

      console.log('✨ Telegram Bot is RUNNING and listening for group messages!\n');
      await activeBot.launch({
        allowedUpdates: ['message', 'edited_message', 'channel_post', 'callback_query']
      });
    } catch (err) {
      if (err.message && err.message.includes('409') && attempt <= 5) {
        console.warn(`\n⚠️ Telegram 409 Conflict detected (another bot instance running). Retrying in 4 seconds... (Attempt ${attempt}/5)`);
        await new Promise(r => setTimeout(r, 4000));
        return launchBotWithRetry(attempt + 1);
      }
      console.error('\n❌ Telegram Bot Launch Failed:');
      console.error(err.message);
      console.error('\nPlease ensure no other terminal window is running `npm start` simultaneously.\n');
      process.exit(1);
    }
  }

  await launchBotWithRetry();
}

main();
