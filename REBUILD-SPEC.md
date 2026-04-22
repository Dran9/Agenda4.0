# agenda4.0 — Especificación para Rebuild desde Cero

## Propósito de este documento

Este documento describe TODA la lógica de agenda4.0 sin referencia a diseño visual ni implementación específica. Una IA debe poder leer esto y reconstruir una app funcionalmente idéntica en cualquier stack.

---

## 1. QUÉ ES ESTA APP

Sistema de gestión de consultorio de psicoterapia para un terapeuta en Cochabamba, Bolivia. Funciones:

1. **Booking público** — El paciente entra a una URL, elige fecha/hora, ingresa su teléfono, y agenda su cita. Sin login del paciente.
2. **Recordatorios WhatsApp** — Cada día a las 18:40 BOT, el sistema envía recordatorio por WhatsApp a los pacientes con cita al día siguiente. El paciente responde con botones (Confirmo / Reagendar / Hablar con Daniel).
3. **Admin panel** — El terapeuta gestiona clientes, citas, pagos, configuración de horarios, y ve analytics. Acceso con PIN de 4 dígitos.
4. **OCR de comprobantes** — El paciente envía foto de su comprobante de pago por WhatsApp. El sistema lee el monto, banco, destinatario con Google Vision y cruza con pagos pendientes.
5. **Recurrencia** — Horarios semanales recurrentes (ej: "María, martes 10:00"). Se crean como series en Google Calendar y se materializan como citas individuales.
6. **Comandos de voz** — El terapeuta habla o escribe comandos en lenguaje natural ("agenda a María López el jueves a las 3") y el sistema ejecuta la acción.
7. **Metas financieras** — Meta mensual de ingresos con seguimiento de progreso.
8. **Auto-complete** — Citas pasan a "Completada" automáticamente 1 hora después de la hora programada.
9. **Recordatorio de pago** — Si hay pago pendiente para una cita próxima, envía recordatorio de cobro.

---

## 2. STACK TÉCNICO

- **Backend:** Express 4 + MySQL (mysql2 con pool)
- **Frontend:** React 18 + Vite
- **Integraciones:**
  - Google Calendar (OAuth2 con refresh token) — googleapis
  - Google Contacts (mismo OAuth)
  - Google Sheets (mismo OAuth) — sync espejo
  - Google Vision API — OCR de comprobantes
  - WhatsApp Cloud API v22.0 — mensajes y templates
  - Groq (llama-3.1-8b-instant) — STT y NLP para comandos de voz
  - Cartesia — TTS para respuestas de voz
- **Auth:** JWT (7 días), PIN de 4 dígitos, sin username
- **Validación:** Zod en endpoints públicos
- **Rate limiting:** express-rate-limit en endpoints públicos
- **File storage:** MySQL MEDIUMBLOB (QR codes, receipts, logos)

---

## 3. TIMEZONE — REGLA ABSOLUTA

- **Todo es America/La_Paz (UTC-4).** Bolivia NO tiene daylight saving time.
- MySQL pool configura `timezone: '-04:00'` — NUNCA quitar.
- `toISOString()` devuelve UTC. Para mostrar horas al usuario, usar `toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })`.
- NUNCA hacer doble conversión (aplicar toLocaleString + toLocaleTimeString resta 4 horas dos veces).
- Google Calendar events usan timezone `America/La_Paz`.
- En queries MySQL, `NOW()` devuelve UTC+0 (porque el server puede estar en otra zona). Para comparar con fechas Bolivia, usar `CURDATE()` que respeta el timezone del pool, o calcular `startOfTodayInBoliviaAsUTC`.

---

## 4. MODELO DE DATOS (14 tablas)

### 4.1 `tenants`
Multi-tenant root. Cada terapeuta es un tenant.

```
id INT AUTO_INCREMENT PK
name VARCHAR(255)
slug VARCHAR(100) UNIQUE
logo_key VARCHAR(50)
primary_color VARCHAR(7) DEFAULT '#2563eb'
secondary_color VARCHAR(7) DEFAULT '#1e40af'
welcome_text TEXT
domain VARCHAR(255)
created_at, updated_at DATETIME
```

Seed: `(1, 'Daniel MacLean', 'daniel', 'agenda.danielmaclean.com')`

### 4.2 `clients`
Entidad principal del paciente.

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
phone VARCHAR(20) — UNIQUE por tenant
first_name VARCHAR(100)
last_name VARCHAR(100)
age INT
city ENUM('Cochabamba','Santa Cruz','La Paz','Sucre','Otro') DEFAULT 'Cochabamba'
country VARCHAR(50) DEFAULT 'Bolivia'
timezone VARCHAR(50) DEFAULT 'America/La_Paz'
modality ENUM('Presencial','Online','Mixto') DEFAULT 'Presencial'
frequency ENUM('Semanal','Quincenal','Mensual','Irregular') DEFAULT 'Semanal'
source ENUM('Instagram','Referido','Google','Sitio web','Otro') DEFAULT 'Otro'
referred_by VARCHAR(200)
fee INT DEFAULT 250 — en Bolivianos, sin decimales
payment_method ENUM('QR','Efectivo','Transferencia') DEFAULT 'QR'
rating TINYINT 0-5
diagnosis TEXT — privado, solo admin
notes TEXT
status_override VARCHAR(20) — forzar status manual
deleted_at DATETIME NULL — soft delete
created_at, updated_at DATETIME
```

**Status calculado (NO almacenado, se calcula en cada query):**

| Status | Regla | Prioridad |
|--------|-------|-----------|
| Archivado | `deleted_at IS NOT NULL` o `status_override='Archivado'` | 1 (máxima) |
| Recurrente | Tiene horario recurrente activo | 2 |
| En pausa | Tiene horario recurrente pausado | 3 |
| Nuevo | 0 sesiones completadas | 4 |
| Activo | Cita futura O última sesión < 21 días Y < 10 sesiones | 5 |
| Recurrente (por sesiones) | Misma condición que Activo pero >= 10 sesiones | 6 |
| Inactivo | Sin cita futura Y última sesión > 56 días | 7 |

**Arancel automático al crear cliente:**
- Si la ciudad está en la lista de "capitales" → `capital_fee` (default 300 Bs)
- Si es Bolivia pero no capital → `default_fee` (default 250 Bs)
- Si es extranjero → `foreign_fee` (default 40 USD)

### 4.3 `appointments`

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
client_id INT FK→clients
date_time DATETIME
duration INT DEFAULT 60 (minutos)
gcal_event_id VARCHAR(255)
status ENUM('Agendada','Confirmada','Reagendada','Cancelada','Completada','No-show') DEFAULT 'Agendada'
is_first BOOLEAN DEFAULT FALSE
session_number INT DEFAULT 1
phone VARCHAR(20)
notes TEXT
user_agent VARCHAR(500)
booking_context JSON — {timezone, country, device, ip}
confirmed_at DATETIME
source_schedule_id INT FK→recurring_schedules (NULL si no viene de recurrencia)
created_at, updated_at DATETIME
```

