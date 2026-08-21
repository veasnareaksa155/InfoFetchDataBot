import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { extractNumericValue, formatKhmerCurrency, cleanSellerName, normalizeDateString } from './parser.js';

export const SALES_TAB = 'របាយការណ៍លក់';
export const SUMMARY_TAB = 'ផលសរុបប្រចាំថ្ងៃ';
export const GENERAL_TAB = config.sheetName || 'Group Logs';

export const SALES_HEADERS = [
  '📅 កាលបរិច្ឆេទ (Date)',
  '🏢 ឈ្មោះរ៉ឺម៉ក / ក្រុម (Remork / Team)',
  '👤 អ្នកគ្រប់គ្រង (Manager)',
  '📍 ទីតាំង (Location)',
  '👤 អ្នកផ្ញើ (Telegram User)',
  '👥 ចំនួនមនុស្ស (Sellers)',
  '📝 បញ្ជីសមាជិក (Team Members)',
  '💰 ប្រាក់សរុប (Total Revenue)',
  '💵 លុយក្រៅ (Cash)',
  '💳 លុយក្នុងកុង (Bank)',
  '🛍️ មុខទំនិញ / ព័ត៌មានលម្អិត (Products Sold)',
  '💬 សារដើម (Original Report)'
];

export const SUMMARY_HEADERS = [
  '📅 កាលបរិច្ឆេទ (Date)',
  '🏢 ចំនួនក្រុមបានរាយការណ៍ (Total Teams)',
  '💰 ប្រាក់សរុប (Grand Total Revenue)',
  '💵 សរុបលុយក្រៅ (Grand Total Cash)',
  '💳 សរុបលុយក្នុងកុង (Grand Total Bank)'
];

export const GENERAL_HEADERS = [
  'Timestamp',
  'Chat Title',
  'Sender (Telegram)',
  'Username',
  'Name',
  'Phone',
  'Amount',
  'Category',
  'Note / Description',
  'Raw Message'
];

let sheetsClient = null;

export async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  let auth;
  const credentialsPathResolved = path.resolve(config.credentialsPath);

  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      const parsedCreds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: parsedCreds.client_email,
          private_key: parsedCreds.private_key
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
    } catch (e) {
      console.warn('Failed to parse GOOGLE_CREDENTIALS_JSON:', e.message);
    }
  }

  if (!auth && fs.existsSync(credentialsPathResolved)) {
    auth = new google.auth.GoogleAuth({
      keyFile: credentialsPathResolved,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  } else if (!auth && config.serviceAccountEmail && config.privateKey) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.serviceAccountEmail,
        private_key: config.privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  } else if (!auth) {
    throw new Error('Google Cloud credentials not found. Please provide credentials file or GOOGLE_CREDENTIALS_JSON env var.');
  }

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Apply executive-level styling to the Google Sheet (Column widths, Wrap Text, Header Colors, Alignments)
 */
export async function formatWholeSpreadsheet() {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const requests = [];

    const columnWidthsMap = {
      [SALES_TAB]: [140, 200, 180, 180, 200, 130, 260, 150, 140, 140, 360, 300],
      [SUMMARY_TAB]: [150, 240, 200, 180, 180],
      [GENERAL_TAB]: [160, 200, 220, 160, 180, 140, 140, 180, 300, 300]
    };

    const updatedHeadersMap = {
      [SALES_TAB]: SALES_HEADERS,
      [SUMMARY_TAB]: SUMMARY_HEADERS,
      [GENERAL_TAB]: GENERAL_HEADERS
    };

    for (const sheetObj of spreadsheet.data.sheets) {
      const title = sheetObj.properties.title;
      const sheetId = sheetObj.properties.sheetId;

      // 1. Update header row text
      if (updatedHeadersMap[title]) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${title}'!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [updatedHeadersMap[title]] }
        });
      }

      // 2. Freeze Header Row
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount'
        }
      });

      // 3. Header Styling: Dark Navy Blue (#1A365D), Bold White Text
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.10, green: 0.21, blue: 0.36 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
        }
      });

      // 4. Data Rows Styling (Rows 2-1000): Text Wrap = WRAP, Vertical Alignment = MIDDLE
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 1000 },
          cell: {
            userEnteredFormat: {
              wrapStrategy: 'WRAP',
              verticalAlignment: 'MIDDLE'
            }
          },
          fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)'
        }
      });

      // 5. Column Alignments for SALES_TAB
      if (title === SALES_TAB) {
        // Date (A), Seller Count (F), Revenue (H), Cash (I), Bank (J) -> CENTER
        [0, 5, 7, 8, 9].forEach((colIdx) => {
          requests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
              cell: {
                userEnteredFormat: { horizontalAlignment: 'CENTER' }
              },
              fields: 'userEnteredFormat.horizontalAlignment'
            }
          });
        });

        // Remork (B), Manager (C), Location (D), Sender (E), Members (G), Products (K), Original (L) -> LEFT
        [1, 2, 3, 4, 6, 10, 11].forEach((colIdx) => {
          requests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
              cell: {
                userEnteredFormat: { horizontalAlignment: 'LEFT' }
              },
              fields: 'userEnteredFormat.horizontalAlignment'
            }
          });
        });
      }

      // 6. Apply Column Widths
      const colWidths = columnWidthsMap[title];
      if (colWidths) {
        colWidths.forEach((width, colIdx) => {
          requests.push({
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: colIdx,
                endIndex: colIdx + 1
              },
              properties: { pixelSize: width },
              fields: 'pixelSize'
            }
          });
        });
      }
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      });
      console.log('✨ [SUCCESS] Google Sheet styled with executive formatting & column width auto-fit!');
    }
  } catch (err) {
    console.error('Error formatting spreadsheet:', err.message);
  }
}

