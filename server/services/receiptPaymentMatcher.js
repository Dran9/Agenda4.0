const DEFAULT_RECENT_QR_HOURS = 24;
const DEFAULT_NEAR_PAST_HOURS = 24;
const DEFAULT_NEAR_FUTURE_HOURS = 36;

function parseReceiptDateKey(value) {
  if (!value) return null;
  const trimmed = String(value).trim();

  const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;

  const yyyymmdd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;

  const ddmmyyyyDash = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyyDash) return `${ddmmyyyyDash[3]}-${ddmmyyyyDash[2]}-${ddmmyyyyDash[1]}`;

  const spanishMatch = trimmed.match(/^(\d{1,2})\s+de\s+(\w+),?\s*(\d{4})$/i);
  if (spanishMatch) {
    const months = {
      enero: '01',
      febrero: '02',
      marzo: '03',
      abril: '04',
      mayo: '05',
      junio: '06',
      julio: '07',
      agosto: '08',
      septiembre: '09',
      octubre: '10',
      noviembre: '11',
      diciembre: '12',
    };
    const month = months[spanishMatch[2].toLowerCase()];
    if (month) return `${spanishMatch[3]}-${month}-${String(spanishMatch[1]).padStart(2, '0')}`;
  }

  return null;
}

function getBoliviaDateKey(dateStr) {
  if (!dateStr) return null;
  const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function amountMatches(payment, amount) {
  const expectedFee = parseInt(payment?.fee, 10);
  const expectedAmount = parseInt(payment?.amount, 10);
  return expectedFee === amount || expectedAmount === amount;
}

function selectBestPendingPaymentForOcr(pendingPayments, ocrResult, {
  now = new Date(),
  recentQrHours = DEFAULT_RECENT_QR_HOURS,
  nearPastHours = DEFAULT_NEAR_PAST_HOURS,
  nearFutureHours = DEFAULT_NEAR_FUTURE_HOURS,
} = {}) {
  const rows = Array.isArray(pendingPayments) ? pendingPayments : [];
  if (rows.length === 0) return null;

  const ocrAmount = Number(ocrResult?.amount);
  const amountMatched = Number.isFinite(ocrAmount)
    ? rows.filter((payment) => amountMatches(payment, ocrAmount))
    : [];
  const candidates = amountMatched.length > 0 ? amountMatched : rows;
  const receiptDateKey = parseReceiptDateKey(ocrResult?.date);
  const nowDate = now instanceof Date ? now : new Date(now);
  const safeNow = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;
  const recentQrWindowMs = recentQrHours * 60 * 60 * 1000;
  const nearPastMs = nearPastHours * 60 * 60 * 1000;
  const nearFutureMs = nearFutureHours * 60 * 60 * 1000;

  return candidates
    .map((payment) => {
      const appointmentAt = payment.date_time instanceof Date
        ? payment.date_time
        : new Date(payment.date_time);
      const qrSentAt = payment.qr_sent_at
        ? payment.qr_sent_at instanceof Date
          ? payment.qr_sent_at
          : new Date(payment.qr_sent_at)
        : null;
      const appointmentDiffMs = Number.isNaN(appointmentAt.getTime())
        ? Number.POSITIVE_INFINITY
        : Math.abs(appointmentAt.getTime() - safeNow.getTime());
      const appointmentRelativeMs = Number.isNaN(appointmentAt.getTime())
        ? Number.POSITIVE_INFINITY
        : appointmentAt.getTime() - safeNow.getTime();
      const qrAgeMs = qrSentAt && !Number.isNaN(qrSentAt.getTime())
        ? safeNow.getTime() - qrSentAt.getTime()
        : Number.POSITIVE_INFINITY;
      const appointmentDateKey = getBoliviaDateKey(appointmentAt);

      return {
        payment,
        hasRecentQr: qrAgeMs >= 0 && qrAgeMs <= recentQrWindowMs,
        sameReceiptDate: !!receiptDateKey && appointmentDateKey === receiptDateKey,
        nearAppointment: appointmentRelativeMs >= -nearPastMs && appointmentRelativeMs <= nearFutureMs,
        statusPriority: payment.status === 'Pendiente' ? 0 : payment.status === 'Mismatch' ? 1 : 2,
        qrAgeMs,
        appointmentDiffMs,
      };
    })
    .sort((a, b) => {
      if (a.hasRecentQr !== b.hasRecentQr) return a.hasRecentQr ? -1 : 1;
      if (a.sameReceiptDate !== b.sameReceiptDate) return a.sameReceiptDate ? -1 : 1;
      if (a.nearAppointment !== b.nearAppointment) return a.nearAppointment ? -1 : 1;
      if (a.statusPriority !== b.statusPriority) return a.statusPriority - b.statusPriority;
      if (a.qrAgeMs !== b.qrAgeMs) return a.qrAgeMs - b.qrAgeMs;
      if (a.appointmentDiffMs !== b.appointmentDiffMs) return a.appointmentDiffMs - b.appointmentDiffMs;
      return Number(b.payment.id || 0) - Number(a.payment.id || 0);
    })[0]?.payment || null;
}

module.exports = {
  getBoliviaDateKey,
  parseReceiptDateKey,
  selectBestPendingPaymentForOcr,
};