**status transitions:**
- `Agendada` → `Confirmada` (paciente confirma vía WhatsApp) o `Cancelada` o `Completada` (auto o manual) o `No-show`
- `Confirmada` → `Completada`, `Cancelada`, `Reagendada`, `No-show`
- `Reagendada` → se elimina y se crea nueva cita (no hay transición directa)
- `Completada` → estado final
- `Cancelada` → estado final
- `No-show` → estado final

**Efectos de cambio de status:**
- A `Completada`: crear pago pendiente si no existe, liberar slot claims
- A `Cancelada`: eliminar evento GCal, liberar slot claims
- A `Confirmada`: el webhook añade ✅ al summary del evento GCal

**session_number:** Se calcula al crear la cita contando cuántas citas completadas tiene ese cliente + 1.

### 4.4 `appointment_slot_claims`
Protección contra overlap a nivel DB.

```
id INT AUTO_INCREMENT PK
tenant_id INT
appointment_id INT FK→appointments (CASCADE DELETE)
claim_time DATETIME — un row por cada minuto de duración
created_at DATETIME
UNIQUE (tenant_id, claim_time) — un solo claim por minuto-slot por tenant
```

Cuando se crea una cita de 60 min a las 10:00, se insertan 60 filas (10:00, 10:01, 10:02, ..., 10:59). Si otro intenta crear a las 10:30, la fila 10:30 ya existe y falla el INSERT → detección de overlap.

Los claims se liberan cuando la cita pasa a status no-bloqueante (Cancelada, Completada, No-show).

### 4.5 `recurring_schedules`

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
client_id INT FK→clients (CASCADE DELETE)
day_of_week TINYINT (0=domingo, 1=lunes, ..., 6=sabado)
time VARCHAR(5) — 'HH:MM'
duration INT DEFAULT 60
gcal_recurring_event_id VARCHAR(255)
source_appointment_id INT FK→appointments — cita que originó la recurrencia
started_at DATE
paused_at DATE NULL
ended_at DATE NULL
notes TEXT
created_at, updated_at DATETIME
UNIQUE (tenant_id, client_id, day_of_week, time, started_at)
```

**Estados derivados:**
- `activa` — `paused_at IS NULL AND ended_at IS NULL`
- `pausada` — `paused_at IS NOT NULL AND ended_at IS NULL`
- `terminada` — `ended_at IS NOT NULL`

**Reglas:**
- Un cliente puede tener máximo un horario recurrente activo (por day_of_week + time).
- Al crear: se genera un evento recurrente en GCal con RRULE:FREQ=WEEKLY;BYDAY=<day>.
- Al pausar: se hace update del GCal series (o delete + recreate al resumir).
- Al terminar: se elimina la serie GCal.
- El `source_appointment_id` es opcional — indica qué cita original generó la recurrencia.

### 4.6 `config`
Una fila por tenant. ~40 columnas.

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants UNIQUE
available_hours JSON — {"lunes":["08:00","09:00",...], "martes":[...]}
available_days JSON — ["lunes","martes","miercoles","jueves","viernes"]
window_days INT DEFAULT 10 — cuántos días hacia adelante se puede agendar
buffer_hours INT DEFAULT 3 — horas mínimas entre "ahora" y la cita agendable
appointment_duration INT DEFAULT 60
break_start VARCHAR(5) DEFAULT '13:00'
break_end VARCHAR(5) DEFAULT '14:00'
min_age INT DEFAULT 12
max_age INT DEFAULT 80
default_fee INT DEFAULT 250 — arancel provincia (Bs)
capital_fee INT DEFAULT 300 — arancel capital (Bs)
special_fee INT DEFAULT 150 — arancel especial (Bs)
foreign_fee INT DEFAULT 40 — arancel extranjero (USD)
capital_cities VARCHAR(255) DEFAULT 'Santa Cruz,La Paz'
qr_url_1..qr_url_4 VARCHAR(500) — URLs de imágenes QR de pago
rate_limit_booking INT DEFAULT 6 — intentos de booking por ventana
rate_limit_window INT DEFAULT 15 — minutos de la ventana de rate limit
reminder_time VARCHAR(5) DEFAULT '18:40' — hora de envío de recordatorios BOT
reminder_enabled BOOLEAN DEFAULT TRUE
payment_reminder_enabled BOOLEAN DEFAULT TRUE
payment_reminder_hours INT DEFAULT 2 — horas antes de la cita para recordar pago
wa_template_language VARCHAR(5) DEFAULT 'es'
monthly_goal INT DEFAULT 0 — meta mensual en Bs
retention_rules JSON — {"Semanal":{"risk_days":10,"lost_days":21},...}
auto_reply_confirm TEXT — template de auto-respuesta confirmación
auto_reply_reschedule TEXT
auto_reply_contact TEXT
payment_reminder_template TEXT
retention_risk_template TEXT
retention_lost_template TEXT
updated_at DATETIME
```

