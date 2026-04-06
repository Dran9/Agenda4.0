# Proyecto: Agenda Daniel MacLean — Sistema de Agendamiento para Terapeutas

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
- **Producción:** https://agenda.danielmaclean.com/
- **API health:** https://agenda.danielmaclean.com/api/health
- **Dev mode:** https://agenda.danielmaclean.com/?devmode=1
- **Repo anterior:** https://skyblue-rabbit-531241.hostingersite.com/

## Variables de entorno
Ver `.env.example` para la lista completa. Se configuran en hPanel de Hostinger.

## Estado Google OAuth (2026-04-04)
- Proyecto Google Cloud operativo nuevo: `agenda40`
- Cliente OAuth operativo: `cliente-agenda40`
- APIs activas: Google Calendar, Google Sheets, Google People
- La app OAuth está en modo `Producción`, no en `Prueba`
- El backend sigue usando el cliente reutilizable actual en `server/services/calendar.js`
- `server/services/sheets.js` y `server/services/contacts.js` reutilizan ese mismo OAuth client
- No se creó un segundo módulo `src/lib/googleAuth.js` porque el repo ya tenía esa función cubierta
- `generate-token.js` fue solo un script de un uso para obtener el refresh token y no debe quedarse como herramienta viva del repo
- El repo debe permanecer en CommonJS para backend; no dejar `"type": "module"` en el `package.json` raíz
- Si vuelve a aparecer `invalid_grant`, revisar primero:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN`
  - estado `Producción` del OAuth consent screen
  - que Hostinger esté usando las credenciales nuevas

## Estado recurrentes (2026-04-06)
- Ya existe soporte de `recurring_schedules` con materialización lazy:
  la app guarda el patrón semanal y solo crea `appointments` cuando hay interacción real
- Esquema nuevo:
  `recurring_schedules` + `appointments.source_schedule_id`
- API admin nueva:
  `GET/POST/PUT /api/recurring`
  `PUT /api/recurring/:id/pause`
  `PUT /api/recurring/:id/resume`
  `PUT /api/recurring/:id/end`
  `GET /api/recurring/upcoming`
  `POST /api/recurring/:id/materialize`
- Regla crítica:
  si la ocurrencia ya viene de una serie recurrente en Google Calendar, al materializar NO se crea otro evento en GCal
  se reutiliza el `event.id` de esa instancia para evitar duplicados
- Solo se crea un evento individual nuevo en GCal cuando el schedule fue manual y no tiene `gcal_recurring_event_id`
- Recordatorios:
  `server/services/reminder.js` ahora intenta matchear recurrencia antes del fallback por teléfono
  así las sesiones recurrentes quedan materializadas antes de enviar WhatsApp
- Sync diario:
  `server/cron/scheduler.js` ahora corre un sync de recurrencia a las 06:00 BOT
  lee 14 días de GCal y puede auto-crear schedules faltantes por `recurringEventId`
- Dashboard/Clientes/Analytics/Citas:
  ya muestran recurrencia activa, sesiones virtuales del día, KPI recurrentes y el ícono de repeat en citas materializadas
- Voz:
  el shortcut/admin voice ya puede activar, consultar, pausar, reactivar y desactivar recurrencias
  frases soportadas de forma directa:
  `Fulano pasa a modo recurrencia`
  `Fulano pasa a recurrencia`
  `Fulano está en recurrencia`
- Regla de activación por voz:
  si el cliente tiene una próxima cita individual futura, la activación por voz toma esa cita como fuente
  y convierte ese evento de Google Calendar en una serie semanal
  si no hay cita fuente convertible, crea la serie semanal nueva en GCal y deja la recurrencia activa en la app
- Seguridad operativa de voz:
  si la app activa la recurrencia pero Google Calendar no confirma la serie, la respuesta de voz lo avisa explícitamente
- Decisión operativa importante:
  pausar/finalizar en la app NO elimina automáticamente la serie maestra en Google Calendar
  la app deja de materializar y recordar esa recurrencia, pero no hace una acción destructiva en GCal por detrás
- Sync desde Google Calendar:
  si conviertes la sesión a repetitiva directamente en GCal, el cron `recurringSync` la puede leer y crear el `recurring_schedule`
  el sync no es realtime; corre a las 06:00 BOT y revisa los próximos 14 días
- Riesgo conocido:
  la idempotencia de materialización se protege con advisory lock + verificación previa
  todavía no hay un `UNIQUE KEY` duro para ocurrencias recurrentes en la tabla `appointments`

## Regla de documentación operativa
- Al cerrar una tarea importante, actualizar SIEMPRE ambos archivos:
  - `docs/HANDOFF.md`
  - `CLAUDE.md`
- `HANDOFF.md` es el snapshot corto para retomar trabajo rápido.
- `CLAUDE.md` debe contener también el contexto operativo acumulado importante, no solo reglas generales.
- Si la tarea toca la app de voz como línea de producto, mantener también `docs/VOICE-APP-REPORT.md`.

## Estado operativo actual (2026-04-03)

### Branding y dominio
- El dominio público canónico es `https://agenda.danielmaclean.com/`
- El nombre visible de la app debe ser `Agenda Daniel MacLean`
- No deben quedar referencias operativas al dominio viejo `plum-rhinoceros-787093.hostingersite.com`

