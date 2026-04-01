# Análisis: Empezar de Cero vs. Refactorear — Booking App

## Para quién es este documento
Daniel MacLean, psicólogo. Necesita decidir si crear un nuevo repo desde cero o evolucionar el repo actual. La otra instancia de Claude ejecutará lo que se decida.

---

## Estado actual en números

- **~3,750 líneas** de código total (server + client)
- **7 pantallas** de booking flow funcionando
- **4 integraciones externas** configuradas: MySQL Hostinger, Google Calendar, WhatsApp Cloud API, IP geolocation
- **3 bugs activos**: QR desaparecen, window_days ignorado, horas de hoy vacías
- **Tiempo invertido**: ~2 semanas de desarrollo + debugging

---

## OPCIÓN A: Empezar de Cero (nuevo repo)

### Pros reales

1. **Arquitectura limpia desde el día 1.** No hay que "desenredar" un BookingFlow.jsx de 1,189 líneas. Se diseña con capa de servicios, archivos pequeños, hooks separados desde el inicio. Prevención en vez de curación.

2. **Nombre y branding propio.** El repo actual se llama `whatsapp-reminder-engine` (nombre legacy de cuando era solo un motor de recordatorios en Render). Un nuevo repo con nombre comercial (`novum-booking`, `psicoterapia-app`, lo que sea) se siente más profesional.

3. **Sin deuda técnica heredada.** No hay:
   - Carpeta `src/` duplicada de Render que nadie usa
   - `client/dist/` commiteado en git (2+ MB de bundle en el historial)
   - Timezone hacks con `toLocaleString()` que funcionan "de casualidad"
   - Variables de estado sueltas (18 useState + useReducer mezclados)
   - Catch blocks vacíos que tragan errores silenciosamente

4. **Oportunidad de elegir mejor desde el inicio:**
   - `date-fns-tz` para timezone desde la primera línea
   - shadcn/ui para el admin desde el primer componente
   - Validación con zod en cada endpoint
   - Transaction wrapper en cada operación GCal+DB
   - Soft delete desde la primera migración

5. **CLAUDE.md fresco.** Se escribe un CLAUDE.md nuevo que refleja la arquitectura nueva, no un documento que acumula parches y "lecciones aprendidas de bugs que ya no existen."

6. **Psicológicamente satisfactorio.** Después de 5 horas en un bug de `type="button"` y bugs que aparecen al arreglar otros, empezar limpio da energía.

### Contras reales

1. **Las integraciones hay que re-cablear.** Los env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, WA_TOKEN, WA_PHONE_ID, WABA_ID, JWT_SECRET, DB credentials) ya están configurados en Hostinger para el repo actual. Un nuevo repo necesita:
   - Nuevo deployment en Hostinger apuntando al nuevo repo
   - Re-configurar las mismas env vars (copiar/pegar, ~15 minutos)
   - Verificar que el webhook de Meta apunte al nuevo URL (o mantener el mismo dominio)
   - **Riesgo bajo** pero hay que hacerlo sin romper nada

2. **La lógica de negocio hay que reescribirla.** Son ~500 líneas de lógica probada:
   - `createBooking()`: verificar slot libre → crear evento GCal → insertar appointment → actualizar status cliente → calcular session_number
   - `createClient()`: lookup de fee por ciudad capital
   - Slot calculation: available_hours × available_days × buffer × break × GCal busy ranges
   - Reminder: query GCal → match con DB → dedup 24h → enviar template
   - Phone check: new / returning / has_appointment

   Reescribir esto no es difícil (yo no me canso), pero cada línea fue probada en producción. Reescribirla introduce la posibilidad de bugs nuevos en código que hoy funciona.

3. **Los datos están en MySQL.** La base de datos NO cambia — es la misma independientemente del repo. Pero el schema (`CREATE TABLE IF NOT EXISTS` en db.js) tiene que ser idéntico o compatible. Si cambias el schema (agregar `deleted_at`, cambiar enums), necesitas migration scripts.

4. **Período de transición.** Mientras construyes el nuevo, el viejo sigue en producción. Si un cliente agenda durante la transición, los datos están en la misma DB. Hay que garantizar que el nuevo código lee los mismos datos correctamente.

5. **~4-6 horas para llegar al mismo punto funcional.** No es mucho, pero es tiempo real:
   - Server con capa de servicios + rutas + middleware: ~2 horas
   - Client con BookingFlow split + Calendar + timezone: ~2 horas
   - Admin básico (CRUD funcional, no premium aún): ~1 hora
   - Testing + debugging de las integraciones: ~1 hora
   - Admin premium con shadcn/ui + analytics: +3-4 horas adicionales

