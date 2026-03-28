// OCR Service — extracts payment data from receipt images
// Supports: Google Vision API (recommended) or Tesseract.js (fallback)

/**
 * Extract payment info from a receipt image buffer
 * Returns: { name, amount, date, reference, bank, raw_text }
 */
async function extractReceiptData(imageBuffer) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;

  if (apiKey) {
    return extractWithGoogleVision(imageBuffer, apiKey);
  }
  console.warn('[ocr] No GOOGLE_VISION_API_KEY set — OCR disabled');
  return null;
}

async function extractWithGoogleVision(imageBuffer, apiKey) {
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

/**
 * Parse Bolivian bank transfer receipt text
 * Handles: Mercantil Santa Cruz, BCP, BNB, Banco Union, etc.
 */
function parseBolivianReceipt(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = text;

  // Extract amount (Bs, BOB patterns)
  let amount = null;
  const amountPatterns = [
    /(?:Bs\.?|BOB)\s*([\d.,]+)/i,
    /Monto[:\s]*([\d.,]+)/i,
    /Importe[:\s]*([\d.,]+)/i,
    /Total[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
  ];
  for (const pat of amountPatterns) {
    const m = fullText.match(pat);
    if (m) {
      amount = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }

  // Extract date (DD/MM/YYYY or YYYY-MM-DD)
  let date = null;
  const datePatterns = [
    /(\d{2}\/\d{2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{2}-\d{2}-\d{4})/,
  ];
  for (const pat of datePatterns) {
    const m = fullText.match(pat);
    if (m) {
      date = m[1];
      break;
    }
  }

  // Extract sender name (Cuenta de origen section)
  let name = null;
  const originIdx = lines.findIndex(l => /cuenta de origen|ordenante|remitente/i.test(l));
  if (originIdx >= 0) {
    // Name is usually the line after "Cuenta de origen" that's all letters
    for (let i = originIdx + 1; i < Math.min(originIdx + 4, lines.length); i++) {
      const line = lines[i];
      // Skip account numbers and labels
      if (/^\d+$/.test(line)) continue;
      if (/cuenta|origen|nit|ci\s/i.test(line)) continue;
      if (/^[A-ZÁÉÍÓÚÑ\s]{4,}$/.test(line)) {
        name = line;
        break;
      }
    }
  }

  // Fallback: look for all-caps name patterns (common in Bolivian receipts)
  if (!name) {
    for (const line of lines) {
      if (/^[A-ZÁÉÍÓÚÑ]{2,}\s+[A-ZÁÉÍÓÚÑ]{2,}(\s+[A-ZÁÉÍÓÚÑ]+)*$/.test(line)) {
        // Skip known bank names and labels
        if (/BANCO|CREDITO|BOLIVIA|MERCANTIL|SANTA CRUZ|UNION|TRANSFERENCIA|EXITOSA/i.test(line)) continue;
        if (/OSCAR DANIEL/i.test(line)) continue; // Skip Daniel's own name (recipient)
        name = line;
        break;
      }
    }
  }

  // Extract reference/transaction code
  let reference = null;
  const refPatterns = [
    /(?:código|codigo|transacci[oó]n|referencia|nro)[:\s]*(\d{6,})/i,
    /(\d{16,})/,
  ];
  for (const pat of refPatterns) {
    const m = fullText.match(pat);
    if (m) {
      reference = m[1];
      break;
    }
  }

  // Detect bank
  let bank = null;
  if (/mercantil|santa cruz/i.test(fullText)) bank = 'Mercantil Santa Cruz';
  else if (/cr[eé]dito.*bolivia|bcp/i.test(fullText)) bank = 'Banco de Crédito';
  else if (/bnb|nacional/i.test(fullText)) bank = 'BNB';
  else if (/uni[oó]n/i.test(fullText)) bank = 'Banco Unión';
  else if (/bisa/i.test(fullText)) bank = 'BISA';
  else if (/econom[ií]co/i.test(fullText)) bank = 'Banco Económico';
  else if (/ganadero/i.test(fullText)) bank = 'Banco Ganadero';
  else if (/sol/i.test(fullText)) bank = 'Banco Sol';

  console.log(`[ocr] Extracted — name: ${name}, amount: ${amount}, date: ${date}, ref: ${reference}, bank: ${bank}`);

  return {
    name: name ? toTitleCase(name) : null,
    amount,
    date,
    reference,
    bank,
    raw_text: fullText,
  };
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { extractReceiptData, parseBolivianReceipt };