### Regla canónica de teléfonos
- Guardar y comparar teléfonos como solo dígitos
- Siempre con código de país
- Sin `+`
- Sin espacios, guiones ni separadores
- Esta normalización ya aplica en clientes, booking, reagendamiento, pagos, webhook y recordatorios
- No se hizo migración agresiva sobre datos viejos

### Estado OCR / pagos
- La validación de destinatario depende solo de cuentas bancarias whitelisteadas
- Los nombres del destinatario son informativos; no definen validez
- La cuenta destino debe compararse tras limpiar espacios y guiones
- En BNB, hay que priorizar `Nombre del destinatario` y `Se acreditó a la cuenta`
- En BNB, `La suma de Bs.:` debe reconocerse como monto
- `Bancarización:` puede usarse como referencia cuando no hay otro código usable
- La fecha del comprobante se compara contra el último contexto de pago enviado por WhatsApp, no contra la fecha de la cita
- El inbox de WhatsApp muestra una caja temporal de `OCR bruto` para debug
- Los mensajes de mismatch deben listar motivos en bullets, no en una sola línea con `/`

### Estado de citas / admin
- La barra de citas ya distingue claramente `Desde` y `Hasta`
- La lista de citas soporta ordenamiento por fecha, nombre, fecha de registro y status
- `client/dist` sigue versionado y debe mantenerse sincronizado para que no falle GitHub `Frontend Guard`

### Estado del módulo de voz
- El control por voz vive aislado del flujo público y del flujo cliente
- Endpoint actual: `POST /api/voice/shortcut`
- Auth por token secreto `VOICE_ADMIN_TOKEN`
- Soporta audio y texto
- Cada comando queda auditado en `voice_commands_log`
- Ya existe una subapp privada principal en `https://agenda.danielmaclean.com/voice`
- Existe un informe operativo específico para esta línea de producto en `docs/VOICE-APP-REPORT.md`
- `/voice` usa la sesión normal de admin por JWT; no debe exponer `VOICE_ADMIN_TOKEN` en cliente
- `/voice` está pensada como la UX principal de voz: audio-first, texto fallback, respuesta textual siempre visible, respuesta hablada opcional e historial reciente
- El endpoint web privado para esa subapp es `POST /api/voice/admin-command`
- El TTS privado para esa subapp ahora sale por `POST /api/voice/tts` y debe usar Cartesia server-side si `CARTESIA_API_KEY` está configurado
- El historial para esa subapp sale por `GET /api/voice/history`
- `voice_commands_log` ahora también guarda `result_data`, para persistir aclaraciones, opciones de cliente y acciones pendientes entre turnos
- La arquitectura de comprensión ya no debe ser solo `intent -> switch`:
  heurísticas directas primero, luego resolución de follow-up con contexto reciente, luego planner con tools de solo lectura, y recién después ejecución