6. **El CLAUDE.md actual es valioso.** Tiene documentados: el flujo completo, las reglas de Hostinger (dns.setDefaultResultOrder), las reglas de webhooks (subscribed_apps), las reglas de texto español, el formato de eventos GCal, rate limiting, dev mode bypass. Todo esto hay que transferir al nuevo proyecto.

---

## OPCIÓN B: Refactorear en el repo actual

### Pros reales

1. **La app nunca baja.** Cada cambio es un commit que se deploya. No hay "período de transición."

2. **Código probado se conserva.** Las 500 líneas de lógica de negocio que funcionan en producción no se tocan — solo se mueven de archivo.

3. **Env vars, webhooks, deploy pipeline intactos.** Cero riesgo de perder configuración.

4. **Incremental.** Puedes hacer una fase, probar, y parar. Con un rebuild, hasta que no esté todo, no sirve.

### Contras reales

1. **Disciplina de no "arreglar de paso."** Cada refactor tiene la tentación de cambiar lógica mientras mueves código. Esto es exactamente lo que causa "arreglar una cosa rompe otra."

2. **El historial de git queda sucio.** 2+ MB de `client/dist/` en cada commit, carpeta `src/` muerta, nombres de variables viejos.

3. **El nombre del repo sigue siendo `whatsapp-reminder-engine`.** Se puede renombrar en GitHub, pero el historial lo refleja.

4. **CLAUDE.md sigue acumulando parches.** Es más difícil tener un documento limpio cuando refleja la evolución de bugs.

5. **Mentalmente seguís en "modo parche."** Cada sesión es "arreglar X, refactorear Y." Nunca hay el momento de "diseñar desde cero."

---

## Comparación directa

| Criterio | Desde Cero | Refactorear |
|----------|-----------|-------------|
| Riesgo de bugs nuevos | Medio (reescribes lógica probada) | Bajo (mueves código, no lo cambias) |
| Tiempo hasta feature-parity | 4-6 horas | 0 (ya funciona) |
| Tiempo hasta admin premium | 7-10 horas | 5-8 horas |
| Arquitectura limpia | Garantizada | Depende de disciplina |
| Downtime | Mínimo si se planifica | Cero |
| Riesgo de perder config | Bajo pero existe | Cero |
| Satisfacción / energía | Alta | Media |
| Nombre comercial | Nuevo desde el inicio | Rename posible |

---

## Mi opinión honesta

**Para tu caso específico, empezar de cero tiene más sentido de lo que parece a primera vista.** Razones:

1. **Son 3,750 líneas, no 30,000.** En un proyecto grande, rebuild es suicida. Aquí, un Claude puede reescribir todo en una tarde.

2. **Quieres venderlo.** Un producto vendible necesita arquitectura limpia. Refactorear un monolito de 1,189 líneas es posible, pero empezar con archivos de 100-200 líneas desde el inicio es más natural.

3. **Los env vars se copian.** La parte más dolorosa de setup (Google OAuth, Meta webhooks) ya está hecha. Los tokens/secrets son los mismos independientemente del repo.

4. **La DB es la misma.** MySQL en Hostinger no cambia. El nuevo código apunta a la misma DB con las mismas credenciales.

5. **Tienes CLAUDE.md como especificación.** El documento actual funciona perfectamente como spec para el nuevo proyecto. No empiezas "de cero" en conocimiento — empiezas de cero en código pero con toda la experiencia documentada.

**El riesgo real de empezar de cero es uno solo:** reintroducir bugs en lógica de negocio que hoy funciona (especialmente el cálculo de slots y el flujo de reschedule). Mitigación: copiar las funciones de servicio línea por línea y solo cambiar la estructura alrededor de ellas.

---

## Si decides empezar de cero: Arquitectura propuesta

