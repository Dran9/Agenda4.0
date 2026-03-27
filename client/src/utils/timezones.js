// Timezone data and conversion utilities
// Server always works in America/La_Paz (UTC-4). This module handles client-side display conversion.

export const TIMEZONE_GROUPS = [
  {
    label: 'Latinoamérica',
    zones: [
      { label: 'Bolivia', tz: 'America/La_Paz', abbr: 'BOT', flag: '🇧🇴' },
      { label: 'Argentina', tz: 'America/Argentina/Buenos_Aires', abbr: 'ART', flag: '🇦🇷' },
      { label: 'Chile', tz: 'America/Santiago', abbr: 'CLT', flag: '🇨🇱' },
      { label: 'Perú', tz: 'America/Lima', abbr: 'PET', flag: '🇵🇪' },
      { label: 'Colombia', tz: 'America/Bogota', abbr: 'COT', flag: '🇨🇴' },
      { label: 'México', tz: 'America/Mexico_City', abbr: 'CST', flag: '🇲🇽' },
      { label: 'Paraguay', tz: 'America/Asuncion', abbr: 'PYT', flag: '🇵🇾' },
      { label: 'Uruguay', tz: 'America/Montevideo', abbr: 'UYT', flag: '🇺🇾' },
      { label: 'Brasil', tz: 'America/Sao_Paulo', abbr: 'BRT', flag: '🇧🇷' },
      { label: 'Ecuador', tz: 'America/Guayaquil', abbr: 'ECT', flag: '🇪🇨' },
      { label: 'Venezuela', tz: 'America/Caracas', abbr: 'VET', flag: '🇻🇪' },
      { label: 'Panamá', tz: 'America/Panama', abbr: 'EST', flag: '🇵🇦' },
      { label: 'Costa Rica', tz: 'America/Costa_Rica', abbr: 'CST', flag: '🇨🇷' },
      { label: 'Puerto Rico', tz: 'America/Puerto_Rico', abbr: 'AST', flag: '🇵🇷' },
      { label: 'Rep. Dominicana', tz: 'America/Santo_Domingo', abbr: 'AST', flag: '🇩🇴' },
    ],
  },
  {
    label: 'Norteamérica',
    zones: [
      { label: 'USA - Este (NY/Miami)', tz: 'America/New_York', abbr: 'ET', flag: '🇺🇸' },
      { label: 'USA - Centro (Texas/Chicago)', tz: 'America/Chicago', abbr: 'CT', flag: '🇺🇸' },
      { label: 'USA - Montaña (Denver)', tz: 'America/Denver', abbr: 'MT', flag: '🇺🇸' },
      { label: 'USA - Pacífico (LA/Seattle)', tz: 'America/Los_Angeles', abbr: 'PT', flag: '🇺🇸' },
      { label: 'Canadá - Este', tz: 'America/Toronto', abbr: 'ET', flag: '🇨🇦' },
      { label: 'Canadá - Centro', tz: 'America/Winnipeg', abbr: 'CT', flag: '🇨🇦' },
      { label: 'Canadá - Montaña', tz: 'America/Edmonton', abbr: 'MT', flag: '🇨🇦' },
      { label: 'Canadá - Pacífico', tz: 'America/Vancouver', abbr: 'PT', flag: '🇨🇦' },
    ],
  },
  {
    label: 'Europa',
    zones: [
      { label: 'España', tz: 'Europe/Madrid', abbr: 'CET', flag: '🇪🇸' },
      { label: 'Portugal', tz: 'Europe/Lisbon', abbr: 'WET', flag: '🇵🇹' },
      { label: 'Francia', tz: 'Europe/Paris', abbr: 'CET', flag: '🇫🇷' },
      { label: 'Italia', tz: 'Europe/Rome', abbr: 'CET', flag: '🇮🇹' },
      { label: 'Alemania', tz: 'Europe/Berlin', abbr: 'CET', flag: '🇩🇪' },
      { label: 'Suiza', tz: 'Europe/Zurich', abbr: 'CET', flag: '🇨🇭' },
      { label: 'Reino Unido', tz: 'Europe/London', abbr: 'GMT', flag: '🇬🇧' },
      { label: 'Austria', tz: 'Europe/Vienna', abbr: 'CET', flag: '🇦🇹' },
      { label: 'Países Bajos', tz: 'Europe/Amsterdam', abbr: 'CET', flag: '🇳🇱' },
      { label: 'Bélgica', tz: 'Europe/Brussels', abbr: 'CET', flag: '🇧🇪' },
      { label: 'Suecia', tz: 'Europe/Stockholm', abbr: 'CET', flag: '🇸🇪' },
      { label: 'Noruega', tz: 'Europe/Oslo', abbr: 'CET', flag: '🇳🇴' },
      { label: 'Dinamarca', tz: 'Europe/Copenhagen', abbr: 'CET', flag: '🇩🇰' },
      { label: 'Finlandia', tz: 'Europe/Helsinki', abbr: 'EET', flag: '🇫🇮' },
      { label: 'Polonia', tz: 'Europe/Warsaw', abbr: 'CET', flag: '🇵🇱' },
      { label: 'Irlanda', tz: 'Europe/Dublin', abbr: 'GMT', flag: '🇮🇪' },
      { label: 'Serbia', tz: 'Europe/Belgrade', abbr: 'CET', flag: '🇷🇸' },
    ],
  },
  {
    label: 'Otras regiones',
    zones: [
      { label: 'Asia / Oceanía (Tokyo)', tz: 'Asia/Tokyo', abbr: 'JST', flag: '🌏' },
      { label: 'África / Medio Este (Cairo)', tz: 'Africa/Cairo', abbr: 'EET', flag: '🌍' },
    ],
  },
];

