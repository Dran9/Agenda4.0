function readBooleanEnv(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function isWhatsappReceiptOcrEnabled(env = process.env) {
  const explicit = readBooleanEnv(env.WHATSAPP_RECEIPT_OCR_ENABLED);
  if (explicit !== null) return explicit;
  return true;
}

module.exports = {
  isWhatsappReceiptOcrEnabled,
  readBooleanEnv,
};