### 4.7 `payments`

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
client_id INT FK→clients
appointment_id INT FK→appointments (NULL si no asociado a cita)
amount INT — en Bs, sin decimales
method ENUM('QR','Efectivo','Transferencia') DEFAULT 'QR'
status ENUM('Pendiente','Confirmado','Rechazado','Mismatch') DEFAULT 'Pendiente'
receipt_file_key VARCHAR(50) — FK a tabla files
ocr_extracted_amount DECIMAL(10,2)
ocr_extracted_ref VARCHAR(100)
ocr_extracted_date VARCHAR(20)
ocr_extracted_dest_name VARCHAR(200)
notes TEXT
confirmed_at DATETIME
created_at, updated_at DATETIME
```

**Creación automática:** Cuando una cita pasa a `Completada`, se crea un pago `Pendiente` con el `fee` del cliente como `amount`.

**OCR match (3 validaciones):**
1. **Destinatario** — La cuenta destino del comprobante debe estar en una whitelist de cuentas conocidas del terapeuta.
2. **Monto** — El monto extraído debe coincidir con un pago pendiente del paciente.
3. **Fecha** — La fecha del comprobante no puede ser anterior al último contexto de pago.

Si pasa las 3 → `Confirmado` automáticamente. Si falla alguna → `Mismatch` y se notifica al terapeuta.

### 4.8 `deductions`

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
name VARCHAR(200)
percentage DECIMAL(5,2)
is_active BOOLEAN DEFAULT TRUE
created_at DATETIME
```

Deducciones configurables (alquiler, impuestos, etc.) que se aplican al cálculo de ingreso neto.

### 4.9 `financial_goals`

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
type ENUM('meta_mensual','deuda')
name VARCHAR(200)
target_amount DECIMAL(10,2)
monthly_payment DECIMAL(10,2)
is_active BOOLEAN DEFAULT TRUE
created_at, updated_at DATETIME
```

### 4.10 `files`
Almacena imágenes (QR, recibos, logos) como MEDIUMBLOB.

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
file_key VARCHAR(100) — ej: 'qr_1', 'receipt_123'
data MEDIUMBLOB
mime_type VARCHAR(50)
original_name VARCHAR(255)
size_bytes INT
created_at DATETIME
UNIQUE (file_key, tenant_id)
```

### 4.11 `webhooks_log`
Audit log de toda la actividad del sistema.

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
event VARCHAR(100)
type ENUM('reminder_sent','button_reply','message_sent','booking','reschedule','cancel','client_new','status_change','payment_confirmed','ocr_receipt','voice_command')
payload JSON
status ENUM('enviado','recibido','error','procesado')
client_phone VARCHAR(20)
client_id INT
appointment_id INT
bsuid VARCHAR(100)
created_at DATETIME
```

**Uso principal:**
- Dedup de recordatorios (verifica si ya se envió en las últimas 48h)
- Audit trail
- Feed de actividad reciente en el dashboard

### 4.12 `wa_conversations`
Inbox de mensajes WhatsApp.

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
client_id INT FK→clients
client_phone VARCHAR(20)
direction ENUM('inbound','outbound')
message_type ENUM('text','button_reply','template','auto_reply','image','document')
content TEXT
button_payload VARCHAR(50)
wa_message_id VARCHAR(100)
is_read BOOLEAN DEFAULT FALSE
metadata JSON
bsuid VARCHAR(100)
created_at DATETIME
```

### 4.13 `whatsapp_users`
Resolución de identidad BSUID ↔ teléfono.

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
bsuid VARCHAR(100) — UNIQUE por tenant
parent_bsuid VARCHAR(100)
phone VARCHAR(20) — UNIQUE por tenant
username VARCHAR(200)
client_id INT FK→clients (SET NULL)
source_waba_id VARCHAR(50)
source_phone_number_id VARCHAR(50)
first_seen_at DATETIME
last_seen_at DATETIME
created_at, updated_at DATETIME
```

**Por qué existe:** Meta migró de usar `wa_id` (número de teléfono) a `BSUID` (Business-Scoped User ID). El webhook puede recibir mensajes identificados por BSUID, por teléfono, o por ambos. Esta tabla mantiene el mapeo.

**Resolución de identidad (orden):**
1. Buscar por BSUID primero
2. Si no encuentra, buscar por phone
3. Si encuentra en cualquiera: fusionar datos faltantes (si tiene phone pero no BSUID, agregar BSUID, y viceversa)
4. Si no encuentra en ninguno: crear nuevo registro
5. Siempre resolver `client_id` buscando en tabla `clients` por phone

### 4.14 `voice_commands_log`

```
id INT AUTO_INCREMENT PK
tenant_id INT FK→tenants
source ENUM('shortcut','voice_web')
input_type ENUM('audio','text','audio_text')
raw_text TEXT
transcript TEXT
parsed_intent VARCHAR(50)
parsed_entities JSON
response_text TEXT
result_data JSON
status ENUM('resolved','clarification','error')
error_message TEXT
created_at DATETIME
```

### Relaciones entre tablas

```
tenants (1) → (N) clients, appointments, payments, deductions,
                    financial_goals, files, webhooks_log, wa_conversations,
                    voice_commands_log, recurring_schedules, whatsapp_users