- Consultas ya soportadas:
  - agenda hoy/mañana/fecha
  - pagos pendientes
  - monto pendiente
  - sesiones para llegar a meta
  - búsqueda de cliente
  - próximas citas de cliente
  - si se envió recordatorio
  - si confirmó
  - reagendados
  - nuevos por mes
  - no confirmados mañana
  - confirmados hoy
  - citas de la semana
- Acciones ya soportadas:
  - crear cita para cliente existente con fecha y hora explícitas
  - activar recordatorios
  - desactivar recordatorios
  - mandar recordatorios para hoy
  - mandar recordatorios para mañana
  - actualizar disponibilidad por día
- La disponibilidad por voz ya entiende frases tipo:
  - `el jueves solo voy a trabajar de 8 a 12 en la mañana, en la tarde nada`
  - `el jueves en la mañana de 9 a 12, en la tarde todo igual`
  - `el viernes solo de 10 a 19`
- Los rangos continuos deben respetar la pausa del medio; no deben llenar automáticamente el bloque entre mañana y tarde
- La creación de citas por voz debe tolerar lenguaje natural:
  - `nueva cita para Fidalgo el martes a las 8`
  - `crea una cita para Cecilia mañana a las 18`
- Si el nombre del cliente es ambiguo, la respuesta debe preguntar de forma humana:
  `¿Te refieres a Cecilia X o Cecilia Y?`
- Follow-ups como `el otro`, `el de Santa Cruz`, `sí`, `a las 8` deben intentar reutilizar la aclaración o acción pendiente inmediatamente anterior antes de caer en una nueva pregunta desde cero
- Antes de pedir “fecha exacta”, el parser debe intentar resolver fechas relativas y días de semana por sí mismo
- Las consultas de agenda deben resolver también rangos naturales como `esta semana` y `la próxima semana` sin depender de que el LLM invente un `date_key`
- Las etiquetas de fechas puras en respuestas de voz deben tratarse como fechas calendario, no como instantes zonificados; si dices `8 de abril`, la respuesta no puede mostrar `7 de abril`
- Si falla la creación de cita por `invalid_grant`, la respuesta debe culpar claramente a Google Calendar/autorización, no al comando del usuario ni al LLM
- Las consultas sobre disponibilidad no deben ejecutar cambios salvo que haya una instrucción explícita de modificación
- El cliente nunca debe recibir `CARTESIA_API_KEY`; la reproducción con Cartesia debe pasar por backend y usar `speechSynthesis` solo como fallback

### Reglas de trabajo vigentes
- Nunca hacer push sin que el usuario lo pida explícitamente en ese turno
- Los archivos mockup sueltos no se commitean:
  - `Skills/`
  - `ocr-sample.png`
  - `ocr-sample-2.png`

## Estado actual (2026-03-29)

### Funcionando
- **Server Express** corriendo en Hostinger (agenda.danielmaclean.com), auto-deploy desde GitHub
- **10 tablas MySQL** en `u926460478_agenda30` (localhost en Hostinger, srv2023.hstgr.io remoto)
- **Google Calendar OAuth** funcionando — slots, eventos, recordatorios
- **WhatsApp Cloud API** — recordatorios diarios 18:40 BOT, auto-reply a botones CONFIRM/REAGEN/DANIEL
- **OCR de comprobantes** — Google Vision API reconoce montos, referencias, bancos bolivianos. **Soporta imágenes Y PDFs** (via `files:annotate` endpoint)
- **Auto-match pagos por teléfono** — imagen/PDF WhatsApp → OCR → match con pago pendiente → confirma automáticamente
- **QR de pago automático** — al confirmar asistencia, envía QR según arancel del cliente; si la cita vieja/manual no tiene `booking_context`, un teléfono boliviano ya no debe bloquear el envío
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
- **Diagnóstico QR WhatsApp**: el follow-up posterior a `CONFIRM_NOW` ahora deja entradas `enviado` / `skipped` / `error` en `webhooks_log`
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