```
novum-booking/                    (o el nombre que elijas)
├── server/
│   ├── index.js                  (Express setup, route mounting, NADA más)
│   ├── db.js                     (MySQL pool + transaction helper)
│   ├── routes/
│   │   ├── booking.js            (thin: validate → service → respond)
│   │   ├── slots.js
│   │   ├── config.js
│   │   ├── clients.js
│   │   ├── appointments.js
│   │   ├── auth.js
│   │   └── webhook.js            (WhatsApp button responses)
│   ├── services/
│   │   ├── booking.js            (createBooking, reschedule, phone check)
│   │   ├── slots.js              (slot availability calculation)
│   │   ├── calendar.js           (GCal wrapper — copiar tal cual)
│   │   ├── whatsapp.js           (WhatsApp Cloud API — copiar tal cual)
│   │   ├── reminder.js           (cron + send logic)
│   │   └── storage.js            (MySQL BLOB para QR images)
│   └── middleware/
│       ├── auth.js               (JWT verification)
│       └── validate.js           (zod schemas)
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── BookingFlow.jsx   (~200 líneas, orquestador)
│   │   │   └── Admin/
│   │   │       ├── Dashboard.jsx (shadcn/ui desde el inicio)
│   │   │       ├── Analytics.jsx
│   │   │       ├── Config.jsx
│   │   │       ├── Clients.jsx
│   │   │       └── Appointments.jsx
│   │   ├── components/
│   │   │   ├── booking/          (6 screen components, ~150 líneas c/u)
│   │   │   ├── ui/               (shadcn/ui)
│   │   │   └── Calendar.jsx      (copiar y limpiar)
│   │   ├── hooks/
│   │   │   ├── useBookingReducer.js
│   │   │   ├── useSlots.js
│   │   │   └── useConfig.js
│   │   └── utils/
│   │       ├── timezones.js      (copiar tal cual)
│   │       ├── api.js            (fetch wrapper centralizado)
│   │       └── dates.js          (date-fns-tz helpers)
│   └── vite.config.js
├── CLAUDE.md                     (limpio, desde la arquitectura nueva)
└── package.json
```

### Qué se copia textualmente del repo actual
- `server/services/calendar.js` (57 líneas) — wrapper GCal perfecto
- `server/services/whatsapp.js` (92 líneas) — WhatsApp Cloud API perfecto
- `client/src/utils/timezones.js` (150 líneas) — timezone utils
- `client/src/components/Calendar.jsx` (165 líneas) — widget calendario
- Lógica de `createBooking()` y slot calculation (se restructura pero la lógica es la misma)
- Schema de DB (tablas clients, appointments, config, webhooks_log)
- Todas las env vars y secrets

### Qué se reescribe desde cero
- `BookingFlow.jsx` → split en 6 componentes + 3 hooks
- Todo el admin panel → shadcn/ui desde día 1
- Timezone server-side → date-fns-tz en vez de toLocaleString
- QR storage → MySQL BLOB en vez de disco
- Error handling → consistente en todas las rutas
- Webhook handler → respuestas reales a CONFIRM_NOW, REAGEN_NOW, DANIEL_NOW

---

## Admin ULTRA PRO: Visión detallada

### El problema actual
El admin de hoy es una tabla HTML con botones gigantes. No tiene métricas, no tiene gráficos, no tiene UX pensada. Un terapeuta que lo vea como "producto" pensaría: "esto lo hizo un estudiante de primer semestre." No inspira confianza para cobrar por él.

### Qué necesita un admin vendible para terapeutas

#### 1. Dashboard (pantalla principal)

**KPI Cards en la parte superior** (4 cards en fila):
- Sesiones esta semana (número grande + % vs semana pasada, flecha verde/roja)
- Clientes activos (total + nuevos este mes)
- Tasa de asistencia (% de citas completadas vs no-show+canceladas)
- Ingresos estimados del mes (suma de fees de citas completadas)

**Gráfico principal** (ocupa el ancho):
- Sesiones por semana (últimas 12 semanas), barras apiladas por status (completada/cancelada/no-show/reagendada)
- Toggle para ver por mes en vez de por semana

**Citas de hoy** (tabla compacta):
- Hora, nombre cliente, teléfono (clickeable para WhatsApp), status con badge de color
- Botón de acción rápida: marcar como completada, no-show, o cancelada
- Si no hay citas: estado vacío con ilustración sutil "No hay sesiones programadas para hoy"

**Próximos 7 días** (mini calendario visual):
- Cada día muestra cuántas citas hay (pill con número)
- Click abre la lista de citas de ese día

**Actividad reciente** (feed/timeline):
- "María López reagendó su cita de Mar 28 → Abr 2"
- "Nuevo cliente: Carlos Pérez (Cochabamba)"
- "Recordatorio enviado a 5 pacientes"
- Últimos 10 eventos, con timestamps relativos ("hace 2 horas")

#### 2. Clientes (CRM de consultorio)

No es un CRM de ventas (sin leads, sin pipeline, sin oportunidades). Es gestión de pacientes: llegan porque te buscaron, aceptaron tus términos, y agendan. El CRM responde: quiénes son, cómo van, quién paga, quién desaparece.