tenants (1) → (1) config
clients (1) → (N) appointments, payments, wa_conversations, recurring_schedules
appointments (1) → (0..1) payments
appointments (1) → (N) appointment_slot_claims (CASCADE)
recurring_schedules (1) → (N) appointments (via source_schedule_id)
```

---

## 5. ARQUITECTURA DEL BACKEND

### 5.1 Patrón general

```
Routes (thin)  →  validate request → call service → respond HTTP
Services       →  toda la lógica de negocio
Middleware     →  auth (JWT) + validation (Zod) + rate limiting
Cron           →  4 scheduled jobs que corren al arrancar
```

### 5.2 Express setup

- JSON body limit: 5MB (para imágenes de comprobantes)
- Raw body capture en `/api/webhook` para verificación HMAC de Meta
- CORS habilitado
- Static files: `maxAge: 0, etag: false` (Hostinger/LiteSpeed cachea agresivamente)
- SPA fallback: `fs.readFileSync()` del index.html con headers no-cache

### 5.3 Auth

- Login: POST con `{ password }` (PIN de 4 dígitos, sin username). Retorna JWT.
- JWT payload: `{ tenantId, userId }`. Expiración: 7 días.
- Middleware extrae token de `Authorization: Bearer <token>` o `?token=` query param (para SSE).
- Tokens especiales: `x-voice-token` y `x-admin-token` para apps nativas.

### 5.4 Validación (Zod)

Esquemas para:
- `publicBooking` — phone, date_time, timezone, country, device, onboarding fields
- `adminBooking` — client_id, date_time, booking_context
- `publicReschedule` — token (JWT de un solo uso), date_time
- `client` — first_name, last_name, phone, age, city, etc.

Phone siempre se normaliza: se quitan todos los no-dígitos.

### 5.5 Rate Limiting

Solo en endpoints públicos:
- `POST /api/book` — configurable por tenant (default: 6 intentos / 15 min)
- `POST /api/reschedule` — idem
- `POST /api/client/check` — idem
- `POST /api/auth/login` — 5 intentos / 15 min

Los endpoints admin (protegidos por JWT) NO tienen rate limiting.

---

## 6. LÓGICA DE NEGOCIO — DETALLE POR MÓDULO

### 6.1 Booking (flujo público)

**Flujo completo:**

1. El paciente entra a la URL pública.
2. Ve un calendario con los próximos N días (window_days) habilitados.
3. Elige una fecha → el sistema muestra slots disponibles para ese día.
4. Elige un horario → ingresa su número de teléfono.
5. El sistema verifica el teléfono:
   - **`new`** — Teléfono desconocido. Muestra formulario de onboarding (nombre, apellido, edad, ciudad, fuente). El paciente completa y confirma.
   - **`returning`** — Teléfono conocido, sin cita activa. Muestra resumen y botón confirmar.
   - **`has_appointment`** — Ya tiene cita futura. Muestra la cita actual y permite reagendar.

**Cálculo de slots disponibles (`getAvailableSlots`):**

```
Para una fecha dada:
1. Verificar que la fecha esté dentro de la ventana (hoy a hoy + window_days)
2. Verificar que el día de la semana esté en available_days
3. Obtener las horas configuradas para ese día (available_hours[dayName])
4. Obtener los eventos de Google Calendar para ese día
5. Convertir eventos GCal a rangos ocupados (busy ranges) en minutos
6. Filtrar horas configuradas:
   a. Quitar horas que caigan dentro del break (break_start a break_end)
   b. Quitar horas pasadas (hora actual + buffer_hours como mínimo)
   c. Quitar horas que solapen con busy ranges de GCal
   d. Quitar horas que tengan slot claims en la DB
7. Clasificar cada slot restante como 'morning' (antes de 13:00) o 'afternoon'
8. Retornar [{time: '08:00', block: 'morning'}, ...]
```

**Creación de booking (`createBooking`):**

```
1. Adquirir MySQL advisory lock: 'booking:{tenantId}:{date}' (previene race conditions)
2. Verificar que el slot esté libre en GCal (busy ranges)
3. Crear evento en Google Calendar PRIMERO (sistema externo)
   - Summary: "Terapia - {nombre cliente}"
   - Start/End: date_time, date_time + duration
   - Timezone: America/La_Paz
4. En transacción MySQL:
   a. INSERT appointment
   b. INSERT appointment_slot_claims (una fila por minuto de duración)
   c. INSERT payment Pendiente (solo si es primera sesión o se requiere)
   d. INSERT webhooks_log (tipo 'booking')
5. Si falla el paso 4: compensar eliminando el evento GCal creado en paso 3
6. Liberar advisory lock
7. Side-effects async: crear Google Contact, sync Google Sheets
```

**Reagendar (`rescheduleAppointment`):**

```
1. Crear NUEVA cita primero (createBooking con los nuevos datos)
2. Si la nueva cita se creó exitosamente:
   a. Mover pagos Confirmados de la cita vieja a la nueva
   b. Eliminar cita vieja (y su evento GCal)
