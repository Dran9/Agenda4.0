# Proyecto: Agenda 3.0 — Sistema de Agendamiento para Terapeutas

## Qué es
Plataforma de agendamiento de sesiones de psicoterapia con admin premium, WhatsApp integrado, contabilidad y analytics. Reemplaza a whatsapp-reminder-engine (repo anterior). Diseñado para vender como producto a otros terapeutas.

## Dueño
Daniel MacLean — psicólogo en Cochabamba, Bolivia
- Teléfono personal: 59172034151
- WhatsApp Business: 59169650802

## Stack
- **Server:** Express + MySQL (Hostinger) — `server/`
- **Client:** React 18 + Vite + Tailwind + shadcn/ui — `client/`
- **Integraciones:** Google Calendar, Google Sheets, WhatsApp Cloud API (Meta), Google Vision OCR
- **Deploy:** Hostinger (Business Web Hosting, Node.js, git push deploy)

## Documento de especificaciones
**LEE `SPECS.md` ANTES DE HACER CUALQUIER COSA.** Contiene:
- Arquitectura completa del proyecto
- Flujos de booking (cliente nuevo, antiguo, reagendamiento)
- Admin ultra-pro: 9 secciones detalladas (Dashboard, CRM, Citas, Analytics, Config, WhatsApp inbox, Contabilidad, OCR, Branding)
- Campos de base de datos, status automáticos, métricas
- Stack técnico (shadcn/ui, Recharts, date-fns-tz)

## Repo anterior (referencia)
`/Users/dran/Documents/Claude Code/whatsapp-reminder-engine/`
- **Copiar tal cual:** `server/services/calendar.js`, `server/services/whatsapp.js`, `client/src/utils/timezones.js`, `client/src/components/Calendar.jsx`
- **Copiar lógica, reestructurar:** `createBooking()`, `createClient()`, slot calculation, reminder
- **NO copiar:** BookingFlow.jsx (reescribir split en 6 componentes), admin (reescribir con shadcn/ui), `src/` (legacy Render, eliminar)

## Reglas críticas (NO ignorar)

### Hostinger
- `dns.setDefaultResultOrder('ipv4first')` DEBE ser la primera línea de `server/db.js`
- `client/dist/` se commitea al repo — Hostinger no ejecuta builds
- Después de cambios en client/, correr `npm run build` y commitear `client/dist/`
- `express.static()` con `fs.existsSync()` guard obligatorio
- **Nueva MySQL** — base de datos nueva en nuevo site de Hostinger (no la misma del repo anterior)

### WhatsApp webhooks
- Después de configurar Callback URL en Meta, SIEMPRE ejecutar:
  ```bash
  curl -X POST "https://graph.facebook.com/v18.0/{WABA_ID}/subscribed_apps" \
    -H "Authorization: Bearer {WA_TOKEN}"
  ```
  Sin esto, los mensajes reales NO llegan (solo los tests de Meta).
- WABA ID: `1400277624968330`
- Phone Number ID: `887756534426165`

### Textos en español
- NUNCA usar unicode escapes (\u00f3, \u00e9, etc.) en archivos JSX
- Siempre escribir los caracteres directamente: ó, é, í, á, ú, ñ, ¿, ¡

### Buttons y state en React
- SIEMPRE poner `type="button"` en todo `<button>` que NO sea submit de form
- BookingFlow usa `useReducer` (NO múltiples useState mezclados)
- Cada screen del booking en su propio componente (`components/booking/`)
- Reducer en hook separado (`hooks/useBookingReducer.js`)

### Timezone
- Server: usar `date-fns-tz` con `America/La_Paz`. NUNCA `toLocaleString()` para parsear timezone
- Client: `utils/timezones.js` con `Intl.DateTimeFormat` (ya probado)
- Bolivia no tiene DST — simplifica todo
- `toISOString()` devuelve UTC. Para mostrar horas en Bolivia: `format(utcToZonedTime(date, 'America/La_Paz'), 'HH:mm')`

### Arquitectura
- **Rutas thin:** routes/ solo validan request → llaman servicio → responden HTTP
- **Servicios con lógica:** services/ contiene toda la lógica de negocio
- **Transacciones:** toda operación GCal + DB debe ser atómica (transaction wrapper en db.js)
- **QR en MySQL BLOB:** NUNCA en disco (desaparecen en deploy)
- **Soft delete:** clientes tienen `deleted_at`, nunca DELETE real
- **Multi-tenant ready:** tabla `tenants`, FK `tenant_id` en todas las tablas principales

