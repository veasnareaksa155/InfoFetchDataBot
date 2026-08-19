# 🤖 Telegram Group Data Logger to Google Sheets

A Node.js Telegram Bot that automatically captures messages, media details, user information, and timestamps from your Telegram group and appends them to a Google Sheet in real-time.

---

## 📋 Features

- 📝 **Automatic Group Logging**: Logs sender name, username, user ID, timestamp, chat name, message ID, and message text/caption.
- 🖼️ **Media Support**: Identifies photos, documents, videos, voice messages, audio, stickers, and new/left group members.
- ⚡ **Real-time Google Sheets Sync**: Uses the official Google Sheets API v4 to append rows instantly.
- 📊 **Built-in Stats Command**: Use `/stats` in Telegram to see total messages logged and today's message count.
- 🔒 **Secure Credentials Handling**: Supports either `credentials.json` file or inline `.env` variables.

---

## 🛠️ Step-by-Step Setup Guide

### Step 1: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts to name your bot and choose a username (e.g. `MyGroupLoggerBot`).
3. Copy the **HTTP API Token** provided by BotFather (looks like `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).
4. **CRITICAL STEP - Disable Privacy Mode**:
   - In @BotFather, send `/setprivacy`.
   - Select your bot.
   - Click **Disable** ("Privacy mode is currently disabled").
   - *Why?* By default, Telegram bots in groups can only see commands. Disabling Privacy Mode (or making the bot a group Admin) allows the bot to log all messages in your group.

---

### Step 2: Set Up Google Cloud & Google Sheet

1. **Create a Google Sheet**:
   - Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet.
   - Name your sheet (e.g. `Telegram Group Logs`).
   - Copy the **Spreadsheet ID** from the URL:
     `https://docs.google.com/spreadsheets/d/`**`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`**`/edit`
     *(The long string between `/d/` and `/edit` is your Spreadsheet ID)*.

2. **Create a Google Cloud Service Account**:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new project (e.g., `Telegram Sheet Logger`).
   - Go to **APIs & Services > Library**, search for **Google Sheets API**, and click **Enable**.
   - Go to **APIs & Services > Credentials**.
   - Click **+ Create Credentials** -> **Service Account**.
   - Give it a name (e.g., `telegram-logger`) and click **Create and Continue**, then **Done**.
   - Click on the newly created Service Account email to edit it.
   - Go to the **KEYS** tab -> **Add Key** -> **Create new key** -> Select **JSON** -> Click **Create**.
   - A `.json` key file will download to your computer.

3. **Share Google Sheet with your Service Account**:
   - Open your downloaded JSON file or copy the `client_email` (looks like `telegram-logger@your-project.iam.gserviceaccount.com`).
   - Go to your Google Sheet, click the **Share** button in the top right.
   - Paste the Service Account email address, assign the role **Editor**, and click **Share**.

---

### Step 3: Configure Environment Variables

1. Open the project folder `d:\Video Editor\Telegram Bot`.
2. Move/copy your downloaded JSON key into this project folder and rename it to `credentials.json`
   *(OR fill `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` inside `.env`)*.
3. Open `.env` and fill in your values:

```env
# Telegram Bot Token from @BotFather
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# Google Sheets Configuration
GOOGLE_CREDENTIALS_PATH=./credentials.json
SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
SHEET_NAME=Group Logs

# Timezone (e.g. +7 for UTC+7)
TIMEZONE_OFFSET_HOURS=+7
```

---

### Step 4: Run the Bot

1. Install dependencies (if not already done):
   ```bash
   npm install
   ```

2. Start the bot:
   ```bash
   npm start
   ```

   *Or run in development watch mode:*
   ```bash
   npm run dev
   ```

3. Add your bot to your Telegram Group!
4. Send a message in your Telegram Group and watch it instantly appear in your Google Sheet!

---

## 🤖 Available Bot Commands

| Command | Description |
|---|---|
| `/start` | Shows welcome guide and group privacy reminder |
| `/help` | Displays command list and setup instructions |
| `/stats` | Shows count of total logged messages and today's logs |
| `/ping` | Quick response check to verify bot is online |

---

## 📊 Google Sheet Columns

The bot automatically creates the following table headers on first run:

| Header | Description | Example |
|---|---|---|
| `Timestamp` | Local Date & Time | `2026-08-16 14:45:00` |
| `Message ID` | Telegram Message ID | `1042` |
| `Chat ID` | Telegram Group Chat ID | `-100123456789` |
| `Chat Title` | Telegram Group Title | `My Project Team` |
| `User ID` | Sender Telegram User ID | `98765432` |
| `Username` | Sender Telegram Username | `@john_doe` |
| `Full Name` | Sender Display Name | `John Doe` |
| `Message Type` | text, photo, document, video, sticker, etc. | `text` |
| `Content` | Message text or caption | `Hello team!` |
| `Media / Extra Info` | Dimensions, file sizes, or sticker info | `File ID: ...` |

---

## ❓ Frequently Asked Questions (FAQ) & Troubleshooting

**Q: The bot is in my group but not logging text messages!**
- Ensure Privacy Mode is **Disabled** in @BotFather (`/setprivacy` -> Select Bot -> `Disable`), or make the bot an **Admin** in the group. Afterwards, remove and re-add the bot to the group.

**Q: I get `The caller does not have permission` error in console!**
- Make sure you shared the Google Sheet with the Service Account email address (`client_email` in `credentials.json`) and granted **Editor** permissions.

**Q: Can I host this 24/7 for free?**
- Yes! You can host this Node.js bot on platforms like Render, Railway, Replit, or a VPS (using `pm2` process manager).
