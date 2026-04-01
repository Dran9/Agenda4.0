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
- `client/dist/` se commitea al repo con hashes en filenames (Vite default)
- **NUNCA poner `maxAge` ni `immutable` en `express.static()` para assets** — LiteSpeed cachea a nivel proxy y no lo suelta
- `express.static()` para assets usa `maxAge: 0, etag: false`
- **El script `build` en package.json raíz es un no-op** — Hostinger ejecuta `npm run build` en cada deploy, y si es un build real sobreescribe nuestro dist con código fuente desactualizado. Dejarlo como no-op.
- Después de cambios en client/, correr `cd client && npm run build` y commitear `client/dist/`
- `express.static()` con `fs.existsSync()` guard obligatorio
- **Nueva MySQL** — base de datos nueva en nuevo site de Hostinger (no la misma del repo anterior)
- **SPA fallback usa `fs.readFileSync()`** (no `res.sendFile()`) para evitar cache de Express

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
- **Hard delete:** clientes se borran con DELETE CASCADE (payments, appointments, wa_conversations). Soft delete causaba UNIQUE constraint violations y ghost records.
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

## URLs
- **Producción:** https://plum-rhinoceros-787093.hostingersite.com/
- **API health:** https://plum-rhinoceros-787093.hostingersite.com/api/health
- **Dev mode:** https://plum-rhinoceros-787093.hostingersite.com/?devmode=1
- **Repo anterior:** https://skyblue-rabbit-531241.hostingersite.com/

## Variables de entorno
Ver `.env.example` para la lista completa. Se configuran en hPanel de Hostinger.

## Estado actual (2026-03-29)

### Funcionando
- **Server Express** corriendo en Hostinger (plum-rhinoceros-787093.hostingersite.com), auto-deploy desde GitHub
- **10 tablas MySQL** en `u926460478_agenda30` (localhost en Hostinger, srv2023.hstgr.io remoto)
- **Google Calendar OAuth** funcionando — slots, eventos, recordatorios
- **WhatsApp Cloud API** — recordatorios diarios 18:40 BOT, auto-reply a botones CONFIRM/REAGEN/DANIEL
- **OCR de comprobantes** — Google Vision API reconoce montos, referencias, bancos bolivianos. **Soporta imágenes Y PDFs** (via `files:annotate` endpoint)
- **Auto-match pagos por teléfono** — imagen/PDF WhatsApp → OCR → match con pago pendiente → confirma automáticamente
- **QR de pago automático** — al confirmar asistencia, envía QR según arancel del cliente
- **Payment badges** — verde "Pagado" / rojo "Pendiente" en Appointments y Dashboard
- **Hard delete de clientes** — CASCADE por payments, appointments, wa_conversations
- **Rate limiting** solo en /api/book, /api/reschedule, /api/client (NO en admin routes)
- **Calendar prefetch por mes** — al cargar y al navegar meses, prefetchea TODOS los días disponibles del mes

### Deploy — Lecciones aprendidas (CRÍTICO)
- **Hostinger ejecuta `npm run build` en cada deploy** → el script build en package.json raíz DEBE ser no-op
- **NUNCA usar `maxAge` ni `immutable` en express.static para assets** → LiteSpeed cachea a nivel proxy y no lo suelta
- **Filenames con hash** (Vite default) son necesarios para invalidar cache de LiteSpeed en cada deploy
- **`index.html` se sirve con `fs.readFileSync()`** (no sendFile) para evitar cache de Express
- **Flujo correcto**: cambiar código → `cd client && npm run build` → commitear `client/dist/` → push → Hostinger deploys

### Timezone — Lecciones aprendidas (CRÍTICO)
- **`server/db.js` tiene `timezone: '-04:00'`** — NUNCA quitar. Sin esto, mysql2 interpreta DATETIME como UTC y todas las horas se muestran -4h
- **NUNCA hacer doble conversión timezone**: `new Date(date.toLocaleString('en-US', { timeZone: 'America/La_Paz' }))` seguido de `.toLocaleTimeString({ timeZone: 'America/La_Paz' })` resta 4h DOS VECES
- **Para formatear hora Bolivia**: usar `date.toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })` directamente sobre un Date con timezone correcto — UNA sola conversión
- **`window_days` = días CALENDARIO, no weekdays** — simple: `maxDate = today + windowDays`
- **Posible bug pendiente**: `NOW()` en queries SQL devuelve hora del server MySQL (probablemente UTC), pero `date_time` en DB es Bolivia. Diferencia de 4h en comparaciones `date_time > NOW()`. No afecta en la práctica excepto citas cerca de medianoche.

### Endpoints de debug (TEMPORALES — borrar cuando todo esté estable)
- `GET /api/debug-env` — longitud y parciales de credenciales
- `GET /api/debug-dist` — lista archivos en client/dist en Hostinger
- `GET /api/admin/test-ocr` — verifica GOOGLE_VISION_API_KEY
- `GET /api/admin/test-reminder?date=today|tomorrow&force=1` — trigger manual de recordatorios

