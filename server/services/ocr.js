// OCR Service — extracts payment data from receipt images
// Supports: Google Vision API (recommended) or Tesseract.js (fallback)

/**
 * Extract payment info from a receipt image or PDF buffer
 * Returns: { name, amount, date, reference, bank, raw_text }
 */
async function extractReceiptData(imageBuffer, mimeType = 'image/jpeg') {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;

  if (apiKey) {
    const isPdf = mimeType === 'application/pdf';
    return isPdf
      ? extractPdfWithGoogleVision(imageBuffer, apiKey)
      : extractImageWithGoogleVision(imageBuffer, apiKey);
  }
  console.warn('[ocr] No GOOGLE_VISION_API_KEY set — OCR disabled');
  return null;
}

async function extractImageWithGoogleVision(imageBuffer, apiKey) {
  const base64 = imageBuffer.toString('base64');

  const body = {
    requests: [{
      image: { content: base64 },
      features: [{ type: 'TEXT_DETECTION' }],
    }],
  };

  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[ocr] Vision API error:', err);
    throw new Error('Google Vision API error');
  }

  const data = await res.json();
  const fullText = data.responses?.[0]?.fullTextAnnotation?.text || '';

  if (!fullText) {
    console.warn('[ocr] No text detected in image');
    return null;
  }

  return parseBolivianReceipt(fullText);
}

