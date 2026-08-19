import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN,
  spreadsheetId: process.env.SPREADSHEET_ID,
  sheetName: process.env.SHEET_NAME || 'Group Logs',
  credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json',
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: process.env.GOOGLE_PRIVATE_KEY 
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined,
  timezoneOffsetHours: parseFloat(process.env.TIMEZONE_OFFSET_HOURS || '+7'),
  adminIds: (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
};

/**
 * Get formatted local date-time string according to configured timezone
 * @param {Date} [date] 
 * @returns {string} ISO format string in local timezone (YYYY-MM-DD HH:mm:ss)
 */
export function getFormattedDateTime(date = new Date()) {
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const targetDate = new Date(utc + (3600000 * config.timezoneOffsetHours));
  
  const pad = (num) => String(num).padStart(2, '0');
  const year = targetDate.getFullYear();
  const month = pad(targetDate.getMonth() + 1);
  const day = pad(targetDate.getDate());
  const hours = pad(targetDate.getHours());
  const minutes = pad(targetDate.getMinutes());
  const seconds = pad(targetDate.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Validate configuration
 */
export function validateConfig() {
  const missing = [];
  
  if (!config.botToken || config.botToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    missing.push('BOT_TOKEN');
  }
  
  if (!config.spreadsheetId || config.spreadsheetId === 'YOUR_GOOGLE_SHEET_ID_HERE') {
    missing.push('SPREADSHEET_ID');
  }

  const hasCredentialsFile = fs.existsSync(path.resolve(config.credentialsPath));
  const hasInlineCreds = config.serviceAccountEmail && config.privateKey;

  if (!hasCredentialsFile && !hasInlineCreds) {
    missing.push('Google Credentials (either credentials.json file or GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY)');
  }

  return {
    isValid: missing.length === 0,
    missing,
    hasCredentialsFile,
    hasInlineCreds
  };
}
