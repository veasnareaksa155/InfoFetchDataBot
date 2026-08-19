/**
 * Smart Message Data Extractor, Sanitizer & Input Validation Engine
 */

export function extractNumericValue(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[^\d]/g, '');
  if (!cleaned) return 0;
  const num = parseInt(cleaned, 10);
  return isFinite(num) && num < 100000000000 ? num : 0;
}

export function formatKhmerCurrency(num) {
  if (isNaN(num) || !isFinite(num)) return '0៛';
  return num.toLocaleString('en-US') + '៛';
}

export function cleanSellerName(rawName) {
  if (!rawName) return '';
  return String(rawName)
    .replace(/^[\d+.\-•*\s]+/, '') // Remove leading numbers (1. 2.), bullets (- *), pluses (+)
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
    .trim();
}

/**
 * Extract Group Name & Manager Name directly from Telegram Group Title (e.g. "រ៉ឺម៉កទី2 បងA5", "ក្រុមទី1 បងរិត")
 */
export function parseGroupTitle(chatTitle = '') {
  if (!chatTitle) return { groupName: '', managerName: '' };
  
  const cleanTitle = String(chatTitle).trim();
  if (cleanTitle === 'Private Chat' || cleanTitle.includes('Group Logs')) {
    return { groupName: '', managerName: '' };
  }
  
  // Matches "រ៉ឺម៉កទី2 បងA5", "រម៉កទី2 បងA5", "ក្រុមទី2 ពូរួ", "ក្រុមទី1 បងរិត", "ទី2 ព្យួរ"
  const matchGroupMgr = cleanTitle.match(/^(រ៉ឺម៉កទី\d+|រម៉កទី\d+|ក្រុមទី\d+|ទី\d+|ក្រុម[^\s\(\=]+|\S+)\s+(.+)$/i);
  if (matchGroupMgr) {
    let gName = matchGroupMgr[1].trim();
    if (gName.startsWith('ទី') || gName.match(/^\d+/)) {
      gName = `ក្រុម${gName}`;
    }
    return {
      groupName: gName,
      managerName: matchGroupMgr[2].trim()
    };
  }

  let finalGName = cleanTitle;
  if (finalGName.startsWith('ទី') || finalGName.match(/^\d+/)) {
    finalGName = `ក្រុម${finalGName}`;
  }

  return {
    groupName: finalGName,
    managerName: ''
  };
}

/**
 * Standardize any date format (YYYY-MM-DD or DD/MM/YYYY) to canonical DD/MM/YYYY
 */
export function normalizeDateString(dateStr = '') {
  if (!dateStr) return '';
  const cleaned = String(dateStr).trim();
  const parts = cleaned.split(/[\/-]/);
  if (parts.length >= 3) {
    let day, month, year;
    if (parts[0].length === 4) {
      // YYYY-MM-DD -> DD/MM/YYYY
      year = parts[0];
      month = parts[1].padStart(2, '0');
      day = parts[2].padStart(2, '0');
    } else {
      // DD/MM/YYYY -> DD/MM/YYYY
      day = parts[0].padStart(2, '0');
      month = parts[1].padStart(2, '0');
      year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
    }
    return `${day}/${month}/${year}`;
  }
  return cleaned;
}

/**
 * Sanitize text to prevent cell overflow or control character bugs
 */
export function sanitizeInputText(text = '') {
  if (!text || typeof text !== 'string') return '';
  let safe = text.slice(0, 4000);
  return safe.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function parseKhmerSalesReport(text = '', chatTitle = '') {
  const safeText = sanitizeInputText(text);
  if (!safeText) return null;

  const isReport = safeText.includes('ទិន្នន័យលក់') || 
                   safeText.includes('របាយការណ៍លក់') || 
                   safeText.includes('ផលិតផលលក់') || 
                   safeText.includes('លុយសរុប') ||
                   safeText.includes('សរុបលក់បាន') ||
                   safeText.includes('សរុបចំនួនមនុស្ស') ||
                   safeText.includes('=>') ||
                   safeText.includes('ក្រុម') ||
                   safeText.includes('រ៉ឺម៉ក') ||
                   safeText.includes('រម៉ក') ||
                   safeText.includes('លុយក្រៅ') ||
                   safeText.includes('លុយកុង') ||
                   safeText.includes('លុយក្នុងកុង');

  if (!isReport) return null;

  // Extract Report Date
  const dateMatch = safeText.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
  const reportDateRaw = dateMatch ? dateMatch[1] : '';
  const reportDate = normalizeDateString(reportDateRaw);

  // Check if Multi-Group Summary Report (contains =>ក្រុម or multiple => markers)
  const isMultiGroup = safeText.includes('=>') || (safeText.includes('សរុបលក់បាន') && safeText.includes('សរុបចំនួនមនុស្ស'));

  if (isMultiGroup && (safeText.includes('=>') || safeText.includes('ក្រុមទី') || safeText.includes('រ៉ឺម៉ក') || safeText.includes('រម៉ក'))) {
    const subGroups = [];
    const groupBlocks = safeText.split('=>').filter(b => b.trim());

    let grandPeopleCount = 0;
    let grandTotalMoneyCalculated = 0;

    for (const block of groupBlocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      const headerLine = lines[0]; // e.g. "ក្រុមទី1(បងរិត 9 ទីតាំង= 12នាក់)" or "រ៉ឺម៉កទី2(បងA5 2 ទីតាំង= 3នាក់)"
      if (!headerLine.includes('ក្រុម') && !headerLine.includes('ទីតាំង') && !headerLine.includes('រ៉ឺម៉ក') && !headerLine.includes('រម៉ក')) continue;

      // Extract seller/people count in header e.g. "12នាក់" or "12 នាក់"
      const peopleMatch = headerLine.match(/(\d+)\s*នាក់/i);
      const sellerCount = peopleMatch ? parseInt(peopleMatch[1], 10) : 0;
      grandPeopleCount += sellerCount;

      // Clean group title e.g. "ក្រុមទី1 (បងរិត)" or "រ៉ឺម៉កទី2 (បងA5)"
      const titleMatch = headerLine.match(/((?:ក្រុម|រ៉ឺម៉ក|រម៉ក)[^\(=]+(?:\([^\)]+\))?)/i) || [headerLine, headerLine];
      const groupTitle = titleMatch[1].trim();

      // Extract itemized location sales amounts in this group
      let groupSubtotal = 0;
      const locationDetails = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('សរុប') || line.startsWith('គោរព')) break;

        const val = extractNumericValue(line);
        if (val > 0 || line.includes('0៛') || line.includes('លក់បាន')) {
          groupSubtotal += val;
          locationDetails.push(line);
        }
      }

      grandTotalMoneyCalculated += groupSubtotal;

      subGroups.push({
        groupTitle,
        sellerCount,
        subtotalNum: groupSubtotal,
        subtotalStr: formatKhmerCurrency(groupSubtotal),
        detailsText: locationDetails.join(' | ')
      });
    }

    // Extract Overall People & Sales Totals from report footer if present
    const footerPeopleMatch = safeText.match(/សរុបចំនួនមនុស្ស\s*[:=]?\s*(\d+)/i);
    const totalPeople = footerPeopleMatch ? parseInt(footerPeopleMatch[1], 10) : grandPeopleCount;

    const footerTotalMatch = safeText.match(/(?:សរុបលក់បាន|ប្រាក់សរុប|លុយសរុប)\s*[:=]?\s*([^\n]+)/i);
    let totalMoneyNum = footerTotalMatch ? extractNumericValue(footerTotalMatch[1]) : grandTotalMoneyCalculated;
    if (totalMoneyNum === 0) totalMoneyNum = grandTotalMoneyCalculated;

    const totalMoneyStr = formatKhmerCurrency(totalMoneyNum);

    // Build multi-group breakdown string
    const breakdownText = subGroups.map(sg => `• ${sg.groupTitle}: ${sg.subtotalStr} (${sg.sellerCount} នាក់)`).join('\n');

    return {
      isKhmerSalesReport: true,
      isMultiGroup: true,
      reportDate,
      location: `សរុប ${subGroups.length} ក្រុម`,
      sellerCount: totalPeople,
      sellersList: subGroups.map(sg => sg.groupTitle).join(', '),
      productsText: subGroups.map(sg => `${sg.groupTitle}: ${sg.subtotalStr}`).join(' | '),
      totalProductsQty: subGroups.length,
      totalMoneyStr,
      cashMoneyStr: totalMoneyStr,
      bankMoneyStr: '0៛',
      totalMoneyNum,
      cashMoneyNum: totalMoneyNum,
      bankMoneyNum: 0,
      subGroups,
      breakdownText
    };
  }

  // Single Team Sales Report Parsing (Support + ក្រុមទី2, + អ្នកគ្រប់គ្រង, Telegram Group Title e.g. "រ៉ឺម៉កទី2 បងA5", + ទីតាំង ចល័ត)
  const groupMatch = safeText.match(/\+\s*((?:ក្រុម|រ៉ឺម៉ក|រម៉ក)[^\n+]+)/i) || safeText.match(/(?:^|\n)\+\s*((?:ក្រុម|រ៉ឺម៉ក|រម៉ក)[^\n+]+)/i);
  let groupName = groupMatch ? groupMatch[1].trim() : '';

  if (!groupName) {
    const fallbackMatch = safeText.match(/\+\s*(?:ក្រុម|រ៉ឺម៉ក|រម៉ក|ទី(?!តាំង))\s*[:\s]*([^\n+]+)/i);
    if (fallbackMatch) {
      groupName = fallbackMatch[1].trim();
    }
  }

  if (groupName && (groupName.startsWith('ទី') || groupName.match(/^\d+/))) {
    groupName = `ក្រុម${groupName}`;
  }

  // Extract Manager Name e.g. "+ អ្នកគ្រប់គ្រង ពូរួ" or "+ ប្រធានក្រុម ពូរួ"
  const managerMatch = safeText.match(/\+\s*(?:អ្នកគ្រប់គ្រង|ប្រធានក្រុម|ប្រធាន|អ្នកកាន់)\s*[:\s]*([^\n+]+)/i);
  let managerName = managerMatch ? managerMatch[1].trim() : '';

  // If group line contains parenthesis e.g. "+ ក្រុមទី2 (ពូរួ)"
  if (groupName) {
    const groupWithManagerMatch = groupName.match(/^([^\(\=]+)\(([^\)]+)\)/);
    if (groupWithManagerMatch) {
      groupName = groupWithManagerMatch[1].trim();
      if (!managerName) managerName = groupWithManagerMatch[2].trim();
    }
  }

  // Auto-extract Group & Manager Name from Telegram Group Title if missing in text! (e.g. "រ៉ឺម៉កទី2 បងA5")
  const titleParsed = parseGroupTitle(chatTitle);
  if (!groupName && titleParsed.groupName) {
    groupName = titleParsed.groupName;
  }
  if (!managerName && titleParsed.managerName) {
    managerName = titleParsed.managerName;
  }

  if (groupName) {
    groupName = groupName.replace(/^(?:ទី)?តាំង\s*/i, '').trim();
  }

  if (groupName && (groupName.startsWith('ទី') || groupName.match(/^\d+/))) {
    groupName = `ក្រុម${groupName}`;
  }

  if (managerName) {
    managerName = managerName.replace(/^[\(\s]+|[\)\s]+$/g, '').trim();
  }

  const locationMatch = safeText.match(/\+\s*ទីតាំង\s*[:\s]*([^\n+]+)/i) || safeText.match(/ទីតាំង\s*[:\s]*([^\n]+)/i);
  const rawLocation = locationMatch ? locationMatch[1].trim() : '';

  // Construct standardized full team title
  let fullTeamTitle = groupName || 'ក្រុមចល័ត';
  if (managerName && !fullTeamTitle.includes(managerName)) {
    fullTeamTitle = `${fullTeamTitle} (${managerName})`;
  }

  let finalLocation = fullTeamTitle;
  if (rawLocation && !finalLocation.includes(rawLocation)) {
    finalLocation = `${fullTeamTitle} - ${rawLocation}`;
  }

  // Extract Sellers (Deduplicated per report)
  const sellersSection = safeText.match(/(?:\+\s*សមាជិក[^\n]*\n)([\s\S]*?)(?=\+|\n\s*\+|$)/i);
  const sellersList = [];
  const seenSellersInReport = new Set();

  if (sellersSection) {
    const lines = sellersSection[1].split('\n');
    for (const l of lines) {
      const cleaned = cleanSellerName(l);
      if (cleaned && !cleaned.startsWith('+') && !cleaned.includes('ផលិតផល')) {
        const lower = cleaned.toLowerCase();
        if (!seenSellersInReport.has(lower)) {
          seenSellersInReport.add(lower);
          sellersList.push(cleaned);
        }
      }
    }
  }

  // Extract Products list & Calculate total items sold
  const productsSection = safeText.match(/(?:\+\s*ផលិតផល[^\n]*\n)([\s\S]*?)(?=\+|\n\s*\+|$)/i);
  const productsList = [];
  let totalProductsQty = 0;

  if (productsSection) {
    const lines = productsSection[1].split('\n');
    for (const l of lines) {
      let cleaned = l.replace(/^-\s*/, '').trim();
      if (cleaned && !cleaned.startsWith('+')) {
        // Strip price suffix e.g. " = 40000$", " = 40000៛", " = 16000", ": 8000"
        const prodOnly = cleaned.replace(/\s*[:=]\s*\d+\s*[\$៛]?.*$/i, '').trim();
        if (prodOnly) {
          productsList.push(prodOnly);
          const qtyMatch = prodOnly.match(/(\d+)\s*(?:ដប|កញ្ចប់|ប្រអប់|មុខ|កំប៉ុង|ដើម|ចាន|កែវ)/i) || prodOnly.match(/(\d+)/);
          if (qtyMatch) {
            totalProductsQty += parseInt(qtyMatch[1], 10);
          }
        }
      }
    }
  }

  // Extract Raw Totals with variations
  const totalMoneyMatch = safeText.match(/(?:លុយសរុប|ប្រាក់សរុប|សរុបប្រាក់|សរុប)\s*[:=]\s*([^\n\+]+)/i);
  const rawTotalStr = totalMoneyMatch ? totalMoneyMatch[1].trim() : '';

  const cashMatch = safeText.match(/(?:លុយក្រៅ|សាច់ប្រាក់|លុយស្រស់|លុយដៃ)\s*[:=]\s*([^\n\+]+)/i);
  const rawCashStr = cashMatch ? cashMatch[1].trim() : '';

  const bankMatch = safeText.match(/(?:លុយកុង|លុយក្នុងកុង|ធនាគារ|កុង)\s*[:=]\s*([^\n\+]+)/i);
  const rawBankStr = bankMatch ? bankMatch[1].trim() : '';

  // Extract Numeric Values
  let totalMoneyNum = extractNumericValue(rawTotalStr);
  let cashMoneyNum = extractNumericValue(rawCashStr);
  let bankMoneyNum = extractNumericValue(rawBankStr);

  // Self-correcting financial math balance: Total = Cash + Bank
  if (totalMoneyNum === 0 && (cashMoneyNum > 0 || bankMoneyNum > 0)) {
    totalMoneyNum = cashMoneyNum + bankMoneyNum;
  } else if (totalMoneyNum > 0 && cashMoneyNum > 0 && bankMoneyNum === 0) {
    bankMoneyNum = Math.max(0, totalMoneyNum - cashMoneyNum);
  } else if (totalMoneyNum > 0 && bankMoneyNum > 0 && cashMoneyNum === 0) {
    cashMoneyNum = Math.max(0, totalMoneyNum - bankMoneyNum);
  }

  const totalMoneyStr = formatKhmerCurrency(totalMoneyNum);
  const cashMoneyStr = formatKhmerCurrency(cashMoneyNum);
  const bankMoneyStr = formatKhmerCurrency(bankMoneyNum);

  return {
    isKhmerSalesReport: true,
    isMultiGroup: false,
    reportDate,
    location: finalLocation,
    groupTitle: fullTeamTitle,
    rawLocation: rawLocation || 'ចល័ត',
    groupName,
    managerName,
    sellerCount: sellersList.length,
    sellersList: sellersList.join(', '),
    productsText: productsList.join(' | '),
    totalProductsQty,
    totalMoneyStr,
    cashMoneyStr,
    bankMoneyStr,
    totalMoneyNum,
    cashMoneyNum,
    bankMoneyNum
  };
}

