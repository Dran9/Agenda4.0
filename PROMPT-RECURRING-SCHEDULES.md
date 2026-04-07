# PROMPT: Implementar Recurring Schedules (Sesiones Recurrentes Semanales)

## Contexto del negocio

Daniel es psicólogo. Cuando un cliente se compromete a terapia semanal, Daniel entra a Google Calendar y pone "repetir cada semana" en el último evento de terapia de ese cliente. Eso crea infinitas instancias futuras en GCal. Pero nuestra app no sabe nada de esa recurrencia — el cliente no aparece en la agenda admin, no recibe recordatorios, y no existe en las métricas.

**El problema**: no queremos crear infinitas filas de appointments en la BD. Queremos guardar **el patrón** ("Fulano tiene terapia cada miércoles a las 10:00") y materializar appointments individuales solo cuando se interactúa con ellos (enviar recordatorio, cambiar status, registrar pago).

## Arquitectura: "Recurring Schedules" con Materialización Lazy

```
GCal (evento recurrente) ←──sync──→ recurring_schedules (patrón en BD)
                                              │
                                       al interactuar
                                              ↓
                                      appointments (instancia real)
                                              │
                                      payments, reminders, etc.
```

---

## PARTE 1: Nueva tabla `recurring_schedules`

En `server/db.js`, dentro de `initializeDatabase()`, agregar la tabla 12:

```sql
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  client_id INT NOT NULL,
  day_of_week TINYINT NOT NULL,       -- 0=domingo, 1=lunes, ... 6=sábado
  time VARCHAR(5) NOT NULL,            -- "10:00" (hora Bolivia)
  duration INT DEFAULT 60,
  gcal_recurring_event_id VARCHAR(255), -- ID base del evento recurrente en GCal (puede ser NULL si se creó manual)
  source_appointment_id INT DEFAULT NULL, -- la cita original desde la cual se activó (referencia, puede ser NULL)
  started_at DATE NOT NULL,            -- cuándo empezó el patrón
  paused_at DATE DEFAULT NULL,         -- NULL = activo. Si tiene fecha = pausado desde ese día
  ended_at DATE DEFAULT NULL,          -- NULL = vigente. Si tiene fecha = terminó
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  KEY idx_client (client_id),
  KEY idx_active (tenant_id, ended_at, paused_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
)
```

**Reglas de la tabla:**
- Un cliente puede tener máximo 1 recurring_schedule activo (ended_at IS NULL AND paused_at IS NULL) por tenant.
- `day_of_week` sigue la convención JS: 0=domingo, 1=lunes, ..., 6=sábado.
- `time` es hora Bolivia (America/La_Paz), formato "HH:MM".
- `paused_at` permite pausar sin perder el historial (vacaciones, pausa terapéutica).
- `ended_at` es final permanente.

---

## PARTE 2: API endpoints para recurring schedules

Crear un nuevo archivo `server/routes/recurring.js` con estos endpoints:

### `GET /api/recurring` (admin, authMiddleware)
Lista todos los schedules del tenant. JOIN con clients para mostrar nombre, teléfono, fee. Incluir campo `is_active` computado: `ended_at IS NULL AND paused_at IS NULL`.

### `POST /api/recurring` (admin, authMiddleware)
Crear un nuevo schedule. Body:
```json
{
  "client_id": 5,
  "day_of_week": 3,        // miércoles
  "time": "10:00",
  "started_at": "2026-04-01",   // obligatorio
  "source_appointment_id": 42,  // opcional
  "notes": "Acordado en sesión del 1 de abril"  // opcional
}
```

Validaciones:
- `client_id` debe existir y pertenecer al tenant
- `day_of_week` entre 0-6
- `time` formato HH:MM válido
- `started_at` es una fecha válida
- No debe existir otro schedule activo para el mismo client_id (ended_at IS NULL AND paused_at IS NULL). Si existe, retornar 409 con mensaje claro.

Al crear, opcionalmente crear el evento recurrente en GCal:
- Calcular la próxima fecha que corresponda a ese day_of_week desde started_at
- Crear un evento en GCal con recurrence rule: `RRULE:FREQ=WEEKLY;BYDAY={día}`
- Guardar el gcal_recurring_event_id
- Si GCal falla, NO bloquear — crear el schedule sin gcal_recurring_event_id y logear el error