3. Si falla algo en paso 2: eliminar la cita nueva completamente (incluido GCal)
```

Este patrón de "crear nuevo primero, eliminar viejo después" es un safe compensation pattern — si algo falla a medio camino, el paciente siempre tiene al menos una cita.

**Token de reschedule:**
- JWT con expiración de 2 horas
- Payload: `{ purpose: 'reschedule', tenantId, clientId, appointmentId, phone }`
- Se genera cuando se detecta que el paciente ya tiene cita
- Se usa para autorizar el reschedule sin login

**Token de fee especial:**
- JWT con expiración de 30 días
- Payload: `{ purpose: 'fee', tenantId, fee: amount }`
- Permite crear links de booking con precio especial (ej: para becas)

### 6.2 Slots (disponibilidad)

**Batch slots:** Para el calendario, se necesita slots de múltiples días. Se hace UNA sola llamada a GCal para todo el rango visible y se cachea por fecha.

**Optimización:** Al cargar la página, se hace prefetch de todos los días del mes visible. Solo se refetch si el usuario navega a un mes no-cacheado.

### 6.3 Recordatorios WhatsApp (cron)

**Appointment Reminder (`checkAndSendReminders`):**

```
Se ejecuta diariamente a la hora configurada (default: 18:40 BOT).

Para cada evento de GCal de mañana:
1. Intentar matchear con una cita en DB por gcal_event_id
2. Si no hay match, intentar por recurrencia (day_of_week + time match con cliente)
3. Si no hay match, extraer teléfono del summary del evento GCal (formato conocido)
4. Si la cita viene de un horario recurrente pausado/terminado → SKIP
5. Verificar dedup: ¿ya se envió reminder para este teléfono/cita en últimas 48h?
6. Si no hay dedup:
   a. Enviar template WhatsApp 'recordatorionovum26' con:
      - Header: imagen genérica
      - Body: nombre del paciente, fecha, hora
      - Buttons: CONFIRM_NOW, REAGEN_NOW, DANIEL_NOW
   b. Registrar en webhooks_log
```

**Payment Reminder (`checkAndSendPaymentReminders`):**

```
Se ejecuta cada 15 minutos.

1. Buscar pagos con status 'Pendiente' para citas que ocurren dentro de las próximas N horas
   (configurable: payment_reminder_hours, default 2)
2. Verificar dedup en webhooks_log (24h)
3. Enviar template de recordatorio de pago con monto
```

### 6.4 Auto-Complete (cron)

```
Se ejecuta cada hora (primer run después de 5 min del arranque).

1. Buscar citas con status IN ('Agendada','Confirmada','Reagendada')
   donde date_time + duration < NOW() - 1 hora
2. Para cada una:
   a. Cambiar status a 'Completada'
   b. Crear pago 'Pendiente' si no existe
   c. Liberar slot claims
```

### 6.5 Recurring Sync (cron)

```
Se ejecuta diariamente a las 06:00 BOT.

1. Escanear eventos recurrentes de GCal en los próximos 14 días
2. Buscar "Terapia" en el summary
3. Extraer teléfono del summary
4. Matchear con cliente en DB por teléfono
5. Si el evento recurrente no tiene fila en recurring_schedules → crearla
6. Esto permite que el terapeuta cree eventos recurrentes directamente en Google Calendar
   y el sistema los detecte automáticamente
```

### 6.6 Webhook WhatsApp (procesamiento de mensajes entrantes)

**Verificación del webhook:**
- GET con `hub.verify_token` → responder con `hub.challenge`
- POST con firma HMAC-SHA256 del raw body usando WA_APP_SECRET

**Procesamiento de mensajes:**

```
Para cada mensaje entrante:
1. Verificar firma HMAC
2. Resolver identidad: extraer phone, bsuid del payload → resolver en whatsapp_users
3. Si es STATUS update (delivered, read, failed): solo loguear
4. Si es BUTTON_REPLY:
   a. CONFIRM_NOW:
      - Buscar evento GCal de mañana que contenga el teléfono del paciente
      - Añadir ✅ al summary del evento GCal
      - Actualizar cita en DB: status → 'Confirmada', confirmed_at → NOW()
      - Enviar auto-respuesta con instrucciones de pago
      - Después de 15 segundos, enviar imagen QR (solo si el paciente es de Bolivia)
   b. REAGEN_NOW:
      - Enviar template con link de reagendamiento
   c. DANIEL_NOW:
      - Enviar mensaje "Daniel te contactará pronto"
      - El terapeuta ve esto en el dashboard
5. Si es TEXT:
   a. Clasificar el mensaje:
      - Si hay contexto de pago (pago pendiente reciente) → almacenar como 'payment'
      - Si hay contexto de booking → almacenar como 'booking'
      - Si no hay contexto ni keywords relevantes → descartar como ruido
6. Si es IMAGE o DOCUMENT:
   a. Descargar el media con la API de WhatsApp
   b. Almacenar en tabla files
   c. Si hay contexto de pago (QR enviado, CONFIRM presionado, pago pendiente en últimas 2h):
      - Ejecutar OCR (Google Vision)
      - Validar comprobante (destinatario, monto, fecha)
      - Si pasa: confirmar pago automáticamente, añadir 💰 al GCal summary
      - Si falla: marcar como Mismatch, enviar WhatsApp con detalle del rechazo