**Campos por cliente:**

| Campo | Tipo | Notas |
|-------|------|-------|
| Nombre / Apellido | texto | obligatorio |
| Teléfono | texto | único, con código país |
| Edad | número | calculado si hay fecha nacimiento |
| Ciudad | dropdown | Cochabamba, Santa Cruz, La Paz, Sucre, Otro |
| País | dropdown | pre-seleccionado Bolivia |
| Modalidad | dropdown | Presencial / Online / Mixto |
| Frecuencia | dropdown | Semanal / Quincenal / Mensual / Irregular |
| Fuente | dropdown | Instagram, Referido, Google, Sitio web, Otro |
| Referido por | texto (opcional) | nombre de quien lo refirió |
| Arancel | número editable | override manual por cliente |
| Método de pago | dropdown | QR, Efectivo, Transferencia |
| Calificación | estrellas 1-5 | valoración del terapeuta (adherencia, compromiso, etc.) |
| Notas generales | textarea | observaciones libres del terapeuta |
| Diagnóstico/motivo | texto (opcional) | motivo de consulta (privado, solo admin) |

**Status automáticos (calculados, no manuales):**

| Status | Regla | Color |
|--------|-------|-------|
| Nuevo | registrado, 0 sesiones completadas | azul |
| Activo | tiene cita futura O última sesión < 3 semanas | verde |
| En pausa | sin cita futura Y última sesión entre 3-8 semanas | amarillo |
| Inactivo | sin cita futura Y última sesión > 8 semanas | gris |
| Recurrente | 10+ sesiones completadas Y activo | verde con badge |
| Archivado | marcado manualmente (soft delete) | tachado |

El terapeuta NO tiene que cambiar status a mano — el sistema lo calcula. Pero puede override manual (ej: marcar como Archivado).

**Métricas automáticas por cliente (calculadas, no editables):**
- Total sesiones completadas
- Fecha primera sesión
- Fecha última sesión
- Días desde última sesión
- Tasa de asistencia (% completadas vs total agendadas)
- Total reagendamientos
- Total pagado (suma de pagos registrados)
- Deuda pendiente (sesiones sin pago confirmado)

**Vista tabla:**
- Columnas configurables (elegir cuáles mostrar)
- Sorteable por cualquier columna
- Filtros: status, ciudad, modalidad, calificación, fuente
- Búsqueda por nombre/teléfono
- Bulk actions: cambiar status, exportar CSV

**Vista detalle (panel lateral slide-in):**
- Datos personales editables
- Calificación con estrellas (click para cambiar)
- Historial de citas (tabla: fecha, status, notas de sesión)
- Historial de pagos (tabla: fecha, monto, método, comprobante)
- Notas del terapeuta por sesión + generales
- Botón: "Enviar WhatsApp" (abre campo de mensaje)
- Botón: "Agendar cita" (abre selector de horario)

**Acciones:**
- Crear cliente manual (modal)
- Soft delete → "Archivado" (recuperable)
- Exportar a CSV
- Exportar ficha individual (PDF con historial)

#### 3. Citas (Agenda)

**Vista grid/tabla** (sin vista calendario):
- Tabla con columnas: Fecha/Hora, Cliente, Teléfono, Status, Notas
- Filtros: rango de fechas (desde/hasta), status (dropdown), búsqueda por cliente
- Sorteable por cualquier columna
- Paginación

**Acciones rápidas:**
- Cambiar status con un click (dropdown en la celda)
- Agregar nota a la cita
- Reagendar desde el admin (botón → abre selector de nuevo horario)
- Cancelar con opción de notificar al cliente por WhatsApp

**Citas pasadas:**
- Historial completo con búsqueda
- Filtro por rango de fechas
- Resumen mensual: "Marzo 2026: 45 sesiones, 3 no-shows, 2 cancelaciones"

#### 4. Analytics (página dedicada)

**Métricas por período** (selector: esta semana / este mes / último trimestre / custom):

- **Sesiones:** total, completadas, canceladas, no-show, reagendadas
- **Clientes:** nuevos vs recurrentes, tasa de retención (% que vuelve después de 1a sesión)
- **Ingresos:** total facturado, promedio por sesión, por ciudad
- **Horarios más demandados:** heatmap de lunes-domingo × 8:00-21:00 (qué horas se llenan más rápido)
- **Fuente de clientes:** pie chart (Instagram, referido, Google, otro)
- **Ciudades:** bar chart horizontal
- **Tendencia mensual:** line chart de sesiones por mes (últimos 12 meses)
- **Tasa de reagendamiento:** % de citas que se reagendan, tendencia over time

