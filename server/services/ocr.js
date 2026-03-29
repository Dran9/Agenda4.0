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
 * Daniel's account: 30151182874355 at BCP (Oscar Daniel Mac Lean Estrada)
 * The "destAccount" field shows the recipient account so Daniel can verify
 * the payment was actually sent to HIS account and not someone else's.
 */
function parseBolivianReceipt(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = text;

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

  // BISA format: "De    VARGAS VILLARROEL DANIELA"
  const deMatch = fullText.match(/^De\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+)/m);
  if (deMatch && !/banco|credito|bolivia/i.test(deMatch[1])) {
    name = deMatch[1].trim();
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
      if (!/daniel\s*mac\s*lean|oscar\s*daniel/i.test(candidate)) {
        name = candidate;
      }
    }
  }

  // Fallback: all-caps name (skip Daniel's name + bank names)
  if (!name) {
    for (const line of lines) {
      if (/^[A-ZÁÉÍÓÚÑ]{2,}\s+[A-ZÁÉÍÓÚÑ]{2,}(\s+[A-ZÁÉÍÓÚÑ]+)*$/.test(line)) {
        if (/BANCO|CREDITO|BOLIVIA|MERCANTIL|SANTA\s*CRUZ|UNION|TRANSFERENCIA|EXITOSA|SOLIDARIO|GANADERO|PAGO\s*QR/i.test(line)) continue;
        if (/OSCAR\s*DANIEL|MAC\s*LEAN/i.test(line)) continue;
        name = line;
        break;
      }
    }
  }

  // ─── Destination verification ───
  // "Daniel Mac" (together or separated) ALWAYS identifies Daniel as recipient.
  // We look for it near destination keywords: destino, a nombre de, motivo, para.
  // This works across ALL Bolivian banks regardless of format.

  // Collect all text near destination-related keywords
  let destText = '';
  const destKeywords = /cuenta\s*(de\s+)?destino|a\s+nombre\s+de|beneficiario|destinatario|motivo|concepto|para\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (destKeywords.test(lines[i])) {
      // Grab this line + next 3 lines as context
      destText += ' ' + lines.slice(i, Math.min(i + 4, lines.length)).join(' ');
    }
  }

  // Check if "Daniel Mac" appears in dest context (handles: Daniel MacLean, Daniel Mac Lean, Oscar Daniel Mac Lean Estrada)
  const destVerified = /daniel\s+mac/i.test(destText);

  // Extract the dest name for display (what the receipt says)
  let destName = null;

  // Pattern 1: "Cuenta destino" / "Cuenta de destino" section — next lines
  const destIdx = lines.findIndex(l => /cuenta\s*(de\s+)?destino/i.test(l));
  if (destIdx >= 0) {
    for (let i = destIdx + 1; i < Math.min(destIdx + 5, lines.length); i++) {
      const line = lines[i];
      if (/cuenta\s*(de\s+)?origen|fecha|monto|n[uú]mero|nro|concepto/i.test(line)) break;
      if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s.]{4,}$/.test(line) && !/cuenta|destino|nit|ci\s*\/|banco|credito|solidario|ganadero|mercantil|bisa|bnb/i.test(line) && !/^\d/.test(line)) {
        destName = line;
        break;
      }
    }
  }

  // Pattern 2: BISA "Para Daniel MacLean" / BCP "A nombre de" in dest section
  if (!destName) {
    const paraMatch = fullText.match(/(?:Para|Motivo)[:\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ\s.]+)/i);
    if (paraMatch) destName = paraMatch[1].trim();
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
    if (longNumMatch && longNumMatch[1] !== destAccount) {
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

  console.log(`[ocr] Extracted — name: ${name}, amount: ${amount}, date: ${date}, ref: ${reference}, bank: ${bank}, dest: ${destName}, destVerified: ${destVerified}`);

  return {
    name: name ? toTitleCase(name) : null,
    amount,
    date,
    reference,
    bank,
    destName: destName || null,
    destVerified,
    raw_text: fullText,
  };
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { extractReceiptData, parseBolivianReceipt };