También actualizar `clients.frequency` a `'Semanal'` automáticamente.

### `PUT /api/recurring/:id` (admin, authMiddleware)
Actualizar un schedule existente. Permite cambiar:
- `day_of_week` — cambiar el día de la semana
- `time` — cambiar la hora
- `notes`

Si cambia día u hora, y hay gcal_recurring_event_id, intentar actualizar el evento en GCal también (best effort, no bloquear si falla).

### `PUT /api/recurring/:id/pause` (admin, authMiddleware)
Pausar el schedule: `SET paused_at = CURDATE()`. No body requerido.

### `PUT /api/recurring/:id/resume` (admin, authMiddleware)
Reactivar: `SET paused_at = NULL`. No body requerido.

### `PUT /api/recurring/:id/end` (admin, authMiddleware)
Terminar definitivamente: `SET ended_at = CURDATE()`. No body requerido.

### `GET /api/recurring/upcoming?from=YYYY-MM-DD&to=YYYY-MM-DD` (admin, authMiddleware)
**Este es el endpoint clave para el dashboard.** Computa las sesiones virtuales de los schedules activos que caen entre `from` y `to`. Para cada schedule activo:
1. Iterar cada día del rango from→to
2. Si el día de la semana coincide con `day_of_week`, Y la fecha >= `started_at`, Y (ended_at IS NULL OR fecha < ended_at), Y (paused_at IS NULL):
   - Verificar si ya existe un appointment materializado para ese client_id en esa fecha+hora exacta
   - Si no existe → incluir como sesión virtual: `{ type: "virtual", client_id, client_name, phone, fee, date_time, schedule_id, day_of_week, time }`
   - Si ya existe → incluir como sesión materializada: `{ type: "materialized", ...appointmentData }`

Retornar array ordenado por date_time ASC.

### `POST /api/recurring/:id/materialize` (admin, authMiddleware)
Materializar manualmente una instancia específica. Body: `{ "date": "2026-04-09" }`.
- Verificar que la fecha corresponde al day_of_week del schedule
- Crear appointment en BD con client_id, date_time, duration, status='Agendada'
- Crear evento individual en GCal (NO recurrente)
- Retornar el appointment creado

**Montar las rutas** en `server/index.js`:
```js
app.use('/api/recurring', require('./routes/recurring'));
```

---

## PARTE 3: Modificar el sistema de recordatorios

En `server/services/reminder.js`, la función `checkAndSendReminders` ya lee GCal y matchea por teléfono. El cambio necesario:

**Después del matching actual (línea ~148 "No match for event")**, agregar un tercer intento de matching:

```
// Try 3: Check if this is a recurring GCal event matching a recurring_schedule
```

Lógica:
1. Si el evento GCal tiene un `recurringEventId` (la API de Google lo incluye cuando es instancia de un evento recurrente), buscar en `recurring_schedules` por `gcal_recurring_event_id = recurringEventId`
2. Si matchea, verificar que no existe appointment para ese client_id en esa fecha
3. Si no existe → **materializar**: crear appointment en BD con los datos del schedule + la fecha/hora del evento GCal
4. Luego enviar el recordatorio normalmente usando el appointment recién creado

Esto hace que los recordatorios funcionen automáticamente para sesiones recurrentes sin ninguna intervención manual.

**IMPORTANTE**: La API de Google Calendar, cuando usas `singleEvents: true` en `listEvents()`, ya expande los eventos recurrentes en instancias individuales. Cada instancia tiene `recurringEventId` apuntando al evento base. Esto ya funciona con nuestro `listEvents()` actual en `server/services/calendar.js`.

---

## PARTE 4: Sync GCal → App (detectar recurrencia desde GCal)

Crear `server/services/recurringSync.js`:

### Función: `syncRecurringFromGCal(tenantId)`

1. Listar eventos de GCal para los próximos 14 días
2. Para cada evento que tenga `recurringEventId` Y contenga "Terapia" en el summary:
   a. Extraer teléfono del summary (regex: `/-\s*(\d{10,15})\s*$/`)
   b. Buscar cliente por teléfono
   c. Si el cliente existe Y NO tiene un recurring_schedule activo:
      - Determinar day_of_week y time del evento
      - Crear recurring_schedule automáticamente con source='gcal_sync'
      - Log: `[recurring-sync] Auto-created schedule for {clientName} - {day} {time}`
   d. Si el cliente ya tiene schedule pero con día/hora diferente:
      - Log el cambio pero NO auto-modificar (Daniel decide manualmente)