export const ALL_TIMEZONES = TIMEZONE_GROUPS.flatMap(g => g.zones);
export const DEFAULT_TZ = ALL_TIMEZONES.find(z => z.tz === 'America/La_Paz');

export function convertLaPazTimeToTz(timeStr, dateStr, targetTz) {
  if (targetTz === 'America/La_Paz') return timeStr;
  const utcDate = new Date(`${dateStr}T${timeStr}:00-04:00`);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: targetTz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(utcDate);
}

export function getCurrentTimeInTz(tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

export function detectTimezoneFromIP(ipData) {
  if (!ipData) return DEFAULT_TZ;
  if (ipData.timezone) {
    const match = ALL_TIMEZONES.find(z => z.tz === ipData.timezone);
    if (match) return match;
  }
  const countryMap = {
    BO: 'America/La_Paz', AR: 'America/Argentina/Buenos_Aires',
    CL: 'America/Santiago', PE: 'America/Lima', CO: 'America/Bogota',
    MX: 'America/Mexico_City', PY: 'America/Asuncion', UY: 'America/Montevideo',
    BR: 'America/Sao_Paulo', EC: 'America/Guayaquil', VE: 'America/Caracas',
    PA: 'America/Panama', CR: 'America/Costa_Rica', PR: 'America/Puerto_Rico',
    DO: 'America/Santo_Domingo', ES: 'Europe/Madrid', PT: 'Europe/Lisbon',
    FR: 'Europe/Paris', IT: 'Europe/Rome', DE: 'Europe/Berlin',
    CH: 'Europe/Zurich', GB: 'Europe/London', AT: 'Europe/Vienna',
    NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', SE: 'Europe/Stockholm',
    NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki',
    PL: 'Europe/Warsaw', IE: 'Europe/Dublin', RS: 'Europe/Belgrade',
    US: 'America/New_York', CA: 'America/Toronto',
  };
  if (ipData.country_code && countryMap[ipData.country_code]) {
    const tz = countryMap[ipData.country_code];
    return ALL_TIMEZONES.find(z => z.tz === tz) || DEFAULT_TZ;
  }
  return DEFAULT_TZ;
}