async function extractPdfWithGoogleVision(pdfBuffer, apiKey) {
  const base64 = pdfBuffer.toString('base64');

  const body = {
    requests: [{
      inputConfig: {
        content: base64,
        mimeType: 'application/pdf',
      },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
    }],
  };

  const res = await fetch(
    `https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[ocr] Vision API PDF error:', err);
    throw new Error('Google Vision API PDF error');
  }

  const data = await res.json();
  // files:annotate returns responses[].responses[] (double nested)
  const pages = data.responses?.[0]?.responses || [];
  const fullText = pages.map(p => p.fullTextAnnotation?.text || '').join('\n');

  if (!fullText.trim()) {
    console.warn('[ocr] No text detected in PDF');
    return null;
  }

  console.log(`[ocr] PDF text extracted (${fullText.length} chars, ${pages.length} pages)`);
  return parseBolivianReceipt(fullText);
}

/**
 * Parse Bolivian bank transfer receipt text
 * Tested with: Mercantil Santa Cruz, BCP, BISA, BancoSol, Banco Ganadero, BNB, Banco Union
 *
 * Valid destination accounts:
 * - 30151182874355
 * - 6896894011
 * - 3501136408
 */
function parseBolivianReceipt(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = text;
  const VALID_DESTINATION_ACCOUNTS = new Set(
    ['30151182874355', '6896894011', '3501136408', ...(process.env.VALID_DESTINATION_ACCOUNTS || '').split(',')]
      .map(value => String(value || '').replace(/\D/g, ''))
      .filter(Boolean)
  );
  function normalizeAccount(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function normalizeTextForMatch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function identitySignalFromTokens({ tokens, compact }) {
    const hasMacLean = compact.includes('maclean') || (tokens.has('mac') && tokens.has('lean'));
    const hasDaniel = tokens.has('daniel');
    const hasOscar = tokens.has('oscar');
    const hasEstrada = tokens.has('estrada');

    // Oscar/Daniel/Estrada are common Bolivian names — only trust when at least
    // two strong signals appear together. "Mac Lean" alone is uncommon enough
    // that pairing it with any of the given names (or the surname Estrada) is safe.
    if (hasMacLean && (hasDaniel || hasOscar || hasEstrada)) return true;
    if (hasOscar && hasDaniel && hasEstrada) return true;
    return false;
  }

  function isTrustedDestinationName(value) {
    const normalized = normalizeTextForMatch(value);
    if (!normalized) return false;

    const tokens = new Set(normalized.split(' ').filter(Boolean));
    const compact = normalized.replace(/\s+/g, '');

    if (identitySignalFromTokens({ tokens, compact })) return true;

    const configuredNames = (process.env.VALID_DESTINATION_NAMES || '')
      .split(',')
      .map(normalizeTextForMatch)
      .filter(name => name.length >= 8);
    return normalized.length >= 8 && configuredNames.some(name => normalized.includes(name) || name.includes(normalized));
  }

  function findUserIdentityInText(text, senderName) {
    let normalized = normalizeTextForMatch(text);
    if (!normalized) return false;

    // Strip the sender's name first so common given names (Daniel, Oscar) coming
    // from the originante/De field don't leak into the destination check.
    const senderNorm = normalizeTextForMatch(senderName || '');
    if (senderNorm && senderNorm.length >= 4 && normalized.includes(senderNorm)) {
      normalized = normalized.split(senderNorm).join(' ').replace(/\s+/g, ' ').trim();
    }

    const tokens = new Set(normalized.split(' ').filter(Boolean));
    const compact = normalized.replace(/\s+/g, '');

    if (identitySignalFromTokens({ tokens, compact })) return true;

    const configuredNames = (process.env.VALID_DESTINATION_NAMES || '')
      .split(',')
      .map(normalizeTextForMatch)
      .filter(name => name.length >= 8);
    return configuredNames.some(name => normalized.includes(name));
  }

  function findWhitelistedAccountInText() {
    const candidates = new Set();

    for (const line of lines) {
      const inlineMatches = line.match(/\d[\d\s.-]{7,}\d/g) || [];
      for (const match of inlineMatches) {
        const normalized = normalizeAccount(match);
        if (normalized.length >= 8) candidates.add(normalized);
      }

      const normalizedLine = normalizeAccount(line);
      if (normalizedLine.length >= 8) candidates.add(normalizedLine);
    }

    for (const candidate of candidates) {
      if (VALID_DESTINATION_ACCOUNTS.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function findMaskedWhitelistedAccountInText() {
    const maskedAccountPattern = /\d[\d\s.*xX•●·∙-]{4,}\d/g;
    const maskPattern = /[*xX•●·∙]/;

    for (const line of lines) {
      const matches = line.match(maskedAccountPattern) || [];
      for (const match of matches) {
        if (!maskPattern.test(match)) continue;

        const compact = match.replace(/[\s.-]/g, '');
        const maskedMatch = compact.match(/^(\d{3,})([*xX•●·∙]+)(\d{3,})$/);
        if (!maskedMatch) continue;

        const [, prefix, , suffix] = maskedMatch;
        const matchingAccounts = [...VALID_DESTINATION_ACCOUNTS].filter(account =>
          account.startsWith(prefix) && account.endsWith(suffix)
        );

        if (matchingAccounts.length === 1) {
          return {
            account: matchingAccounts[0],
            maskedAccount: compact,
            prefix,
            suffix,
          };
        }
      }
    }

    return null;
  }

  // ─── Amount (Bs, BOB) ───
  let amount = null;
  const amountPatterns = [
    /(?:Bs\.?|BOB)\s*[:.]?\s*([\d.,]+)/i,
    /Monto[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /Importe[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /Total[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /La\s+suma\s+de\s+Bs\.?[:\s]*([\d.,]+)/i,
  ];
  for (const pat of amountPatterns) {
    const m = fullText.match(pat);
    if (m) {
      amount = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }

  // ─── Date (DD/MM/YYYY, YYYY-MM-DD, or "23 de marzo, 2026") ───
  let date = null;
  const datePatterns = [
    /(\d{2}\/\d{2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{2}-\d{2}-\d{4})/,
    /(\d{1,2}\s+de\s+\w+,?\s*\d{4})/i,
  ];
  for (const pat of datePatterns) {
    const m = fullText.match(pat);
    if (m) {
      date = m[1];
      break;
    }
  }

  // ─── Sender name (who paid) ───
  let name = null;

  // BISA/QR format: "De" on one line and the sender name on the next
  const deIdx = lines.findIndex(l => /^de[:\s]*$/i.test(l));
  if (deIdx >= 0 && deIdx + 1 < lines.length) {
    const candidate = lines[deIdx + 1];
    if (
      /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.]{4,}$/.test(candidate)
      && !/banco|credito|bolivia/i.test(candidate)
    ) {
      name = candidate.trim();
    }
  }

  // Inline format: "De: VARGAS VILLARROEL DANIELA"
  if (!name) {
    const deMatch = fullText.match(/^De[:\s]+([^\n]+)/im);
    if (deMatch && !/banco|credito|bolivia/i.test(deMatch[1])) {
      name = deMatch[1].trim();
    }
  }

  // BCP format: "Enviado por: Nunez Maldonado Valentina..."
  if (!name) {
    const envMatch = fullText.match(/Enviado por[:\s]+([^\n]+)/i);
    if (envMatch) name = envMatch[1].replace(/\.{3,}$/, '').trim();
  }

  // "Cuenta de origen" / "Cuenta origen" section — next line(s) have name
  if (!name) {
    const originIdx = lines.findIndex(l => /cuenta\s*(de\s+)?origen/i.test(l));
    if (originIdx >= 0) {
      for (let i = originIdx + 1; i < Math.min(originIdx + 4, lines.length); i++) {
        const line = lines[i];
        if (/^\d[\d\-]*$/.test(line)) continue; // skip account numbers
        if (/cuenta|origen|nit|ci\s*\/|banco\s/i.test(line)) continue; // skip labels
        // Name: either all-caps (Mercantil) or mixed case (BancoSol, Ganadero)
        if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s]{4,}$/.test(line) && !/banco|solidario|credito|ganadero|mercantil|santa\s*cruz|uni[oó]n|bisa|bnb|econ[oó]mico/i.test(line)) {
          name = line;
          break;
        }
      }
    }
  }

  // "A nombre de" → next line (BCP: sender section)
  if (!name) {
    const aNombreIdx = lines.findIndex((l, i) => {
      // Only match "A nombre de" in the SENDER section (before destination)
      const prevLines = lines.slice(Math.max(0, i - 3), i).join(' ');
      return /a nombre de/i.test(l) && /de la cuenta|origen/i.test(prevLines);
    });
    if (aNombreIdx >= 0 && aNombreIdx + 1 < lines.length) {
      const candidate = lines[aNombreIdx + 1];
      if (!/mac\s*lean/i.test(candidate)) {
        name = candidate;
      }
    }
  }

  // Fallback: all-caps name (skip Daniel's name + bank names)
  if (!name) {
    for (const line of lines) {
      if (/^[A-ZÁÉÍÓÚÑ]{2,}\s+[A-ZÁÉÍÓÚÑ]{2,}(\s+[A-ZÁÉÍÓÚÑ]+)*$/.test(line)) {
        if (/BANCO|CREDITO|BOLIVIA|MERCANTIL|SANTA\s*CRUZ|UNION|TRANSFERENCIA|EXITOSA|SOLIDARIO|GANADERO|PAGO\s*QR/i.test(line)) continue;
        if (/mac\s*lean/i.test(line)) continue;
        name = line;
        break;
      }
    }
  }

  // Extract the dest name for display (what the receipt says)
  let destName = null;
  let destAccount = null;

  // Pattern 0: BCP-style destination block
  // A la cuenta
  // 3015...
  // A nombre de
  // Oscar Daniel Mac Lean Estrada
  const aLaCuentaIdx = lines.findIndex(l => /a\s+la\s+cuenta/i.test(l));
  if (aLaCuentaIdx >= 0) {
    for (let i = aLaCuentaIdx + 1; i < Math.min(aLaCuentaIdx + 6, lines.length); i++) {
      if (!destAccount && /^\d[\d\s.-]{5,}$/.test(lines[i])) {
        destAccount = normalizeAccount(lines[i]);
      }
      if (/a nombre de/i.test(lines[i]) && i + 1 < lines.length) {
        const candidate = lines[i + 1];
        if (
          /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.]{4,}$/.test(candidate)
          && !/cuenta|destino|nit|ci\s*\/|banco|credito|solidario|ganadero|mercantil|bisa|bnb/i.test(candidate)
          && !/^\d/.test(candidate)
        ) {
          destName = candidate;
          break;
        }
      }
    }
  }

  // Pattern 1: "Cuenta destino" / "Cuenta de destino" section — next lines
  const destIdx = lines.findIndex(l => /cuenta\s*(de\s+)?destino/i.test(l));
  if (!destName && destIdx >= 0) {
    for (let i = destIdx + 1; i < Math.min(destIdx + 5, lines.length); i++) {
      const line = lines[i];
      if (/cuenta\s*(de\s+)?origen|fecha|monto|n[uú]mero|nro|concepto/i.test(line)) break;
      if (!destAccount && /^\d[\d\s.-]{5,}$/.test(line)) {
        destAccount = normalizeAccount(line);
        continue;
      }
      if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.]{4,}$/.test(line) && !/cuenta|destino|nit|ci\s*\/|banco|credito|solidario|ganadero|mercantil|bisa|bnb/i.test(line) && !/^\d/.test(line)) {
        destName = line;
        break;
      }
    }
  }

  // Pattern 2: BISA "Para Daniel MacLean" on the same line
  if (!destName) {
    const paraLine = lines.find((line) => /^para[:\s]+.+/i.test(line));
    if (paraLine) {
      const candidate = paraLine.replace(/^para[:\s]+/i, '').trim();
      if (
        /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.-]{3,}$/.test(candidate)
        && !/nit|ci\s*\/|banco|cuenta|n[°º]|numero/i.test(candidate)
        && !/^\d/.test(candidate)
      ) {
        destName = candidate;
      }
    }
  }
  // Pattern 3: BISA/QR "Para" on one line and name on the next
  if (!destName) {
    const paraIdx = lines.findIndex(l => /^para[:\s]*$/i.test(l));
    if (paraIdx >= 0 && paraIdx + 1 < lines.length) {
      const candidate = lines[paraIdx + 1];
      if (
        /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.]{4,}$/.test(candidate)
        && !/nit|ci\s*\/|banco|cuenta/i.test(candidate)
        && !/^\d/.test(candidate)
      ) {
        destName = candidate;
      }
    }
  }
  if (!destName) {
    const aNombreDestIdx = lines.findIndex((l, i) => {
      const prevLines = lines.slice(Math.max(0, i - 4), i).join(' ');
      return /a nombre de/i.test(l) && (/a la cuenta|destino/i.test(prevLines));
    });
    if (aNombreDestIdx >= 0 && aNombreDestIdx + 1 < lines.length) {
      destName = lines[aNombreDestIdx + 1];
    }
  }

  // Pattern 3.5: BNB "Nombre del destinatario" — handles three layouts produced
  // by Vision OCR for the same template:
  //   a) "Nombre del destinatario: VALUE"        (single-line label)
  //   b) "Nombre del destinatario:" / "VALUE"    (label on one line, value below)
  //   c) "Nombre del" / "destinatario:" / "VALUE" / "VALUE2"  (column-wrapped label)
  // In every case the value can also be wrapped across two lines.
  if (!destName) {
    const NAME_VALUE_RE = /^[A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ\s.-]{2,}$/;
    const NAME_STOP_RE = /banco|cuenta|monto|fecha|hora|referencia|originante|importe|suma|bancarizaci|nro\b|n[uú]mero|debit|acredit|destino|origen|tarjeta|caja|de\s+ahorro/i;

    let valueStartIdx = -1;
    let inlineCandidate = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const inlineMatch = line.match(/nombre\s+del\s+destinatario[:\s]*([^\n]*)$/i);
      if (inlineMatch) {
        const tail = inlineMatch[1].replace(/^[:\s.-]+/, '').trim();
        if (tail && /[A-ZÁÉÍÓÚÑa-záéíóúñ]/.test(tail) && !NAME_STOP_RE.test(tail)) {
          inlineCandidate = tail;
        }
        valueStartIdx = i + 1;
        break;
      }
      // Column-split label: "Nombre del" on one line, "destinatario..." on the next
      if (/^nombre\s+del\s*$/i.test(line) && i + 1 < lines.length && /^destinatario[:\s]*$/i.test(lines[i + 1])) {
        valueStartIdx = i + 2;
        break;
      }
    }

    if (valueStartIdx >= 0) {
      const collected = inlineCandidate ? [inlineCandidate] : [];
      for (let j = valueStartIdx; j < Math.min(valueStartIdx + 3, lines.length); j++) {
        const candidate = lines[j];
        if (!candidate) break;
        if (NAME_STOP_RE.test(candidate)) break;
        if (/^\d/.test(candidate)) break;
        if (!NAME_VALUE_RE.test(candidate)) break;
        collected.push(candidate.trim());
      }
      const merged = collected.join(' ').replace(/\s+/g, ' ').trim();
      if (merged) destName = merged;
    }
  }

  // Pattern 3.6: BNB "Se acreditó a la cuenta" destination — accept inline,
  // value-on-next-line, and column-split ("Se acreditó a la" / "cuenta:" / VALUE).
  if (!destAccount) {
    const flatNumber = (raw) => raw && !/[*xX•●·∙]/.test(raw) ? normalizeAccount(raw) : null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const inlineMatch = line.match(/se\s+acredit[oó]\s+a\s+la\s+cuenta[:\s]*([\d\s.*xX•●·∙-]{6,})/i);
      if (inlineMatch) {
        const account = flatNumber(inlineMatch[1]);
        if (account) destAccount = account;
        break;
      }
      if (/^se\s+acredit[oó]\s+a\s+la\s+cuenta[:\s]*$/i.test(line) && i + 1 < lines.length) {
        const account = flatNumber(lines[i + 1]);
        if (account) destAccount = account;
        break;
      }
      // Column-split: "Se acreditó a la" / "cuenta:" / VALUE
      if (/^se\s+acredit[oó]\s+a\s+la\s*$/i.test(line) && i + 2 < lines.length && /^cuenta[:\s]*$/i.test(lines[i + 1])) {
        const account = flatNumber(lines[i + 2]);
        if (account) destAccount = account;
        break;
      }
    }
  }

  // Pattern 4: explicit account labels like "N° de cuenta"
  if (!destAccount) {
    const accountMatch = fullText.match(
      /(?:n[°º]\s*de\s*cuenta|n[uú]mero\s*de\s*cuenta|cuenta\s*(?:de\s+)?destino|a\s+la\s+cuenta|se\s+acredit[oó]\s+a\s+la\s+cuenta)[:\s]*([\d\s.*xX•●·∙-]{6,})/i
    );
    if (accountMatch && !/[*xX•●·∙]/.test(accountMatch[1])) {
      destAccount = normalizeAccount(accountMatch[1]);
    }
  }

  // ─── Destination verification ───
  // Destination is valid when the extracted account is exact, or when a masked
  // account uniquely matches a whitelisted account and the recipient name matches.
  const matchedWhitelistedAccount = findWhitelistedAccountInText();
  const maskedWhitelistedAccount = findMaskedWhitelistedAccountInText();
  if (!destAccount && matchedWhitelistedAccount) {
    destAccount = matchedWhitelistedAccount;
  }
  const exactVerifiedAccount = VALID_DESTINATION_ACCOUNTS.has(destAccount || '')
    ? destAccount
    : matchedWhitelistedAccount;
  const destNameVerifiedFromField = isTrustedDestinationName(destName);
  // Free-text fallback: when the dest name field can't be cleanly extracted
  // (BNB column-wrap layouts in particular), look for the user identity anywhere
  // in the receipt — minus the originator's name, so common given names from
  // the sender don't leak in.
  const destNameVerifiedFromText = !destNameVerifiedFromField && findUserIdentityInText(fullText, name);
  const destNameVerified = destNameVerifiedFromField || destNameVerifiedFromText;
  const maskedAccountVerified = !!maskedWhitelistedAccount && destNameVerified;
  const destAccountVerified = !!exactVerifiedAccount || maskedAccountVerified;
  const destVerified = destAccountVerified;
  const destVerificationLevel = exactVerifiedAccount
    ? 'exact_account'
    : maskedAccountVerified
      ? destNameVerifiedFromField
        ? 'masked_account_with_name'
        : 'masked_account_with_text_name'
      : maskedWhitelistedAccount
        ? 'masked_account_untrusted_name'
        : destNameVerified
          ? 'name_only'
          : 'none';
  const destAccountForDisplay = exactVerifiedAccount
    || maskedWhitelistedAccount?.maskedAccount
    || destAccount
    || null;

  // ─── Reference / transaction code ───
  let reference = null;
  const refPatterns = [
    /(?:c[oó]digo\s*(?:de\s*)?transacci[oó]n|n[°º]\s*transacci?on|n[uú]mero\s*de\s*transacci[oó]n|referencia|nro\.?)[:\s]*(\d{6,})/i,
    /(?:n[uú]mero\s*de\s*comprobante)[:\s]*([^\n]+)/i,
    /bancarizaci[oó]n[:\s]*([A-Z0-9-]{6,})/i,
  ];
  for (const pat of refPatterns) {
    const m = fullText.match(pat);
    if (m) {
      reference = m[1].trim();
      break;
    }
  }
  // Fallback: very long number (16+ digits) that's not an account
  if (!reference) {
    const longNumMatch = fullText.match(/(\d{16,})/);
    if (longNumMatch) {
      reference = longNumMatch[1];
    }
  }

  // ─── Bank (origin bank, where the payment came from) ───
  let bank = null;
  // Check bank-specific keywords, prioritizing explicit labels
  const bankOriginSection = fullText.match(/(?:banco\s*origen|del\s*banco)[:\s]*([^\n]+)/i);
  if (bankOriginSection) {
    const b = bankOriginSection[1].trim();
    if (/mercantil|santa cruz/i.test(b)) bank = 'Mercantil Santa Cruz';
    else if (/cr[eé]dito|bcp/i.test(b)) bank = 'Banco de Crédito';
    else if (/bnb/i.test(b)) bank = 'BNB';
    else if (/uni[oó]n/i.test(b)) bank = 'Banco Unión';
    else if (/bisa/i.test(b)) bank = 'BISA';
    else if (/econom[ií]co/i.test(b)) bank = 'Banco Económico';
    else if (/ganadero/i.test(b)) bank = 'Banco Ganadero';
    else if (/solidario|sol\b/i.test(b)) bank = 'BancoSol';
    else bank = b;
  }
  // Fallback: detect from general text (header/logo text)
  if (!bank) {
    if (/Pago QR realizado[\s\S]*?banco\s*bisa|banco\s*bisa[\s\S]*?Pago QR/i.test(fullText)) bank = 'BISA';
    else if (/BancoSol|Banco Solidario/i.test(fullText)) bank = 'BancoSol';
    else if (/BANCO GANADERO/i.test(fullText)) bank = 'Banco Ganadero';
    else if (/Mercantil Santa Cruz/i.test(fullText)) bank = 'Mercantil Santa Cruz';
    else if (/cr[eé]dito.*bolivia|bcp/i.test(fullText)) bank = 'Banco de Crédito';
    else if (/bnb|nacional/i.test(fullText)) bank = 'BNB';
    else if (/uni[oó]n/i.test(fullText)) bank = 'Banco Unión';
    else if (/bisa/i.test(fullText)) bank = 'BISA';
    else if (/econom[ií]co/i.test(fullText)) bank = 'Banco Económico';
    else if (/ganadero/i.test(fullText)) bank = 'Banco Ganadero';
    else if (/sol/i.test(fullText)) bank = 'BancoSol';
  }

  console.log(`[ocr] Extracted — name: ${name}, amount: ${amount}, date: ${date}, ref: ${reference}, bank: ${bank}, dest: ${destName}, destAccount: ${destAccountForDisplay}, destVerified: ${destVerified}, destLevel: ${destVerificationLevel}`);

  return {
    name: name ? toTitleCase(name) : null,
    amount,
    date,
    reference,
    bank,
    destName: destName || null,
    destAccount: destAccountForDisplay,
    destAccountMasked: maskedWhitelistedAccount?.maskedAccount || null,
    destAccountVerified,
    destNameVerified,
    destVerified,
    destVerificationLevel,
    raw_text: fullText,
  };
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { extractReceiptData, parseBolivianReceipt };