export function parseMessageData(text = '', chatTitle = '') {
  const safeText = sanitizeInputText(text);
  if (!safeText) {
    return {
      name: '',
      phone: '',
      amount: '',
      category: '',
      note: '',
      isStructured: false
    };
  }

  const khmerReport = parseKhmerSalesReport(safeText, chatTitle);
  if (khmerReport && khmerReport.isKhmerSalesReport) {
    return {
      name: khmerReport.sellersList ? `${khmerReport.sellerCount} នាក់ (${khmerReport.sellersList})` : 'N/A',
      phone: khmerReport.location ? `ទីតាំង: ${khmerReport.location}` : 'N/A',
      amount: khmerReport.totalMoneyStr || 'N/A',
      category: 'របាយការណ៍លក់ (Sales Report)',
      note: `កាលបរិច្ឆេទ: ${khmerReport.reportDate} | លុយក្រៅ: ${khmerReport.cashMoneyStr} | លុយក្នុងកុង: ${khmerReport.bankMoneyStr}\n\nផលិតផល:\n${khmerReport.productsText}`,
      isStructured: true,
      khmerReport
    };
  }

  const lines = safeText.split('\n');
  const extracted = {
    name: '',
    phone: '',
    amount: '',
    category: '',
    note: '',
    isStructured: false
  };

  const keyMap = {
    name: ['name', 'fullname', 'full name', 'customer', 'client', 'user', 'ឈ្មោះ'],
    phone: ['phone', 'tel', 'telephone', 'mobile', 'contact', 'number', 'លេខទូរស័ព្ទ'],
    amount: ['amount', 'price', 'cost', 'total', 'money', 'value', 'តម្លៃ', 'ចំនួនទឹកប្រាក់', 'លុយសរុប'],
    category: ['category', 'type', 'tag', 'item', 'product', 'ប្រភេទ', 'ទីតាំង'],
    note: ['note', 'notes', 'description', 'detail', 'details', 'remark', 'ចំណាំ']
  };

  const remainingLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^([^:=]+)[:=]\s*(.+)$/);

    if (match) {
      const rawKey = match[1].trim().toLowerCase();
      const value = match[2].trim();

      let matchedKey = null;
      for (const [standardKey, aliases] of Object.entries(keyMap)) {
        if (aliases.some(alias => rawKey.includes(alias))) {
          matchedKey = standardKey;
          break;
        }
      }

      if (matchedKey && value) {
        extracted[matchedKey] = value;
        extracted.isStructured = true;
        continue;
      }
    }

    remainingLines.push(trimmed);
  }

  const fullText = remainingLines.join(' ');

  if (!extracted.phone) {
    const phoneMatch = fullText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
    if (phoneMatch && phoneMatch[0].length >= 8) {
      extracted.phone = phoneMatch[0];
      extracted.isStructured = true;
    }
  }

  if (!extracted.amount) {
    const amountMatch = fullText.match(/(?:\$|USD|KHR|៛)?\s*\b\d+(?:[.,]\d{1,2})?\s*(?:\$|USD|KHR|៛)?/i);
    if (amountMatch && /\d/.test(amountMatch[0])) {
      const val = amountMatch[0].trim();
      if (!extracted.phone || val !== extracted.phone) {
        extracted.amount = val;
      }
    }
  }

  if (!extracted.category) {
    const hashtagMatch = safeText.match(/#(\w+)/);
    if (hashtagMatch) {
      extracted.category = hashtagMatch[1];
      extracted.isStructured = true;
    }
  }

  if (!extracted.note) {
    extracted.note = remainingLines.length > 0 ? remainingLines.join('\n') : safeText;
  }

  return extracted;
}