3. Retornar resumen: `{ created: N, already_exists: N, no_client_match: N }`

### Cron para sync

En `server/cron/scheduler.js`, agregar un job que ejecute `syncRecurringFromGCal()` una vez al día, por ejemplo a las 06:00 BOT (antes de los recordatorios). Usar el mismo patrón de setTimeout loop que ya usa el scheduler.

---

## PARTE 5: Dashboard — mostrar sesiones recurrentes

En `client/src/pages/Admin/Dashboard.jsx`:

### En la sección "Agenda viva del día"

Actualmente carga `api.get('/appointments/today')`. Modificar para TAMBIÉN cargar sesiones virtuales de hoy:

```js
const [appts, recurring] = await Promise.all([
  api.get('/appointments/today'),
  api.get(`/recurring/upcoming?from=${today}&to=${today}`),
]);
```

Combinar ambas listas, ordenar por hora. Las sesiones virtuales (recurrentes no materializadas) deben mostrarse con:
- Un indicador visual: ícono de repetición (usar `Repeat` de lucide-react) junto al nombre
- Color de fondo ligeramente diferente (ej: `bg-blue-50/60` en vez de `bg-[#fcfbf8]`)
- En lugar del badge de status, mostrar "Recurrente" con estilo `bg-blue-100 text-blue-700`
- Al hacer click en el dropdown de status de una sesión virtual → materializar automáticamente (POST /api/recurring/:id/materialize) y luego cambiar status

### En la sección de KPIs / Priority Strip

Agregar un nuevo KPI en la strip de prioridad:
```js
{ label: 'Recurrentes', value: String(totalRecurringClients), tone: 'blue' }
```

Donde `totalRecurringClients` = cantidad de clientes con recurring_schedule activo. Este dato viene del nuevo campo en analytics (ver Parte 7).

---

## PARTE 6: Clients — mostrar badge de recurrencia

En `client/src/pages/Admin/Clients.jsx`:

### En la lista de clientes

Cargar los recurring schedules: `api.get('/recurring')`.

Para cada cliente que tenga un schedule activo, mostrar:
- Un badge "Semanal" con ícono de repeat junto al nombre, estilo `bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full`
- Debajo del badge: el día y hora (ej: "Mié 10:00")

### En el modal/detalle de cliente

Agregar una sección "Sesión recurrente" que muestre:
- Estado: Activa / Pausada / Finalizada
- Día y hora: editable inline (dropdown de día + input de hora)
- Fecha de inicio
- Botones: "Pausar" / "Reactivar" / "Finalizar"
- Botón "Activar semanal" si no tiene schedule activo — abre un mini-form:
  - Selector de día de la semana (Lunes a Sábado)
  - Input de hora (HH:MM) — **Daniel necesita poder definir manualmente la fecha y hora**
  - Fecha de inicio (date picker, default: hoy)
  - Botón "Activar"

**IMPORTANTE sobre la hora manual**: El input de hora debe ser un `<input type="time">` que permita a Daniel escribir la hora exacta. NO derivarla automáticamente de la última cita — siempre dejar que Daniel la defina o confirme manualmente. Pre-llenar con la hora de la última cita completada como sugerencia, pero siempre editable.

---

## PARTE 7: Analytics — métricas de recurrencia y churn

### Backend: `server/routes/analytics.js`

Agregar estas queries al Promise.all existente:

```sql
-- Recurring schedules count
SELECT
  COUNT(*) as total_recurring,
  SUM(CASE WHEN ended_at IS NULL AND paused_at IS NULL THEN 1 ELSE 0 END) as active_recurring,
  SUM(CASE WHEN paused_at IS NOT NULL AND ended_at IS NULL THEN 1 ELSE 0 END) as paused_recurring,
  SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) as ended_recurring
FROM recurring_schedules
WHERE tenant_id = ?
```