```

**Clasificación de mensajes (`messageContext`):**

El sistema no guarda TODOS los mensajes — solo los "operacionales". Los mensajes de texto sin contexto de negocio se descartan silenciosamente para no llenar la DB de ruido.

**Contexto operativo se determina por:**
- ¿El cliente es conocido?
- ¿Tiene cita futura?
- ¿Tiene pago pendiente?
- ¿Hubo ventana operacional reciente? (booking, reminder, payment en últimas horas)

### 6.7 OCR de Comprobantes Bolivianos

**Extractores:**

1. **Monto** — Regex que busca: Bs, BOB, Importe, Total, Monto seguido de número
2. **Fecha** — DD/MM/YYYY, YYYY-MM-DD, "23 de marzo de 2026", timestamps
3. **Nombre del remitente** — Patrones: "De:", "Enviado por:", "Cuenta de origen:", "A nombre de:", bloques all-caps
4. **Cuenta destino** — Whitelist de cuentas conocidas del terapeuta. Patrones para BCP, BISA, BNB, Mercantil, Ganadero, BancoSol
5. **Referencia** — Código de transacción, número de comprobante, código bancarización
6. **Banco** — Detectado del texto de origen o patrones generales

**Validación (3 checks obligatorios):**

1. **destAccountVerified** — La cuenta destino del comprobante debe coincidir con una de las cuentas conocidas
2. **amount** — El monto debe coincidir con un pago pendiente del cliente (tolerancia configurable)
3. **date** — La fecha no puede ser anterior al último contexto de pago

**Match priority:** teléfono (más confiable) > monto > nombre (menos confiable, porque a menudo paga un familiar).

### 6.8 Recurring Schedules (motor de recurrencia)

**Crear horario recurrente:**

```
1. Validar: client_id, day_of_week (0-6), time (HH:MM), started_at (date)
2. Verificar que no exista horario activo para este cliente en este day+time
3. Si hay una cita existente que coincide en day+time, usarla como source_appointment
4. Crear evento recurrente en GCal:
   - RRULE:FREQ=WEEKLY;BYDAY=<day abbr>
   - Start: first occurrence on or after started_at
   - Summary: "Terapia - {nombre cliente}"
5. INSERT en recurring_schedules con gcal_recurring_event_id
6. Actualizar client.frequency → 'Semanal'
```

**Materializar ocurrencia:**

Las citas recurrentes son "virtuales" hasta que se necesitan. Cuando el sistema necesita una cita concreta (para recordatorio, para mostrar en agenda, etc.), la "materializa":

```
1. Adquirir advisory lock: 'recurring:{tenantId}:{scheduleId}:{date}'
2. Verificar si ya existe cita para este schedule+date
3. Si no existe:
   a. Verificar que el schedule esté activo (no pausado, no terminado)
   b. Crear evento GCal individual (si no viene de una instancia del recurring event)
   c. INSERT appointment con source_schedule_id
   d. INSERT slot_claims
   e. INSERT payment Pendiente