/**
 * Ensures tab exists & writes headers
 */
async function ensureTabWithHeaders(sheets, spreadsheetId, tabName, headers, headerColor = { red: 0.11, green: 0.22, blue: 0.37 }) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    let sheetObj = spreadsheet.data.sheets.find(s => s.properties.title === tabName);

    if (!sheetObj) {
      console.log(`Creating tab "${tabName}"...`);
      const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: tabName }
              }
            }
          ]
        }
      });
      sheetObj = addRes.data.replies[0].addSheet;
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:Z1`
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      });
      console.log(`Added headers to "${tabName}".`);
    }
  } catch (err) {
    console.error(`Error ensuring tab "${tabName}":`, err.message);
  }
}

/**
 * Initialize Google Sheets connection, tabs, and executive styling
 */
export async function initializeSheet() {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  await ensureTabWithHeaders(sheets, spreadsheetId, SALES_TAB, SALES_HEADERS);
  await ensureTabWithHeaders(sheets, spreadsheetId, SUMMARY_TAB, SUMMARY_HEADERS);
  await ensureTabWithHeaders(sheets, spreadsheetId, GENERAL_TAB, GENERAL_HEADERS);

  await formatWholeSpreadsheet();

  return true;
}

export function formatProductsList(rawProductsStr) {
  if (!rawProductsStr || typeof rawProductsStr !== 'string') return rawProductsStr;
  let items = [];
  if (rawProductsStr.includes('\n')) {
    items = rawProductsStr.split('\n');
  } else if (rawProductsStr.includes(' | ')) {
    items = rawProductsStr.split(' | ');
  } else {
    items = [rawProductsStr];
  }

  return items
    .map(item => item.replace(/^•\s*/, '').replace(/^-\s*/, '').trim())
    .filter(Boolean)
    .map(item => item.replace(/\s*[:=]\s*\d+\s*[\$៛]?.*$/i, '').trim())
    .filter(Boolean)
    .map(item => `• ${item}`)
    .join('\n');
}

async function appendRowDirect(tabName, rowData) {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  // Format products list (Col K, index 10) with bullet points and strip prices
  const formattedRowData = [...rowData];
  if (formattedRowData[10] && typeof formattedRowData[10] === 'string') {
    formattedRowData[10] = formatProductsList(formattedRowData[10]);
  }

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabName}'!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [formattedRowData] }
  });

  return res.data;
}

class TaskQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  enqueue(tabName, rowData) {
    return new Promise((resolve, reject) => {
      this.queue.push({ tabName, rowData, resolve, reject, retries: 0 });
      this.process();
    });
  }

  async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue[0];
      try {
        const result = await appendRowDirect(task.tabName, task.rowData);
        task.resolve(result);
      } catch (err) {
        if (task.retries < 3) {
          task.retries++;
          console.warn(`[RETRY ${task.retries}/3] Failed appending row to ${task.tabName}:`, err.message);
          await new Promise(r => setTimeout(r, 2000 * task.retries));
          continue;
        }
        console.error(`[FAILED] Could not write row to ${task.tabName} after 3 retries:`, err.message);
        task.reject(err);
      }
      this.queue.shift();
    }

    this.isProcessing = false;
  }
}

const taskQueue = new TaskQueue();

export async function appendRowToSheet(tabName, rowData) {
  return taskQueue.enqueue(tabName, rowData);
}

export const appendRowToTab = appendRowToSheet;

/**
 * Helper to normalize any row format (12-column standard or legacy 10-column) from SALES_TAB
 */
export function parseSalesRowData(row) {
  if (!row || !Array.isArray(row) || row.length === 0) return null;

  const date = normalizeDateString(row[0] || '');
  if (!date || date.includes('កាលបរិច្ឆេទ') || date.includes('Date')) return null;

  let teamName = (row[1] || '').trim();
  let managerName = '';
  let location = 'ចល័ត';
  let sender = '';
  let sellerCount = 0;
  let members = 'N/A';
  let totalRevenueNum = 0;
  let totalRevenueStr = '0៛';
  let cashNum = 0;
  let cashStr = '0៛';
  let bankNum = 0;
  let bankStr = '0៛';
  let products = 'N/A';
  let rawReport = '';

  if (row.length >= 12) {
    teamName = (row[1] || '').trim();
    managerName = (row[2] || '').trim();
    location = (row[3] || 'ចល័ត').trim();
    sender = (row[4] || '').trim();
    sellerCount = extractNumericValue(row[5]);
    members = (row[6] || 'N/A').trim();
    totalRevenueStr = row[7] || '0៛';
    totalRevenueNum = extractNumericValue(row[7]);
    cashStr = row[8] || '0៛';
    cashNum = extractNumericValue(row[8]);
    bankStr = row[9] || '0៛';
    bankNum = extractNumericValue(row[9]);
    products = row[10] || 'N/A';
    rawReport = row[11] || '';
  } else if (row.length >= 8) {
    teamName = (row[1] || '').trim();
    const col2 = (row[2] || '').trim();
    if (!col2.includes('DUC-') && col2 !== 'Group') {
      managerName = col2;
    }
    sellerCount = extractNumericValue(row[3]);
    members = (row[4] || 'N/A').trim();
    totalRevenueStr = row[5] || '0៛';
    totalRevenueNum = extractNumericValue(row[5]);
    cashStr = row[6] || '0៛';
    cashNum = extractNumericValue(row[6]);
    bankStr = row[7] || '0៛';
    bankNum = extractNumericValue(row[7]);
    products = row[8] || 'N/A';
    rawReport = row[9] || '';
  }

  if (teamName) {
    if (teamName.startsWith('តាំង ') || teamName.startsWith('ទីតាំង ')) {
      teamName = teamName.replace(/^(?:ទី)?តាំង\s*/i, '').trim();
    }
    if (teamName.startsWith('ទី') || teamName.match(/^\d+/)) {
      teamName = `ក្រុម${teamName}`;
    }
    const mgrMatch = teamName.match(/^([^\(\=]+)\(([^\)]+)\)/);
    if (mgrMatch) {
      let tTitle = mgrMatch[1].trim();
      if (tTitle.startsWith('ទី') || tTitle.match(/^\d+/)) {
        tTitle = `ក្រុម${tTitle}`;
      }
      teamName = `${tTitle} (${mgrMatch[2].trim()})`;
      if (!managerName || managerName === 'N/A' || managerName === 'Group') {
        managerName = mgrMatch[2].trim();
      }
    }
  }

  if (teamName.includes(' - ')) {
    const parts = teamName.split(' - ');
    teamName = parts[0].trim();
    if (parts[1] && (!location || location === 'ចល័ត')) {
      location = parts[1].trim();
    }
  }

  return {
    date,
    teamName: teamName || 'ក្រុមចល័ត',
    managerName: managerName && managerName !== 'N/A' ? managerName : '',
    location: location || 'ចល័ត',
    sender,
    sellerCount,
    members,
    totalRevenueNum,
    totalRevenueStr: totalRevenueStr.includes('៛') ? totalRevenueStr : formatKhmerCurrency(totalRevenueNum),
    cashNum,
    cashStr: cashStr.includes('៛') ? cashStr : formatKhmerCurrency(cashNum),
    bankNum,
    bankStr: bankStr.includes('៛') ? bankStr : formatKhmerCurrency(bankNum),
    products,
    rawReport
  };
}

export function extractTeamIdentifier(teamStr) {
  if (!teamStr) return '';
  let s = String(teamStr).trim().toLowerCase();
  s = s.replace(/រ៉ឺម៉ក/g, 'ក្រុម').replace(/រម៉ក/g, 'ក្រុម');
  s = s.replace(/\([^\)]+\)/g, '').trim();
  if (s.includes(' - ')) s = s.split(' - ')[0].trim();
  return s;
}

export function isSameTeam(teamA, teamB, mgrA = '', mgrB = '') {
  if (mgrA && mgrB && mgrA !== 'N/A' && mgrB !== 'N/A') {
    const cleanMgrA = String(mgrA).trim().toLowerCase();
    const cleanMgrB = String(mgrB).trim().toLowerCase();
    if (cleanMgrA !== cleanMgrB) return false;
  }

  const idA = extractTeamIdentifier(teamA);
  const idB = extractTeamIdentifier(teamB);
  if (!idA || !idB) return false;

  return idA === idB;
}

export function normalizeLocation(locStr) {
  if (!locStr) return 'ចល័ត';
  let s = String(locStr).trim().toLowerCase();
  s = s.replace(/^ទីតាំង\s*/i, '').replace(/^ទីតាំងទី\s*/i, '').trim();
  return s || 'ចល័ត';
}

export function isSameLocation(locA, locB) {
  const normA = normalizeLocation(locA);
  const normB = normalizeLocation(locB);
  if (normA === 'ចល័ត' && normB === 'ចល័ត') return true;
  return normA === normB;
}

export function isSameSender(senderA, senderB) {
  if (!senderA || !senderB) return false;
  const cleanA = String(senderA).trim().toLowerCase().replace(/^@/, '');
  const cleanB = String(senderB).trim().toLowerCase().replace(/^@/, '');
  if (!cleanA || !cleanB) return false;
  return cleanA === cleanB;
}

/**
 * Overwrite existing row for matching Date + Team + Location + Sender, or append if new.
 */
export async function updateOrAppendSalesRow(tabName, rowData) {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  const targetDate = normalizeDateString(rowData[0]);
  const targetTeam = (rowData[1] || '').trim();
  const targetManager = (rowData[2] || '').trim();
  const targetLocation = (rowData[3] || 'ចល័ត').trim();
  const targetSender = (rowData[4] || '').trim();

  // Clean multiline products formatting (Col K, index 10) and strip prices
  const formattedRowData = [...rowData];
  if (formattedRowData[10] && typeof formattedRowData[10] === 'string') {
    formattedRowData[10] = formatProductsList(formattedRowData[10]);
  }

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:L`
    });

    const rows = res.data.values || [];
    let matchingRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      const pRow = parseSalesRowData(rows[i]);
      if (
        pRow &&
        pRow.date === targetDate &&
        isSameTeam(pRow.teamName, targetTeam, pRow.managerName, targetManager) &&
        isSameLocation(pRow.location, targetLocation) &&
        isSameSender(pRow.sender, targetSender)
      ) {
        matchingRowIndex = i + 1;
        break;
      }
    }

    if (matchingRowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!A${matchingRowIndex}:L${matchingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [formattedRowData] }
      });
      console.log(`[✏️ OVERWRITING ROW ${matchingRowIndex}] Date: ${targetDate} | Team: ${targetTeam} | Sender: ${targetSender} | Location: ${targetLocation}`);

      // Clear duplicate rows if present
      for (let i = rows.length - 1; i >= 1; i--) {
        const rIndex = i + 1;
        if (rIndex !== matchingRowIndex) {
          const pRow = parseSalesRowData(rows[i]);
          if (
            pRow &&
            pRow.date === targetDate &&
            isSameTeam(pRow.teamName, targetTeam, pRow.managerName, targetManager) &&
            isSameLocation(pRow.location, targetLocation) &&
            isSameSender(pRow.sender, targetSender)
          ) {
            await sheets.spreadsheets.values.clear({
              spreadsheetId,
              range: `'${tabName}'!A${rIndex}:L${rIndex}`
            });
            console.log(`[🧹 CLEARED DUPLICATE ROW ${rIndex}] Date: ${targetDate} | Team: ${targetTeam} | Sender: ${targetSender} | Location: ${targetLocation}`);
          }
        }
      }
      return { action: 'updated', rowIndex: matchingRowIndex };
    } else {
      await appendRowToSheet(tabName, formattedRowData);
      console.log(`[➕ APPENDED NEW ROW] Date: ${targetDate} | Team: ${targetTeam} | Sender: ${targetSender} | Location: ${targetLocation}`);
      return { action: 'appended' };
    }
  } catch (err) {
    console.error(`Error in updateOrAppendSalesRow:`, err.message);
    return appendRowToSheet(tabName, formattedRowData);
  }
}