**Exportar:** botón para descargar reporte PDF o CSV del período seleccionado

#### 5. Configuración (mejorada)

**Horarios:**
- Grid visual: filas = horas (8:00-21:00), columnas = días (Lun-Dom)
- Click en celda para activar/desactivar hora
- Drag para seleccionar rango ("8:00 a 12:00 de lunes a viernes" en un gesto)
- "Copiar a otros días" con checkboxes

**Parámetros:**
- Ventana de días (slider visual, no solo input)
- Buffer entre citas (slider)
- Duración de cita (selector: 45min, 60min, 90min)
- Break (selector visual de rango horario)
- Edades: min/max con slider dual

**Aranceles:**
- Tabla de precios por ciudad con edición inline
- Arancel genérico (default)
- Campo "descuento" por porcentaje (opcional)

**QR de pago:**
- 4 slots con preview grande
- Upload con drag & drop
- Preview instantáneo
- Almacenados en MySQL (persisten entre deploys)

**Recordatorios:**
- Hora de envío (actualmente fijo 18:40, hacerlo configurable)
- Preview del mensaje template
- Toggle: activar/desactivar recordatorios
- Historial: últimos 20 recordatorios enviados (fecha, destinatario, status)

#### 6. WhatsApp (centro de mensajes)

**Vista lista (panel izquierdo):**
- Lista de clientes que han interactuado recientemente, ordenados por timestamp
- Cada fila: nombre, último mensaje/acción, hora relativa ("hace 2h")
- Badge de color por tipo: "Confirmo" (verde), "Reagendar" (amarillo), "Hablar" (rojo)
- No-leídos resaltados (bold + indicador)

**Vista detalle (panel derecho, al hacer click en cliente):**
- Historial cronológico de interacciones con ese cliente:
  - "Recordatorio enviado — Mar 27, 18:40"
  - "Cliente picó: Confirmo asistencia — Mar 27, 19:02"
  - "Auto-respuesta enviada: Perfecto, te esperamos — Mar 27, 19:02"
- Campo de texto para escribir mensaje manual (texto libre)
- Botón enviar → usa WhatsApp Cloud API `sendTextMessage()`

**Auto-respuestas (configurables en Config → Recordatorios):**
- "Confirmo asistencia" → "Perfecto [nombre], te esperamos el [día] a las [hora]"
- "Reagendar" → "Puedes reagendar tu cita aquí: [link a la app]"
- "Hablar con Daniel" → "Daniel te contactará pronto" + notificación en el dashboard

**Mensajes rápidos:**
- Templates predefinidos editables: "Tu cita es mañana a las X", "Por favor confirma tu asistencia", etc.
- Botón "Enviar a todos los de mañana" (broadcast de recordatorio manual)

#### 7. Contabilidad (módulo financiero)

**Dashboard financiero (cards superiores):**
- Ingresos del mes (suma de pagos confirmados)
- Ingresos del trimestre
- Pendiente de cobro (sesiones completadas sin pago confirmado)
- Ingreso neto (después de deducciones)

**Deducciones configurables:**
- Tabla de deducciones con % y nombre: "Alquiler consultorio: 15%", "Impuestos: 13%", "Plataforma: 5%"
- Agregar/editar/eliminar deducciones
- Se aplican al cálculo de ingreso neto automáticamente

**Gráficos:**
- Ingresos por mes (barras, últimos 12 meses)
- Ingresos por trimestre (barras agrupadas)
- Ingreso bruto vs neto (líneas superpuestas)
- Distribución por método de pago (pie: QR, Efectivo, Transferencia)
- Clientes con deuda (tabla: nombre, monto, días de atraso)

**Registro de pagos:**
- Tabla: Fecha, Cliente, Monto, Método, Comprobante (thumbnail), Status
- Filtros por fecha, cliente, método, status (Confirmado/Pendiente/Rechazado)
- Cada sesión completada genera automáticamente un registro de pago "Pendiente"
- Al subir comprobante → OCR extrae monto → marca como "Confirmado" si coincide

**Goals (metas financieras):**
- Meta mensual configurable (ej: Bs 15,000)
- Barra de progreso visual: "Llevas Bs 8,500 / 15,000 (57%)"
- Texto inteligente: "Te faltan 26 sesiones de Bs 250 para llegar a tu meta" (calcula automáticamente según mix de aranceles)
- Variante: "O 22 sesiones de Bs 300" — muestra combinaciones posibles
- Meta vs real de meses anteriores (barras comparativas)