4. Idempotente: si la cita ya existe, retornarla sin error
```

**Pausar:** `paused_at = CURDATE()`. No elimina el GCal series inmediatamente (se maneja al procesar).

**Resumir:** `paused_at = NULL`. Recrear GCal series si fue eliminado.

**Terminar:** `ended_at = CURDATE()`. Eliminar GCal series. Las citas ya materializadas NO se eliminan.

**Upcoming sessions:** Combinación de citas reales (type='materialized') + ocurrencias proyectadas del schedule (type='virtual'). El frontend muestra ambas, las virtuales con indicador visual diferenciado.

### 6.9 Voice Commands

**Pipeline de 3 niveles:**

**Nivel 1 — Explicit follow-up:**
Si el comando anterior quedó en estado `clarification` (ej: "¿Cuál María?"), el input actual se interpreta como selección del candidato.

**Nivel 2 — Regex directo:**
Patterns para intents comunes:
- Disponibilidad: "hay cupo", "está libre el..."
- Recurrencia: "activar recurrencia", "pausar recurrencia"
- Crear cita: "agenda a [nombre] el [día] a las [hora]"
- Agenda: "qué tengo el [día]", "mi agenda de hoy"
- Recordatorios: "enviar recordatorios", "activar recordatorios"
- Pagos: "pagos pendientes", "cuánto me deben"

**Nivel 3 — LLM fallback:**
Si regex no matchea, enviar a Groq (llama-3.1-8b-instant) con prompt estructurado para extraer intent + entities como JSON.

**Parser de fechas relativas:**
- "hoy" → fecha actual
- "mañana" → hoy + 1
- "pasado mañana" → hoy + 2
- "el jueves" → próximo jueves
- "el 15" → día 15 del mes actual o próximo

**Parser de horas naturales:**
- "8 de la tarde" → 20:00
- "14:30" → 14:30
- "8 y media" → 08:30
- "3 de la tarde" → 15:00

**Planner (LLM tool-use):**
Para comandos complejos, el planner puede hacer hasta 3 iteraciones llamando herramientas:
- `search_clients` — buscar cliente por nombre
- `get_client_upcoming_appointments` — citas del cliente
- `get_day_agenda` — agenda del día
- `get_weekday_availability` — slots libres

**Intents ejecutables (20+):**

| Intent | Qué hace |
|--------|----------|
| `agenda_query` | Lista citas de un día/semana |
| `pending_payments` | Lista pagos pendientes |
| `pending_amount` | Total pendiente |
| `sessions_to_goal` | Cuántas sesiones faltan para la meta |
| `client_lookup` | Info de un cliente |
| `client_upcoming_appointments` | Citas futuras del cliente |
| `reminder_check` | Verificar si se enviaron recordatorios |
| `confirmation_check` | Verificar confirmaciones |
| `create_appointment` | Crear cita completa |
| `activate_recurring` | Activar recurrencia |
| `deactivate_recurring` | Terminar recurrencia |
| `pause_recurring` | Pausar recurrencia |
| `resume_recurring` | Resumir recurrencia |
| `recurring_status` | Estado de recurrencia |
| `reminder_toggle` | Activar/desactivar recordatorios |
| `send_reminders` | Forzar envío de recordatorios |
| `update_availability` | Modificar horarios semanales |

**Desambiguación de clientes:**
Si una búsqueda retorna múltiples clientes, el sistema:
1. Lista los candidatos con nombre + atributo diferenciador (ciudad, teléfono últimos 4 dígitos)
2. Pide al usuario que elija ("el primero", "el de Santa Cruz", "sí" para confirmar el único)
3. El contexto se mantiene entre turnos

### 6.10 Analytics

Una sola llamada retorna 13 queries paralelas:

1. **Totales** — clientes, citas, sesiones completadas, canceladas, no-show, reagendadas
2. **Sesiones por semana** — últimas 12 semanas con count por status
3. **Sesiones por status** — distribución
4. **Clientes por ciudad** — distribución
5. **Clientes por fuente** — distribución
6. **Horas populares** — heatmap hora × día
7. **Status de clientes** — distribución (Nuevo/Activo/Inactivo/etc.)
8. **Actividad reciente** — últimos 20 eventos
9. **Retención** — distribución por status de retención
10. **Recurrencia** — activos, pausados, terminados, churn rate
11. **MRR proyectado** — revenue mensual recurrente basado en schedules activos

### 6.11 Retención de clientes

Cálculo basado en frecuencia del cliente:

| Frecuencia | Días en riesgo | Días perdido |
|-----------|---------------|-------------|
| Semanal | 10 | 21 |
| Quincenal | 21 | 35 |
| Mensual | 45 | 75 |
| Irregular | 30 | 60 |

Status de retención:
- `Nuevo` — 0 sesiones
- `Con cita` — tiene cita futura
- `Recurrente` — tiene schedule recurrente activo
- `Al día` — última sesión dentro del rango OK para su frecuencia
- `En riesgo` — última sesión entre risk_days y lost_days
- `Perdido` — última sesión > lost_days

### 6.12 Quick Actions

8 acciones rápidas para el admin:

1. **Reagendar** — Envía link de reagendamiento por WhatsApp template
2. **Cancelar** — Cancela próxima cita. Opción de terminar recurrencia al cancelar.
3. **No-show** — Marca la cita de hoy o más reciente como No-show
4. **Recordar cita** — Envía recordatorio manual (ignora dedup con force=1)
5. **Recordar cobro** — Envía recordatorio de pago (ignora enabled/window checks)
6. **Gestionar recurrencia** — Abre modal para activar/pausar/resumir/terminar/editar
7. **Ajustar arancel** — Cambia el fee del cliente

### 6.13 Google Sheets Sync

Función espejo: la DB es source of truth, Sheets es de solo lectura.

- `syncClientToSheet(client)` — Upsert fila en hoja "Clientes" (ID, phone, nombre, ciudad, fee, fecha)
- `syncBookingToSheet(appointment, client)` — Append fila en hoja "Citas"

Se ejecuta después de crear booking y después de crear cliente.

### 6.14 Google Contacts

`createContact({firstName, lastName, phone, city})` — Crea contacto en Google Contacts y lo agrega a los grupos "Pacientes" y "Agenda4.0".

### 6.15 SSE (Server-Sent Events)

`GET /api/admin/events?token=<jwt>` — Stream de eventos en tiempo real para el admin.

Eventos emitidos:
- `appointment:change` — cualquier cambio en citas
- `client:change` — cualquier cambio en clientes
- `payment:change` — cualquier cambio en pagos
- `recurring:change` — cualquier cambio en recurrencia

El cliente usa `EventSource` con debounce de 400ms para colapsar eventos rápidos. Auto-reconnect con backoff exponencial (1s → 30s max).

---

## 7. FRONTEND — LÓGICA DE PÁGINAS

### 7.1 BookingFlow (público, 7 pantallas)

**Gestión de estado:** `useReducer` con 16 actions. No múltiples useState sueltos.

**Pantallas:**

| Screen | Qué muestra | Transiciones |
|--------|------------|--------------|
| 1 | Calendario + slots | → 2 (pick slot) o → 7 (reschedule mode) |
| 2 | Input de teléfono | → 3 (phone check) o ← 1 |
| 3 | Confirmación + onboarding (si nuevo) | → 5 (book success) o → 6 (has appointment) o ← 2 |
| 5 | Éxito | Terminal |
| 6 | "Ya tienes cita" + opción reagendar | → 5 (keep) o → reschedule |
| 7 | Confirmar reschedule (old vs new) | → 5 (success) o ← 1 |

**Flujo de phone check:**
```
POST /book con { phone, date_time }
→ response.clientStatus:
  'new' + needs_onboarding → Screen 3 con formulario completo
  'returning' → Screen 3 con botón confirmar simple
  'has_appointment' → Screen 6 con datos de cita existente + token de reschedule
  'booked' → Screen 5 directo
```

**IP Geolocation:**
Al montar, se llama a `https://ipapi.co/json/` para detectar timezone del paciente.
Si el timezone no es America/La_Paz, se muestra selector de timezone.
Los horarios se convierten de La Paz al timezone del usuario.

**URL parameters especiales:**
- `?t=<phone>` — Pre-llenar teléfono
- `?r=<phone>` — Modo reschedule, auto-submit si el teléfono coincide
- `?f=<mode>` — Fee mode
- `?code=<code>` — Código de fee especial (JWT)
- `?devmode=1` — Sin rate limiting, banner de dev, selector de timezone visible
- `?mock=onboarding` — Pre-seleccionar fecha/slot y saltar a onboarding

### 7.2 Admin Pages

**Login:**
- Un solo campo: PIN de 4 dígitos
- POST /auth/login → JWT → localStorage.auth_token → redirect a /admin/quick-actions

**Dashboard ("Hoy"):**
- Carga paralela: today appointments + recurring upcoming + payments summary + config
- Real-time: SSE para appointment:change, recurring:change, payment:change
- Merge de citas standalone + recurrentes virtuales, ordenadas por hora
- Cálculos: próxima cita, pendientes (mismatch, sin pago, sin confirmar), huecos libres (ventanas >= 30 min)
- Meta mensual con barra de progreso y "session mix" (cuántas sesiones de cada tipo faltan)