### Cambios sesión 2026-03-29 (tarde/noche)
- **Appointments page overhaul**: Status y Pago son dropdowns inline con colores, columna "Registro" (created_at), renombrado "Fecha" → "Fecha agendada", eliminada columna "Acción"
- **Reschedule DELETE**: Al reagendar, la cita vieja se BORRA del registro. La nueva queda con status "Reagendada". Pagos confirmados se migran automáticamente
- **URL magic codes**: `?t=phone` (pre-fill teléfono), `?r=phone` (modo reagendar + banner + auto-submit), `?fee=amount` (override de arancel silencioso)
- **OCR validación 3 criterios**: Destinatario verificado (Daniel Mac), monto coincide con arancel, fecha no muy vieja → "Confirmado". Si falla → "Mismatch" (naranja)
- **Multi-bank OCR**: Parser mejorado para Mercantil Santa Cruz, BISA, BancoSol, Banco Ganadero, BCP
- **OCR en WhatsApp inbox**: Datos extraídos del comprobante visibles en mensajes (remitente, monto, fecha, destinatario, banco, ref)
- **Reminder toggle**: Botón on/off en Config para activar/desactivar recordatorios + time picker
- **Window days libre**: Input numérico libre (antes era dropdown con valores fijos)
- **Fix "Copiar a" en Config**: La función de copiar horarios a otros días no aplicaba cambios correctamente. Fix: state update directo + toast de confirmación + limpiar checkboxes al cambiar de día

### Cambios sesión 2026-03-29 (madrugada)
- **Timezone mysql2**: `timezone: '-04:00'` en db.js — fix raíz para horas correctas en admin y WhatsApp
- **WhatsApp reminder hora**: eliminada doble conversión timezone, usa Intl.DateTimeFormat directo
- **Calendar window_days**: revertido a días calendario (no weekdays) en server, Calendar.jsx, CalendarScreen.jsx
- **Prefetch completo por mes**: BookingFlow prefetchea todos los días del mes + onMonthChange handler
- **Config dropdown**: extendido hasta 50 días
- **OCR de PDFs**: `ocr.js` usa `files:annotate` de Vision API para PDFs nativamente

### Cambios sesión 2026-03-28 tarde
- **Calendario visual**: sin borde, fuentes +2pt, #A4A4A6 para headers y días no disponibles, #000 fw900 para días con slots
- **Phone input unificado**: eliminado dropdown de país en Screen 2, prefijo derivado de timezone
- **CONFIRM_NOW WhatsApp**: texto estático sin variables de fecha, delay 60s antes de enviar QR
- **Blue checkmarks**: mensajes se marcan como leídos inmediatamente
- **Finance page**: conectada con datos reales, goal mensual, tabla de pagos con OCR
- **Dashboard KPIs**: conectados a datos reales de analytics

### Pendiente — Bugs activos
- **Recordatorios no envían si no hay registro en DB** — El reminder encuentra eventos en GCal pero la tabla `appointments` tiene 0 registros. Si las citas se crearon directo en GCal (no por la app), el reminder no matchea. Fix: enviar reminder basado solo en datos de GCal cuando no hay match en DB
- **NOW() en SQL vs Bolivia time** — potencial bug de 4h en queries con `date_time > NOW()`. Fix: SET time_zone = '-04:00' en cada conexión mysql2
- **Variable `destAccount` sin definir en ocr.js** — referencia huérfana en fallback de referencia, no crashea pero lógica incorrecta

### Pendiente — Verificar en producción
- **OCR validación end-to-end** — agendar → confirmar asistencia → enviar comprobante → OCR → match → Confirmado o Mismatch
- **URL magic codes** — `?t=`, `?r=`, `?fee=` (puede ser cache de LiteSpeed)

### Pendiente — Features por implementar
- **Auto-complete de citas** — cron para marcar "Completada" ~1h después de la hora de la cita
- **No-show via WhatsApp** — resumen al final del día preguntando a Daniel si todos asistieron
- **REAGEN_NOW auto-reply** — enviar link de reagendamiento (`?r=phone`) cuando cliente presiona "Reagendar" en WhatsApp
- **DANIEL_NOW auto-reply** — notificar en dashboard + auto-reply cuando presiona "Hablar con Daniel"
- **Status automáticos de clientes** — Nuevo/Activo/En pausa/Inactivo/Recurrente calculados por reglas
- **Métricas por cliente** — total sesiones, tasa asistencia, total pagado, deuda
- **Vista detalle de cliente** — panel slide-in con historial de citas y pagos
- **Nota en citas** — agregar notas por cita desde admin
- **Reagendar desde admin** — botón en Citas para cambiar horario directamente
- **Analytics page** — gráficos, heatmap horarios, fuente de clientes, tendencias
- **WhatsApp inbox mejorado** — panel dual, campo de mensaje manual, mensajes rápidos, broadcast
- **Finance avanzado** — deducciones, ingreso neto, deuda/obligaciones, semanas lectivas
- **OCR manual desde admin** — subir comprobante desde perfil del cliente
- **Branding** — logo, colores, slug URL por terapeuta (multi-tenant visual)
- **Google Sheets sync periódico** — sync automático cada hora (pagos, resumen semanal)
- **Diseño visual** — branding/colores/tipografía de la app
- **Limpiar endpoints de debug** cuando todo esté estable

### Numeración de Steps (referencia para hablar con Daniel)
```
Step 1       — Calendario + slots (o Step 1 reschedule si viene de reagendar)
Step 2       — Input teléfono
Step 3       — Onboarding (cliente nuevo: nombre, edad, ciudad, fuente)
Step 4       — Ya tiene cita (muestra actual + elegida, botones Reagendar/Conservar)
Step 4b      — Confirmar reagendamiento (rojo: se cancela, verde: nueva)
Step 5a      — Éxito primera cita (cliente nuevo)
Step 5b      — Éxito cliente que retorna
Step 5c      — Éxito reagendamiento
```