**Deuda / Obligaciones:**
- Campo configurable: "Deuda bancaria" con monto total y cuota mensual
- Progreso: "Con lo ganado este mes cubres X% de tu cuota"
- Alerta si al ritmo actual no llegas a cubrir la cuota antes de fin de mes
- Múltiples obligaciones: alquiler, préstamo, impuestos, etc.

**Semanas lectivas (vista tipo Excel):**
- 4 semanas recientes lado a lado como cards/columnas:
  - Semana 1 (Mar 3-7): Bs 2,500 — 10 sesiones
  - Semana 2 (Mar 10-14): Bs 3,000 — 12 sesiones
  - Semana 3 (Mar 17-21): Bs 1,750 — 7 sesiones
  - Semana actual (Mar 24-28): Bs 2,000 — 8 sesiones (en curso)
- Comparativa visual: barras de altura proporcional
- Promedio semanal calculado
- Semanas anteriores a las 4 recientes → pasan a grilla tipo Excel (tabla scrolleable con todas las semanas del año)

**Sincronización con Google Sheets (NO exportar):**
- En vez de exportar CSV/PDF, las tablas clave se sincronizan automáticamente con Google Sheets
- Sheets se actualizan periódicamente (cada hora o al guardar cambios)
- Tablas sincronizadas: Clientes, Citas, Pagos, Resumen semanal/mensual
- Usa la misma cuenta de Google que ya tenemos (googleapis ya configurado para GCal)
- El terapeuta puede compartir la Sheet con su contador directamente
- Sheets es de solo lectura (source of truth es la MySQL, Sheets es espejo)

**Nota:** Ya tenemos `googleapis` como dependencia y OAuth configurado para GCal. Google Sheets API usa las mismas credenciales — solo hay que habilitar la Sheets API en el mismo proyecto de Google Cloud Console y agregar el scope.

#### 8. OCR de Comprobantes de Pago

**Flujo:**
1. Cliente envía foto de comprobante por WhatsApp (o terapeuta lo sube manualmente)
2. Imagen se envía a API de reconocimiento (Google Vision API — free tier: 1,000 imágenes/mes)
3. OCR extrae: monto, fecha, referencia de transacción
4. Sistema cruza: ¿hay un pago pendiente de este cliente por este monto?
5. Si match → marca pago como "Confirmado" automáticamente
6. Si no match → muestra al terapeuta para confirmar manualmente

**En el admin:**
- En la vista detalle de cliente → sección "Pagos" → botón "Subir comprobante"
- Preview de la imagen + datos extraídos por OCR
- Botón "Confirmar" o "Corregir monto"
- Historial de comprobantes asociados a cada pago

**Alternativa a Google Vision:**
- Tesseract.js (open source, corre en Node) — gratis pero menos preciso con comprobantes bolivianos
- Google Vision API — más preciso, 1,000 gratis/mes, suficiente para un consultorio
- **Recomendación:** empezar con Google Vision, es un API key más

#### 9. Branding por Centro/Terapeuta

**Cuando el producto se vende a otro terapeuta:**
- Cada "centro" o terapeuta tiene su propio branding:
  - Logo (upload)
  - Nombre del centro/consultorio
  - Colores primario y secundario (color picker)
  - Texto de bienvenida personalizado
  - Slug URL: `app.novum.com/dr-martinez` (o subdomain)
- El booking flow del cliente muestra el branding del terapeuta
- El admin muestra el logo del centro en el sidebar
- WhatsApp templates pueden incluir nombre del centro

**Tabla `tenants`:**
- id, name, slug, logo_url, primary_color, secondary_color, welcome_text
- Cada terapeuta pertenece a un tenant
- Multi-tenant desde el inicio de la arquitectura (FK tenant_id en todas las tablas)

### Stack técnico para el admin

**shadcn/ui** — La base de todos los componentes:
- `Card` para KPI cards
- `Table` + `DataTable` para tablas con sort/filter/pagination
- `Dialog` / `Sheet` para modales y paneles laterales
- `Select`, `Input`, `Textarea` para formularios
- `Badge` para status con colores
- `Tabs` para navegación dentro de páginas
- `Calendar` (shadcn tiene uno) para vista de agenda
- `DropdownMenu` para acciones rápidas

**Recharts** (ya compatible con shadcn/ui):
- Bar charts para sesiones por semana/mes
- Line charts para tendencias
- Pie charts para distribución por fuente/ciudad
- Heatmap (custom) para horarios demandados