/**
 * Automatically calculate running Daily Grand Total across ALL teams for a given Date,
 * sync it to "ផលសរុបប្រចាំថ្ងៃ" (SUMMARY_TAB), and return the summary object.
 */
export async function calculateAndSyncDailyGrandTotal(targetDateStr) {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  const targetDate = normalizeDateString(targetDateStr || normalizeDateString(new Date().toISOString().split('T')[0]));

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SALES_TAB}'!A:L`
    });

    const rows = res.data.values || [];
    let grandRevenue = 0;
    let grandCash = 0;
    let grandBank = 0;
    const reportedTeams = new Set();

    for (let i = 1; i < rows.length; i++) {
      const pRow = parseSalesRowData(rows[i]);
      if (pRow && pRow.date === targetDate) {
        const teamKey = extractTeamIdentifier(pRow.teamName) || pRow.teamName;
        reportedTeams.add(teamKey);

        grandRevenue += pRow.totalRevenueNum;
        grandCash += pRow.cashNum;
        grandBank += pRow.bankNum;
      }
    }

    const teamCount = reportedTeams.size;
    const grandTotalStr = formatKhmerCurrency(grandRevenue);
    const grandCashStr = formatKhmerCurrency(grandCash);
    const grandBankStr = formatKhmerCurrency(grandBank);

    const summaryRowData = [
      targetDate,
      `${teamCount} ក្រុម`,
      grandTotalStr,
      grandCashStr,
      grandBankStr
    ];

    const sumRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SUMMARY_TAB}'!A:E`
    });

    const sumRows = sumRes.data.values || [];
    let targetRowIndex = -1;

    for (let i = 1; i < sumRows.length; i++) {
      const sDate = normalizeDateString(sumRows[i][0]);
      if (sDate === targetDate) {
        targetRowIndex = i + 1;
        break;
      }
    }

    if (targetRowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SUMMARY_TAB}'!A${targetRowIndex}:E${targetRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [summaryRowData] }
      });
      console.log(`[📊 RE-SYNCED SUMMARY TAB ROW ${targetRowIndex}] Date: ${targetDate} | Teams: ${teamCount} | Total: ${grandTotalStr}`);
    } else {
      await appendRowToSheet(SUMMARY_TAB, summaryRowData);
      console.log(`[📊 CREATED NEW SUMMARY TAB ROW] Date: ${targetDate} | Teams: ${teamCount} | Total: ${grandTotalStr}`);
    }

    return {
      targetDate,
      teamCount,
      grandTotal: grandTotalStr,
      grandCash: grandCashStr,
      grandBank: grandBankStr,
      grandRevenueNum: grandRevenue
    };
  } catch (err) {
    console.error(`Error in calculateAndSyncDailyGrandTotal:`, err.message);
    return {
      targetDate,
      teamCount: 0,
      grandTotal: '0៛',
      grandCash: '0៛',
      grandBank: '0៛',
      grandRevenueNum: 0
    };
  }
}

