# WhatsApp Context Filter

## Objetivo
Reducir ruido en `Agenda 4.0` guardando solo mensajes de WhatsApp relevantes para:

- booking
- reagenda/cancelación/confirmación
- pagos y comprobantes

La idea es que conversaciones casuales o personales no entren al inbox operativo ni disparen OCR o automatizaciones.

## Archivos tocados
- `server/services/messageContext.js`
- `server/routes/webhook.js`

## Qué hace ahora el sistema
Antes de guardar un mensaje entrante, el webhook clasifica su contexto.

Solo se persisten mensajes que entren en una de estas categorías:
- `booking`
- `payment`

Los mensajes clasificados como `noise` se ignoran y no se guardan en MySQL.

## Señales que vuelven un mensaje operativo

### Booking
Se guarda si ocurre al menos una:
- contiene keywords de booking
  - `cita`, `agendar`, `reagendar`, `reprogramar`, `cancelar`, `confirmar`, etc.
- el cliente tiene una cita futura
- hubo ventana operativa reciente de booking
  - por ejemplo templates o auto-replies relacionados con cita en las últimas 24h

### Payment
Se guarda si ocurre al menos una:
- contiene keywords de pago
  - `pago`, `transferencia`, `comprobante`, `qr`, etc.
- el cliente tiene pago pendiente
- hubo ventana operativa reciente de pago
  - por ejemplo QR enviado o recordatorio de pago en las últimas 24h
- es una imagen/documento con contexto de pago

## Qué se ignora
Se descarta sin persistir si:
- es texto sin keywords operativas
- no hay cita futura
- no hay pago pendiente
- no existe ventana operativa reciente
- es imagen/documento sin contexto de pago

Ejemplos típicos a ignorar:
- `hola daniel`
- `gracias`
- `ya hablé con el psiquiatra`
- charla personal sin relación con cita o pago

## Regla para imágenes y documentos
Por defecto, solo se guardan si tienen contexto de pago.

Si no hay contexto de pago:
- no se descargan
- no se guardan
- no se corre OCR

Esto reduce gasto, ruido y falsos positivos.

## Metadata guardada en mensajes válidos
Los mensajes que sí se guardan ahora incluyen metadata en `wa_conversations.metadata`:

- `context_type`
- `classification_reason`
- `context_snapshot`
  - `client_known`
  - `has_future_appointment`
  - `has_pending_payment`
  - `recent_operational_window`
  - `recent_booking_window`
  - `recent_payment_window`

Si el mensaje es comprobante y pasó por OCR, también se guardan:
- `ocr_name`
- `ocr_amount`
- `ocr_date`
- `ocr_reference`
- `ocr_dest_name`
- `ocr_dest_verified`
- `ocr_bank`

## Ventanas operativas actuales
- ventana de revisión: `24h`
- fallback antiguo para OCR contextual: `60 min`

## Orden de decisión actual
1. llega el mensaje
2. se resuelve cliente por teléfono
3. se arma contexto operativo
4. se clasifica el mensaje
5. si es `noise`, se ignora
6. si es `booking` o `payment`, se guarda
7. si es imagen/documento con contexto de pago, además puede correr OCR

## Casos cubiertos
- respuesta a templates de confirmación/reagenda
- textos de booking aunque no haya cita futura todavía
- comprobantes en contexto de pago
- mensajes de clientes con cita futura o pago pendiente aunque no usen keywords exactas

## Limitaciones actuales
- si alguien manda un mensaje operativo muy ambiguo y sin contexto previo, puede ser ignorado
  - ejemplo: `dale`
- la clasificación no usa IA; usa reglas
- la precisión depende de:
  - keywords
  - estado real del cliente
  - historial operativo reciente

## Si algo falla en vida real

### Caso 1: se ignoró un mensaje que sí era importante
Revisar:
- si el cliente tenía cita futura
- si tenía pago pendiente
- si hubo outbound reciente
- si faltan keywords en `messageContext.js`

Posibles ajustes:
- agregar keyword
- ampliar ventana operativa
- hacer más permisiva la rama de booking o payment

### Caso 2: se guardó ruido personal
Revisar:
- si el cliente tenía cita futura o pago pendiente
- si una ventana operativa fue demasiado amplia
- si alguna keyword está demasiado genérica

Posibles ajustes:
- endurecer ventanas
- quitar keywords ambiguas
- separar reglas por `text` vs `image/document`

### Caso 3: no corrió OCR sobre un comprobante válido
Revisar:
- si el mensaje fue clasificado como `payment`
- si había pago pendiente o QR reciente
- si el mime type era compatible

## Cambios hechos en este proceso
- se creó un clasificador central en `server/services/messageContext.js`
- el webhook ahora filtra antes de persistir textos
- el webhook ahora filtra antes de descargar imágenes/documentos
- el OCR ya no corre sobre media irrelevante
- los mensajes operativos guardan metadata de clasificación

## Cómo pedirme cambios después
Si algo no encaja, lo más útil es reportarlo así:

1. qué tipo de mensaje era
2. qué esperabas que pase
3. qué pasó realmente
4. si había cita futura o pago pendiente
5. si era texto, imagen o documento

Con eso se puede ajustar la regla exacta sin tocar el resto del flujo.