**Diseño visual:**
- Sidebar fija a la izquierda (no navbar arriba): Dashboard, Clientes, Citas, Analytics, Config, WhatsApp
- Header con nombre del terapeuta + notificaciones
- Dark mode toggle (shadcn lo soporta nativamente)
- Responsive: sidebar se colapsa en mobile a hamburger menu
- Colores: palette profesional (no los azules genéricos de Bootstrap)
- Tipografía: Inter o similar (limpia, moderna)

### Lo que convierte esto en "vendible"

1. **First impression:** Un terapeuta abre el dashboard y ve sus KPIs con flechas de tendencia. Se siente profesional, como Stripe Dashboard o Notion.
2. **Autoservicio:** No necesita llamar a nadie para cambiar horarios, ver estadísticas, o gestionar clientes.
3. **WhatsApp integrado:** La killer feature. Recordatorios automáticos + respuestas a botones. Ningún competidor barato en Bolivia tiene esto.
4. **Datos accionables:** "El 30% de tus citas son reagendadas los lunes" → el terapeuta puede decidir reducir horario los lunes.
5. **Mobile-friendly:** Puede revisar su día desde el teléfono mientras camina al consultorio.

---

## Decisión final: REBUILD DESDE CERO

**Nuevo repo:** `Dran9/agenda3.0` (ya creado en GitHub)
**Repo anterior:** `Dran9/whatsapp-reminder-engine` (se conserva funcionando "a media fuerza", no se borra)
**Nueva MySQL:** Crear nueva base de datos en otro site/entorno de Hostinger. La DB anterior queda intacta para el repo viejo.

---

## Schema MySQL completo (10 tablas)

Todas las tablas tienen `tenant_id` para multi-tenant desde el inicio.

### 1. `tenants`
```sql
CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  logo_key VARCHAR(50),
  primary_color VARCHAR(7) DEFAULT '#2563eb',
  secondary_color VARCHAR(7) DEFAULT '#1e40af',
  welcome_text TEXT,
  domain VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 2. `clients`
```sql
CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  age INT,
  city ENUM('Cochabamba','Santa Cruz','La Paz','Sucre','Otro') DEFAULT 'Cochabamba',
  country VARCHAR(50) DEFAULT 'Bolivia',
  timezone VARCHAR(50) DEFAULT 'America/La_Paz',
  modality ENUM('Presencial','Online','Mixto') DEFAULT 'Presencial',
  frequency ENUM('Semanal','Quincenal','Mensual','Irregular') DEFAULT 'Semanal',
  source ENUM('Instagram','Referido','Google','Sitio web','Otro') DEFAULT 'Otro',
  referred_by VARCHAR(200),
  fee DECIMAL(10,2) DEFAULT 250.00,
  payment_method ENUM('QR','Efectivo','Transferencia') DEFAULT 'QR',
  rating TINYINT DEFAULT 0,
  diagnosis TEXT,
  notes TEXT,
  status_override VARCHAR(20),
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_phone_tenant (phone, tenant_id),
  KEY idx_tenant (tenant_id),
  KEY idx_deleted (deleted_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```
**Status se CALCULA en server** (Nuevo/Activo/En pausa/Inactivo/Recurrente). Solo `status_override` permite forzar "Archivado".

### 3. `appointments`
```sql
CREATE TABLE IF NOT EXISTS appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  client_id INT NOT NULL,
  date_time DATETIME NOT NULL,
  duration INT DEFAULT 60,
  gcal_event_id VARCHAR(255),
  status ENUM('Confirmada','Reagendada','Cancelada','Completada','No-show') DEFAULT 'Confirmada',
  is_first BOOLEAN DEFAULT FALSE,
  session_number INT DEFAULT 1,
  phone VARCHAR(20),
  notes TEXT,
  user_agent VARCHAR(500),
  confirmed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  KEY idx_client (client_id),
  KEY idx_datetime (date_time),
  KEY idx_status (status),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

### 4. `config` (una fila por tenant)
```sql
CREATE TABLE IF NOT EXISTS config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL UNIQUE,
  available_hours JSON,
  available_days JSON,
  window_days INT DEFAULT 10,
  buffer_hours INT DEFAULT 3,
  appointment_duration INT DEFAULT 60,
  break_start VARCHAR(5) DEFAULT '13:00',
  break_end VARCHAR(5) DEFAULT '14:00',
  min_age INT DEFAULT 12,
  max_age INT DEFAULT 80,
  default_fee DECIMAL(10,2) DEFAULT 250.00,
  capital_fee DECIMAL(10,2) DEFAULT 300.00,
  capital_cities VARCHAR(255) DEFAULT 'Santa Cruz,La Paz',
  reminder_time VARCHAR(5) DEFAULT '18:40',
  reminder_enabled BOOLEAN DEFAULT TRUE,
  auto_reply_confirm TEXT DEFAULT 'Perfecto {{nombre}}, te esperamos el {{dia}} a las {{hora}}',
  auto_reply_reschedule TEXT DEFAULT 'Puedes reagendar tu cita aquí: {{link}}',
  auto_reply_contact TEXT DEFAULT 'Daniel te contactará pronto',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

### 5. `payments`
```sql
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  client_id INT NOT NULL,
  appointment_id INT,
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('QR','Efectivo','Transferencia') DEFAULT 'QR',
  status ENUM('Pendiente','Confirmado','Rechazado') DEFAULT 'Pendiente',
  receipt_file_key VARCHAR(50),
  ocr_extracted_amount DECIMAL(10,2),
  ocr_extracted_ref VARCHAR(100),
  notes TEXT,
  confirmed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  KEY idx_client (client_id),
  KEY idx_status (status),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);