/**
 * Fetch total sales analytics for today or a specific date range (periodKey: 'today' | 'yesterday' | '7days' | 'month' | 'last_month' | 'all')
 */
export async function getFinancialAnalyticsRange(periodKey = 'all') {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SALES_TAB}'!A:L`
    });

    const rows = res.data.values || [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let periodLabel = 'សរុបទាំងអស់ (All-Time)';
    if (periodKey === 'today') {
      const tStr = `${String(todayStart.getDate()).padStart(2, '0')}/${String(todayStart.getMonth() + 1).padStart(2, '0')}/${todayStart.getFullYear()}`;
      periodLabel = `ថ្ងៃនេះ (${tStr})`;
    } else if (periodKey === 'yesterday') {
      const yEst = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - 1);
      const yStr = `${String(yEst.getDate()).padStart(2, '0')}/${String(yEst.getMonth() + 1).padStart(2, '0')}/${yEst.getFullYear()}`;
      periodLabel = `ម្សិលមិញ (${yStr})`;
    } else if (periodKey === '7days') {
      periodLabel = '៧ ថ្ងៃចុងក្រោយ (7 Days)';
    } else if (periodKey === 'month') {
      periodLabel = `ខែនេះ (${todayStart.getMonth() + 1}/${todayStart.getFullYear()})`;
    } else if (periodKey === 'last_month') {
      const lm = new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1);
      periodLabel = `ខែមុន (${lm.getMonth() + 1}/${lm.getFullYear()})`;
    }

    const emptyResult = {
      periodLabel,
      reportCount: 0,
      uniqueTeamsCount: 0,
      totalPeopleCount: 0,
      totalMoneyFormatted: '0៛',
      cashMoneyFormatted: '0៛',
      bankMoneyFormatted: '0៛',
      groupBreakdownList: [],
      sellersList: []
    };

    if (rows.length <= 1) {
      return emptyResult;
    }

    let revenueSum = 0;
    let cashSum = 0;
    let bankSum = 0;
    let reportsCount = 0;
    const groupBreakdownMap = {};
    const sellersCountMap = {};
    let grandPeople = 0;

    function parseDateDDMMYYYY(dStr) {
      if (!dStr) return null;
      const parts = dStr.trim().split(/[\/-]/);
      if (parts.length < 3) return null;
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
      return new Date(year, month, day);
    }

    for (let i = 1; i < rows.length; i++) {
      const pRow = parseSalesRowData(rows[i]);
      if (!pRow) continue;

      const rowDate = parseDateDDMMYYYY(pRow.date);
      let isInRange = true;

      if (rowDate) {
        const rowTime = rowDate.getTime();
        const todayTime = todayStart.getTime();

        if (periodKey === 'today') {
          isInRange = (rowTime === todayTime);
        } else if (periodKey === 'yesterday') {
          const yEstTime = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - 1).getTime();
          isInRange = (rowTime === yEstTime);
        } else if (periodKey === '7days') {
          const sevenDaysAgo = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - 6).getTime();
          isInRange = (rowTime >= sevenDaysAgo && rowTime <= todayTime);
        } else if (periodKey === 'month') {
          isInRange = (rowDate.getMonth() === todayStart.getMonth() && rowDate.getFullYear() === todayStart.getFullYear());
        } else if (periodKey === 'last_month') {
          const lmMonth = todayStart.getMonth() === 0 ? 11 : todayStart.getMonth() - 1;
          const lmYear = todayStart.getMonth() === 0 ? todayStart.getFullYear() - 1 : todayStart.getFullYear();
          isInRange = (rowDate.getMonth() === lmMonth && rowDate.getFullYear() === lmYear);
        }
      }

      if (isInRange) {
        reportsCount++;
        const teamName = pRow.teamName;

        revenueSum += pRow.totalRevenueNum;
        cashSum += pRow.cashNum;
        bankSum += pRow.bankNum;

        if (!groupBreakdownMap[teamName]) {
          groupBreakdownMap[teamName] = {
            teamName,
            sellerCount: pRow.sellerCount,
            revenueNum: pRow.totalRevenueNum
          };
          grandPeople += pRow.sellerCount;
        } else {
          groupBreakdownMap[teamName].revenueNum += pRow.totalRevenueNum;
          if (pRow.sellerCount > groupBreakdownMap[teamName].sellerCount) {
            grandPeople += (pRow.sellerCount - groupBreakdownMap[teamName].sellerCount);
            groupBreakdownMap[teamName].sellerCount = pRow.sellerCount;
          }
        }

        if (pRow.members && pRow.members !== 'N/A') {
          const mList = pRow.members.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
          mList.forEach(name => {
            sellersCountMap[name] = (sellersCountMap[name] || 0) + 1;
          });
        }
      }
    }

    const groupBreakdownList = Object.values(groupBreakdownMap).map(g => ({
      teamName: g.teamName,
      sellerCount: g.sellerCount,
      totalMoneyNum: g.revenueNum,
      totalMoneyStr: formatKhmerCurrency(g.revenueNum)
    }));

    const sellersList = Object.entries(sellersCountMap).map(([name, count]) => ({
      name,
      count
    })).sort((a, b) => b.count - a.count);

    return {
      periodLabel,
      reportCount: reportsCount,
      uniqueTeamsCount: groupBreakdownList.length,
      totalPeopleCount: grandPeople,
      totalMoneyFormatted: formatKhmerCurrency(revenueSum),
      cashMoneyFormatted: formatKhmerCurrency(cashSum),
      bankMoneyFormatted: formatKhmerCurrency(bankSum),
      groupBreakdownList,
      sellersList
    };
  } catch (err) {
    console.error('Error fetching financial analytics:', err.message);
    return {
      periodLabel: 'សរុបទាំងអស់',
      reportCount: 0,
      uniqueTeamsCount: 0,
      totalPeopleCount: 0,
      totalMoneyFormatted: '0៛',
      cashMoneyFormatted: '0៛',
      bankMoneyFormatted: '0៛',
      groupBreakdownList: [],
      sellersList: []
    };
  }
}