```sql
-- Churn: clientes que terminaron recurrencia en los últimos 90 días
SELECT
  COUNT(*) as churned_90d,
  (SELECT COUNT(*) FROM recurring_schedules WHERE tenant_id = ? AND ended_at IS NULL AND paused_at IS NULL) as active_now
FROM recurring_schedules
WHERE tenant_id = ? AND ended_at IS NOT NULL AND ended_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
```

```sql
-- Recurring revenue projection (ingreso recurrente mensual proyectado)
SELECT COALESCE(SUM(c.fee), 0) as projected_monthly_recurring
FROM recurring_schedules rs
JOIN clients c ON rs.client_id = c.id
WHERE rs.tenant_id = ? AND rs.ended_at IS NULL AND rs.paused_at IS NULL
```

Agregar al response JSON:
```json
{
  "recurring": {
    "total": 15,
    "active": 12,
    "paused": 2,
    "ended": 1,
    "churned_90d": 3,
    "churn_rate": 0.20,
    "projected_monthly_recurring": 12000
  }
}
```

`churn_rate` = `churned_90d / (active_now + churned_90d)` — es decir, de los que estaban recurrentes en los últimos 90 días, qué porcentaje se fue.

### Frontend: `client/src/pages/Admin/Analytics.jsx`

Agregar una nueva sección "Recurrencia y Retención" con:

1. **KPI cards** (nueva fila):
   - "Clientes recurrentes activos" — número grande, color verde
   - "Pausados" — número, color amarillo
   - "Churn (90d)" — número + porcentaje, color rojo si > 15%
   - "MRR proyectado" — monto en Bs, color azul (MRR = Monthly Recurring Revenue, multiplicar fee × 4.33 semanas)

2. **Mini chart**: Evolución de recurrentes activos por mes (esto requiere un query adicional que agrupe por mes de created_at y ended_at — implementar si es factible, sino dejarlo como TODO).

---

## PARTE 8: Appointments — distinguir recurrentes

En `client/src/pages/Admin/Appointments.jsx`:

Cuando un appointment fue materializado desde un recurring_schedule, mostrar el ícono de repeat junto a la fecha. Para detectar esto, agregar `source_schedule_id` a la tabla appointments:

```sql
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source_schedule_id INT DEFAULT NULL
```

Cuando se materializa un appointment (desde reminder o desde admin), setear `source_schedule_id = recurring_schedule.id`.

En la UI de Appointments, si `source_schedule_id` no es null, mostrar un pequeño ícono de repeat (Repeat de lucide-react, tamaño 14px, color blue-500) junto a la fecha de la cita.

---

## PARTE 9: Retention service — integrar recurrencia

En `server/services/retention.js`, modificar `calculateRetentionStatus`:

Agregar un nuevo parámetro `hasActiveRecurring` (boolean). Si el cliente tiene un recurring_schedule activo:
- NUNCA puede ser "En riesgo" ni "Perdido" — está comprometido semanalmente
- Si tiene schedule activo → status = "Recurrente" (nuevo status de retención)
- Si tiene schedule pausado → status = "En pausa" (ya existe)

Esto cambia la lógica de retención para que los clientes recurrentes nunca aparezcan como en riesgo mientras su schedule esté activo.

En `server/routes/clients.js` y `server/routes/analytics.js`, pasar este flag al calcular retención:

```js
// En el query de clientes, agregar subquery:
(SELECT COUNT(*) FROM recurring_schedules
 WHERE client_id = c.id AND tenant_id = ? AND ended_at IS NULL AND paused_at IS NULL) as has_active_recurring
```

Y pasarlo a `calculateRetentionStatus({ ..., hasActiveRecurring: client.has_active_recurring > 0 })`.

---

## PARTE 10: Voice — activar/desactivar recurrencia por voz

En `server/services/voice/parseCommand.js`, agregar detección de intents:

- `"Fulano entra a modo repetir"` → intent: `activate_recurring`, entity: client name
- `"Activar semanal para Fulano los martes a las 10"` → intent: `activate_recurring`, entities: client name, day, time
- `"Fulano sale de modo repetir"` → intent: `deactivate_recurring`, entity: client name
- `"Pausar recurrencia de Fulano"` → intent: `pause_recurring`, entity: client name
- `"Reactivar a Fulano"` → intent: `resume_recurring`, entity: client name

