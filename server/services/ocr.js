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
  const VALID_DESTINATION_NAME_PATTERNS = [
    /daniel\s*mac\s*lean/i,
    /oscar\s*daniel\s*mac\s*lean\s*estrada/i,
    /mac\s*lean\s*estrada/i,
  ];

  function normalizeAccount(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function isValidDestinationName(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return VALID_DESTINATION_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  // ─── Amount (Bs, BOB) ───
  let amount = null;
  const amountPatterns = [
    /(?:Bs\.?|BOB)\s*([\d.,]+)/i,
    /Monto[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /Importe[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /Total[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
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
    const paraMatch = fullText.match(/Para[:\s]+([^\n]+)/i);
    if (paraMatch) destName = paraMatch[1].trim();
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

  // Pattern 3.5: BNB "Nombre del destinatario" on the same line or wrapped to the next one
  if (!destName) {
    const destNameLineIdx = lines.findIndex(l => /nombre\s+del\s+destinatario/i.test(l));
    if (destNameLineIdx >= 0) {
      const sameLineMatch = lines[destNameLineIdx].match(/nombre\s+del\s+destinatario[:\s]*([^\n]+)/i);
      if (sameLineMatch?.[1]?.trim()) {
        destName = sameLineMatch[1].trim();
        if (destNameLineIdx + 1 < lines.length) {
          const continuation = lines[destNameLineIdx + 1];
          if (
            /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.-]{3,}$/.test(continuation)
            && !/banco|cuenta|monto|fecha|hora|referencia/i.test(continuation)
            && !/^\d/.test(continuation)
          ) {
            destName = `${destName} ${continuation}`.replace(/\s+/g, ' ').trim();
          }
        }
      } else if (destNameLineIdx + 1 < lines.length) {
        const candidate = lines[destNameLineIdx + 1];
        if (
          /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.-]{3,}$/.test(candidate)
          && !/banco|cuenta|monto|fecha|hora|referencia/i.test(candidate)
          && !/^\d/.test(candidate)
        ) {
          destName = candidate.trim();
          if (destNameLineIdx + 2 < lines.length) {
            const continuation = lines[destNameLineIdx + 2];
            if (
              /^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.-]{3,}$/.test(continuation)
              && !/banco|cuenta|monto|fecha|hora|referencia/i.test(continuation)
              && !/^\d/.test(continuation)
            ) {
              destName = `${destName} ${continuation}`.replace(/\s+/g, ' ').trim();
            }
          }
        }
      }
    }
  }

  // Pattern 3.6: BNB "Se acreditó a la cuenta" destination line
  if (!destAccount) {
    const creditedLine = lines.find(l => /se\s+acredit[oó]\s+a\s+la\s+cuenta/i.test(l));
    if (creditedLine) {
      const accountMatch = creditedLine.match(/se\s+acredit[oó]\s+a\s+la\s+cuenta[:\s]*([\d\s.-]{6,})/i);
      if (accountMatch) {
        destAccount = normalizeAccount(accountMatch[1]);
      }
    }
  }

  // Pattern 4: explicit account labels like "N° de cuenta"
  if (!destAccount) {
    const accountMatch = fullText.match(
      /(?:n[°º]\s*de\s*cuenta|n[uú]mero\s*de\s*cuenta|cuenta\s*(?:de\s+)?destino|a\s+la\s+cuenta|se\s+acredit[oó]\s+a\s+la\s+cuenta)[:\s]*([\d\s.-]{6,})/i
    );
    if (accountMatch) {
      destAccount = normalizeAccount(accountMatch[1]);
    }
  }

  // ─── Destination verification ───
  // Destination is valid only when we extracted a whitelisted destination account
  // from a destination-specific context, or when the destination name clearly matches Daniel.
  const destAccountVerified = VALID_DESTINATION_ACCOUNTS.has(destAccount || '');
  const destNameVerified = isValidDestinationName(destName);
  const destVerified = destAccountVerified || destNameVerified;

  // ─── Reference / transaction code ───
  let reference = null;
  const refPatterns = [
    /(?:c[oó]digo\s*(?:de\s*)?transacci[oó]n|n[°º]\s*transacci?on|n[uú]mero\s*de\s*transacci[oó]n|referencia|nro\.?)[:\s]*(\d{6,})/i,
    /(?:n[uú]mero\s*de\s*comprobante)[:\s]*([^\n]+)/i,
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

  console.log(`[ocr] Extracted — name: ${name}, amount: ${amount}, date: ${date}, ref: ${reference}, bank: ${bank}, dest: ${destName}, destAccount: ${destAccount}, destVerified: ${destVerified}`);

  return {
    name: name ? toTitleCase(name) : null,
    amount,
    date,
    reference,
    bank,
    destName: destName || null,
    destAccount: destAccount || null,
    destVerified,
    raw_text: fullText,
  };
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { extractReceiptData, parseBolivianReceipt };