/**
 * Automatically compile & format Grand Multi-Group Sales Summary Report to send to Boss ("មេ")
 */
export async function generateBossReportText(targetDateStr) {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SALES_TAB}'!A:L`
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      return `⚠️ ពុំទាន់មានទិន្នន័យរបាយការណ៍លក់នៅឡើយទេ។`;
    }

    let targetDate = targetDateStr ? normalizeDateString(targetDateStr) : '';
    const allParsedRows = [];

    for (let i = 1; i < rows.length; i++) {
      const pRow = parseSalesRowData(rows[i]);
      if (pRow) {
        allParsedRows.push(pRow);
      }
    }

    if (allParsedRows.length === 0) {
      return `⚠️ ពុំទាន់មានទិន្នន័យរបាយការណ៍លក់នៅឡើយទេ។`;
    }

    if (!targetDate) {
      targetDate = allParsedRows[allParsedRows.length - 1].date;
    }

    let matchingRows = allParsedRows.filter(r => r.date === targetDate);
    if (matchingRows.length === 0) {
      targetDate = allParsedRows[allParsedRows.length - 1].date;
      matchingRows = allParsedRows.filter(r => r.date === targetDate);
    }

    const groupMap = {};
    let grandPeople = 0;
    let grandRevenue = 0;

    for (const r of matchingRows) {
      let cleanTeamTitle = r.teamName;
      let managerName = r.managerName || '';

      const mgrMatch = r.teamName.match(/^([^\(\=]+)\(([^\)]+)\)/);
      if (mgrMatch) {
        cleanTeamTitle = mgrMatch[1].trim();
        if (!managerName || managerName === 'N/A') managerName = mgrMatch[2].trim();
      }

      // Merge key: Group primarily by Manager Name (e.g. 'ពូរួ'), otherwise by clean team title
      let teamKey = '';
      if (managerName && managerName !== 'N/A') {
        teamKey = `mgr_${managerName.toLowerCase().trim()}`;
      } else {
        teamKey = `team_${(extractTeamIdentifier(cleanTeamTitle) || cleanTeamTitle).toLowerCase().trim()}`;
      }

      if (!groupMap[teamKey]) {
        groupMap[teamKey] = {
          teamTitle: cleanTeamTitle,
          managerName: (managerName && managerName !== 'N/A') ? managerName : '',
          sellerCount: r.sellerCount,
          totalRevenueNum: r.totalRevenueNum,
          locations: [
            {
              locationName: r.location,
              amountNum: r.totalRevenueNum,
              amountStr: `${r.totalRevenueNum}៛`
            }
          ]
        };
        grandPeople += r.sellerCount;
        grandRevenue += r.totalRevenueNum;
      } else {
        groupMap[teamKey].totalRevenueNum += r.totalRevenueNum;
        grandRevenue += r.totalRevenueNum;

        groupMap[teamKey].sellerCount += r.sellerCount;
        grandPeople += r.sellerCount;

        if (managerName && managerName !== 'N/A' && !groupMap[teamKey].managerName) {
          groupMap[teamKey].managerName = managerName;
        }

        groupMap[teamKey].locations.push({
          locationName: r.location,
          amountNum: r.totalRevenueNum,
          amountStr: `${r.totalRevenueNum}៛`
        });
      }
    }

    const groupsList = Object.values(groupMap);
    if (groupsList.length === 0) {
      return `⚠️ ពុំទាន់មានទិន្នន័យរបាយការណ៍លក់សម្រាប់ថ្ងៃទី ${targetDate} នៅឡើយទេ។`;
    }

    let report = `បាទគោរពមេ🙏🙏🙏\n`;
    report += `ទិន្នន័យលក់(${groupsList.length}ក្រុម)\n`;
    report += `ថ្ងៃទី${targetDate}\n\n`;

    groupsList.forEach((g, gIdx) => {
      const groupNumStr = `ក្រុមទី${gIdx + 1}`;
      const mgrStr = g.managerName ? `${g.managerName} ` : '';
      const locCount = g.locations.length;
      const headerStr = `=>${groupNumStr}(${mgrStr}${locCount} ទីតាំង= ${g.sellerCount}នាក់)`;
      report += `${headerStr}\n`;

      g.locations.forEach((loc, lIdx) => {
        const amtStr = `${loc.amountNum}៛`;
        report += `-ទីតាំងទី${lIdx + 1} លក់បាន= ${amtStr}\n`;
      });

      if (gIdx < groupsList.length - 1) {
        report += `\n`;
      }
    });

    report += `\nសរុបចំនួនមនុស្ស=${grandPeople} នាក់\n`;
    report += `សរុបលក់បាន= ${formatKhmerCurrency(grandRevenue)}\n`;
    report += `គោរពអរគុណមេ🙏🙏🙏`;

    return report;
  } catch (err) {
    console.error('Error generating boss report text:', err.message);
    return `⚠️ ពុំអាចបង្កើតរបាយការណ៍ជូនមេបានទេ: ${err.message}`;
  }
}

export async function getSheetStats() {
  const sheets = await getSheetsClient();
  const spreadsheetId = config.spreadsheetId;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SALES_TAB}'!A:F`
    });

    const rows = res.data.values || [];
    return {
      totalRows: Math.max(0, rows.length - 1),
      lastUpdated: new Date().toLocaleString()
    };
  } catch (err) {
    return { totalRows: 0, lastUpdated: 'N/A' };
  }
}