En `server/services/voice/executeCommand.js`, implementar estos intents:

Para `activate_recurring`:
1. Buscar cliente por nombre (fuzzy match, como ya se hace para otros intents)
2. Si es ambiguo → pedir aclaración (patrón existente)
3. Si no se especificó día/hora → preguntar: "¿Qué día y a qué hora es la sesión semanal de [Nombre]?"
4. Si se especificó → POST a /api/recurring con los datos
5. Responder: "Listo, [Nombre] ahora tiene sesión semanal los [día] a las [hora]."

Para `deactivate_recurring`:
1. Buscar cliente → buscar su schedule activo → PUT /api/recurring/:id/end
2. Responder: "Listo, se desactivó la recurrencia de [Nombre]."

---

## Reglas técnicas OBLIGATORIAS

1. **NUNCA crear filas infinitas de appointments** — solo materializar cuando se interactúa.
2. **`dns.setDefaultResultOrder('ipv4first')` DEBE seguir siendo la primera línea de `server/db.js`**.
3. **`type="button"` en TODOS los `<button>` que no sean submit de form.**
4. **Textos en español**: caracteres directos (ó, é, í, á, ú, ñ, ¿, ¡), NUNCA unicode escapes.
5. **NO emojis en la UI** (excepto banderas).
6. **Timezone**: toda hora es America/La_Paz. En server usar `toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })`. En BD el campo `time` de recurring_schedules es hora Bolivia directa.
7. **Multi-tenant**: todo query debe filtrar por `tenant_id`.
8. **Transacciones**: materializar appointment debe ser atómico (GCal + BD).
9. **NO romper nada existente** — booking público, slots, recordatorios actuales deben seguir funcionando idéntico.
10. **Fonts y padding**: no cambiar. Fonts +2pt ya aplicados. Mobile padding 12px, >=520px 24px.
11. **Después de cambios en client/**: correr `cd client && npm run build` y commitear `client/dist/`.
12. **`express.static()` con `fs.existsSync()` guard** obligatorio si se agrega algo de static.
13. **El `projected_monthly_recurring` se calcula como**: SUM(fee de clientes recurrentes activos) × 4.33 (semanas promedio por mes).

---

## Orden de implementación sugerido

1. Tabla en db.js + migraciones
2. `server/routes/recurring.js` (CRUD + upcoming + materialize)
3. Montar rutas en server/index.js
4. Modificar `server/services/reminder.js` (Try 3: recurring match + auto-materialize)
5. `server/services/recurringSync.js` + cron en scheduler
6. Migración: `ALTER TABLE appointments ADD COLUMN source_schedule_id`
7. Modificar `server/services/retention.js` + queries en clients.js y analytics.js
8. Modificar `server/routes/analytics.js` (métricas de recurrencia)
9. Frontend: Dashboard.jsx (agenda viva + KPI)
10. Frontend: Clients.jsx (badge + sección de recurrencia con form manual de día/hora)
11. Frontend: Analytics.jsx (sección de recurrencia y churn)
12. Frontend: Appointments.jsx (ícono de repeat)
13. Voice: parseCommand.js + executeCommand.js
14. Build client: `cd client && npm run build`

---

## Archivos a crear
- `server/routes/recurring.js`
- `server/services/recurringSync.js`

## Archivos a modificar
- `server/db.js` (tabla + migración source_schedule_id)
- `server/index.js` (montar ruta /api/recurring)
- `server/services/reminder.js` (Try 3 matching)
- `server/services/retention.js` (integrar hasActiveRecurring)
- `server/cron/scheduler.js` (cron de sync)
- `server/routes/analytics.js` (métricas recurrencia)
- `server/routes/clients.js` (subquery has_active_recurring)
- `server/services/voice/parseCommand.js` (intents de recurrencia)
- `server/services/voice/executeCommand.js` (ejecución de intents)
- `client/src/pages/Admin/Dashboard.jsx` (agenda viva + KPI recurrente)
- `client/src/pages/Admin/Clients.jsx` (badge + sección recurrencia + form manual)
- `client/src/pages/Admin/Analytics.jsx` (sección recurrencia y churn)
- `client/src/pages/Admin/Appointments.jsx` (ícono repeat)