```

### 6. `deductions`
```sql
CREATE TABLE IF NOT EXISTS deductions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

### 7. `financial_goals`
```sql
CREATE TABLE IF NOT EXISTS financial_goals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  type ENUM('meta_mensual','deuda') NOT NULL,
  name VARCHAR(200) NOT NULL,
  target_amount DECIMAL(10,2) NOT NULL,
  monthly_payment DECIMAL(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

### 8. `files` (QR, recibos, logos — MySQL BLOB)
```sql
CREATE TABLE IF NOT EXISTS files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  file_key VARCHAR(100) NOT NULL,
  data MEDIUMBLOB NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  original_name VARCHAR(255),
  size_bytes INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_key_tenant (file_key, tenant_id),
  KEY idx_tenant (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

### 9. `webhooks_log` (actividad + dedup de reminders)
```sql
CREATE TABLE IF NOT EXISTS webhooks_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  event VARCHAR(100) NOT NULL,
  type ENUM('reminder_sent','button_reply','message_sent','booking','reschedule','cancel','client_new','status_change') NOT NULL,
  payload JSON,
  status ENUM('enviado','recibido','error','procesado') DEFAULT 'enviado',
  client_phone VARCHAR(20),
  client_id INT,
  appointment_id INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  KEY idx_type (type),
  KEY idx_phone (client_phone),
  KEY idx_created (created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

### 10. `wa_conversations` (inbox WhatsApp)
```sql
CREATE TABLE IF NOT EXISTS wa_conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  client_id INT,
  client_phone VARCHAR(20) NOT NULL,
  direction ENUM('inbound','outbound') NOT NULL,
  message_type ENUM('text','button_reply','template','auto_reply') NOT NULL,
  content TEXT,
  button_payload VARCHAR(50),
  wa_message_id VARCHAR(100),
  is_read BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tenant (tenant_id),
  KEY idx_client (client_id),
  KEY idx_phone (client_phone),
  KEY idx_read (is_read),
  KEY idx_created (created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

### Relaciones
```
tenants (1) → (N) clients, appointments, payments, deductions,
                   financial_goals, files, webhooks_log, wa_conversations
tenants (1) → (1) config
clients (1) → (N) appointments, payments, wa_conversations
appointments (1) → (0..1) payments
```

### Seed data (Daniel como primer tenant)
```sql
INSERT INTO tenants (name, slug, domain) VALUES ('Daniel MacLean', 'daniel', 'plum-rhinoceros-787093.hostingersite.com');

INSERT INTO config (tenant_id, available_hours, available_days) VALUES (
  1,
  '{"lunes":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"martes":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"miercoles":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"jueves":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"],"viernes":["08:00","09:00","10:00","11:00","12:00","16:00","17:00","18:00","19:00","20:00"]}',
  '["lunes","martes","miercoles","jueves","viernes"]'
);
```

---

## Siguiente paso

La otra instancia de Claude toma este documento como especificación completa:
1. Implementar `server/db.js` con el schema de arriba (10 tablas + seed)
2. Copiar del repo anterior: `calendar.js`, `whatsapp.js`, `timezones.js`, `Calendar.jsx`
3. Exportar env vars del site anterior y configurar en el nuevo site de Hostinger
4. Crear nueva MySQL en el nuevo site de Hostinger
5. Verificar que webhook de Meta apunte al nuevo URL (plum-rhinoceros-787093.hostingersite.com)