**Clientes:**
- Tabla con sort, search, filter por status/fuente
- Vista: activos / archivados / todos
- Status dropdown inline (editar sin abrir modal)
- Fee editable inline
- Recurrencia: badge + botones de gestión (abre RecurringQuickModal)
- Soft delete (archivar) y hard delete (purgar con cascade)
- Crear cliente: modal con todos los campos

**Agenda (Appointments):**
- Tabla paginada (50 por página) con filters: status, fecha desde/hasta, search, sort (8 opciones)
- Cambio de status inline (dropdown por fila)
- Envío de reminder manual por cita
- Gestión de recurrencia inline
- Receipt summary: muestra datos OCR del pago asociado

**Quick Actions:**
- Search bar con debounce 220ms → busca clientes
- Al seleccionar: muestra 7 botones de acción
- Cada acción ejecuta y muestra resultado (éxito/error)
- "Upcoming clients": 4 clientes con cita más próxima (cuando no hay cliente seleccionado)
- Quick settings: toggle recordatorios, ver window days, estado de payment reminders

**Config (5 secciones):**
1. Availability — Grid día × horas. Toggle por hora. Copy a otros días.
2. Pricing — 4 tiers de fee. Capital cities. Generador de links con fee especial. Upload QR por tier.
3. Reminders — Toggle appointment/payment reminders. Configurar horas. Ver estado del scheduler (intervalos, última ejecución).
4. Operations — Duración sesión, ventana de días, buffer, edades, rate limits.
5. Retention — Thresholds por frecuencia (risk_days, lost_days).

**Analytics:**
- Una sola llamada GET /analytics
- KPIs + gráficos (barras, pie, línea)

**WhatsApp:**
- Dos tabs: Mensajes (conversaciones) y Activity Log (webhooks_log)
- Filtros por dirección, tipo de mensaje, tipo de log
- Botones para trigger manual de recordatorios (hoy/mañana)

**Finanzas:**
- Selector de mes con flechas
- Meta mensual con edición inline
- Session mix sugerido
- Summary cards: ingresos confirmados, pendientes, promedio por sesión
- Historial mensual (scroll horizontal)
- Tabla de pagos del mes con OCR popover

### 7.3 Voice Assistant

- Botón de mic (hold to record o tap)
- MediaRecorder API → FormData → POST /voice/admin-command
- Response incluye transcript, parsed intent, reply text
- TTS: primero intenta server-side (Cartesia), fallback a SpeechSynthesis del browser
- Historial: GET /voice/history (últimos 18)

---

## 8. INTEGRACIONES EXTERNAS

### 8.1 Google Calendar

**OAuth2 con refresh token.** Scopes: calendar.events (read/write), contacts (read/write).

Funciones:
- `listEvents(calendarId, timeMin, timeMax)` — listar eventos
- `createCalendarEvent({summary, start, end, description, recurrence})` — crear evento
- `createRecurringEvent(...)` — crear con RRULE
- `deleteEvent(eventId)` — eliminar
- `updateEvent(eventId, {summary, ...})` — actualizar
- `updateEventSummary(eventId, prefix)` — añadir prefijo (✅ o 💰)

Todos los eventos usan timezone `America/La_Paz`.

### 8.2 WhatsApp Cloud API

**Graph API v22.0.**

Templates usados:
- `recordatorionovum26` — Recordatorio de cita con 3 botones
- `reprogramar_sesion` — Link de reagendamiento
- `recordatorio_pago` — Recordatorio de pago con monto

**Envío de mensajes:**
- Templates siempre se envían por teléfono (no BSUID)
- Texto libre se puede enviar por teléfono o BSUID
- Imágenes con caption

**BSUID awareness:**
Meta está migrando de wa_id (teléfono) a BSUID. El sistema:
- Acepta ambos como destinatario
- Prioriza teléfono sobre BSUID para templates
- Mantiene tabla whatsapp_users con el mapeo

### 8.3 Google Vision API

- `TEXT_DETECTION` para imágenes
- `DOCUMENT_TEXT_DETECTION` para PDFs
- Free tier: 1,000 imágenes/mes

### 8.4 Groq

- Modelo: `llama-3.1-8b-instant`
- Usado para: STT (Whisper), NLP (command parsing), planning (tool-use)
- Fallback: regex directo si Groq no responde

### 8.5 Cartesia

- TTS para respuestas de voz
- Output: MP3
- Lenguaje: español

---

## 9. REGLAS DE HOSTINGER (infraestructura)

- `dns.setDefaultResultOrder('ipv4first')` DEBE ser la primera línea de `server/db.js`
- `client/dist/` se commitea al repo — Hostinger no ejecuta builds
- `"build"` en package.json raíz es un no-op
- `express.static()` con `maxAge: 0, etag: false`
- SPA fallback usa `fs.readFileSync()`, no `res.sendFile()`
- Después de cambios en client/: `cd client && npm run build` → commitear dist/

---

## 10. REGLAS DE CÓDIGO

- `type="button"` en todo `<button>` que no sea submit de form — sin esto, React state se borra al hacer click
- Textos en español: NUNCA unicode escapes (`\u00f3`), siempre caracteres directos (`ó`)
- Phone siempre se normaliza: quitar todos los no-dígitos antes de comparar/almacenar
- NUNCA usar `NOW()` directamente para comparaciones de tiempo Bolivia — siempre convertir
- BookingFlow usa `useReducer`, no múltiples useState
- No soft delete sin razón de negocio — ghost records causan más problemas que soluciones
- Catch blocks nunca vacíos — siempre loguear o propagar
- Error handling centralizado en un helper