### Daniel (preferencias de trabajo)
- NO usar emojis en la UI (excepto banderas en selector de país)
- NO usar AskUserQuestion (las tarjetas con opciones lo vuelven loco)
- Responder a TODAS las preguntas del usuario, no cherry-pick
- Fonts: +2pt respecto al diseño base. No bajarlos
- Mobile: padding 12px en móvil, 24px en >=520px

## Estructura del proyecto
```
agenda3.0/
├── server/
│   ├── index.js              (Express setup + route mounting)
│   ├── db.js                 (MySQL pool + schema + transaction helper)
│   ├── routes/
│   │   ├── booking.js        (thin: validate → service → respond)
│   │   ├── slots.js
│   │   ├── config.js
│   │   ├── clients.js
│   │   ├── appointments.js
│   │   ├── auth.js
│   │   └── webhook.js        (WhatsApp button responses)
│   ├── services/
│   │   ├── booking.js        (createBooking, reschedule, phone check)
│   │   ├── slots.js          (slot availability calculation)
│   │   ├── calendar.js       (GCal wrapper)
│   │   ├── whatsapp.js       (WhatsApp Cloud API)
│   │   ├── reminder.js       (cron + send logic)
│   │   ├── storage.js        (MySQL BLOB for files)
│   │   ├── sheets.js         (Google Sheets sync)
│   │   └── ocr.js            (Google Vision OCR)
│   ├── middleware/
│   │   ├── auth.js           (JWT verification)
│   │   └── validate.js       (zod schemas)
│   └── cron/
│       └── scheduler.js      (reminder scheduling)
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── pages/
│   │   │   ├── BookingFlow.jsx       (~200 líneas, orquestador)
│   │   │   └── Admin/
│   │   │       ├── Dashboard.jsx
│   │   │       ├── Analytics.jsx
│   │   │       ├── Config.jsx
│   │   │       ├── Clients.jsx
│   │   │       ├── Appointments.jsx
│   │   │       ├── WhatsApp.jsx
│   │   │       └── Finance.jsx
│   │   ├── components/
│   │   │   ├── booking/
│   │   │   │   ├── CalendarScreen.jsx
│   │   │   │   ├── PhoneScreen.jsx
│   │   │   │   ├── ConfirmScreen.jsx
│   │   │   │   ├── SuccessScreen.jsx
│   │   │   │   ├── ExistingApptScreen.jsx
│   │   │   │   └── RescheduleConfirm.jsx
│   │   │   ├── ui/               (shadcn/ui)
│   │   │   ├── Calendar.jsx
│   │   │   ├── AdminLayout.jsx
│   │   │   └── Logo.jsx
│   │   ├── hooks/
│   │   │   ├── useBookingReducer.js
│   │   │   ├── useSlots.js
│   │   │   └── useConfig.js
│   │   └── utils/
│   │       ├── timezones.js
│   │       ├── api.js
│   │       └── dates.js
│   ├── vite.config.js
│   └── package.json
├── CLAUDE.md                 (este archivo)
├── SPECS.md                  (especificaciones completas del producto)
├── .env.example
└── package.json

## Flujo de booking (resumen)
```
Cliente NUEVO:
  Calendario → Slot → Teléfono → Confirmar → needs_onboarding → Datos → Éxito

Cliente ANTIGUO sin cita:
  Calendario → Slot → Teléfono → Confirmar → Éxito

Cliente ANTIGUO con cita (reagendar):
  Calendario → Slot → Teléfono → "Ya tienes cita X, elegiste Y" → Reagendar/Conservar → Éxito

Recordatorio (18:40 diario):
  GCal mañana → match DB → WhatsApp template → [Confirmo/Reagendar/Hablar]
```

## APIs externas
- **Google Calendar:** OAuth2 — list events, create event, delete event, update summary
- **Google Sheets:** OAuth2 (mismas credenciales) — sync tablas clave periódicamente
- **Google Vision:** API key — OCR de comprobantes de pago (free tier: 1,000/mes)
- **WhatsApp Cloud API:** template `recordatorionovum26` con header imagen + body (nombre, día, hora) + 3 quick_reply buttons
- **ipapi.co:** detección de timezone por IP (gratis)

## Variables de entorno
Ver `.env.example` para la lista completa. Se configuran en hPanel de Hostinger.
