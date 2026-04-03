# Voice Shortcut

## Scope

Módulo aislado para control administrativo por voz o texto.

- Canal: Shortcut de iPhone / Mac
- Entradas: audio y texto
- Auth: token secreto
- Salida: texto corto, operativo, más lectura en voz si el Shortcut la usa
- Seguridad: aislado del flujo público y del flujo cliente

## Endpoint

- `POST /api/voice/shortcut`

Headers:

- `x-voice-token: <VOICE_ADMIN_TOKEN>`

Accepted input:

- `multipart/form-data` con archivo `audio`
- campo opcional `text`
- o JSON con `text`

## Comandos Soportados

- agenda de hoy / mañana / fecha explícita
- pagos pendientes
- monto pendiente por cobrar
- cuántas sesiones faltan para llegar a una meta
- buscar cliente por nombre
- próximas citas de un cliente
- revisar si se envió recordatorio a un cliente
- revisar si un cliente confirmó
- listar reagendados
- contar clientes nuevos por mes
- ver no confirmados de mañana
- ver confirmados de hoy
- contar citas de esta semana
- crear una cita para un cliente existente con fecha y hora explícitas
- activar recordatorios
- desactivar recordatorios
- mandar recordatorios para hoy
- mandar recordatorios para mañana
- ajustar disponibilidad por día, mañana y tarde

## Frases de Ejemplo

- `qué citas tengo hoy`
- `agenda de mañana`
- `pagos pendientes`
- `cuántas sesiones necesito para llegar a 5000`
- `buscar a Octavia Quiroga`
- `próximas citas de Juan Pérez`
- `has enviado recordatorio a Ana Faby`
- `ha confirmado Patricia`
- `quiénes han reagendado`
- `cuántos nuevos tuve en marzo`
- `cuánto dinero pendiente tengo`
- `quiénes no han confirmado mañana`
- `quiénes confirmaron hoy`
- `cuántas citas tengo esta semana`
- `crea evento el 10 de abril a las 8 para Cecilia de Ugarte`
- `activar recordatorios`
- `desactivar recordatorios`
- `manda recordatorios para hoy`
- `manda recordatorios para mañana`
- `el jueves solo voy a trabajar de 8 a 12 en la mañana, en la tarde nada`
- `el jueves en la mañana de 9 a 12, en la tarde todo igual`
- `el viernes solo de 10 a 19`

## Flujo Sugerido Del Shortcut

1. Pedir texto o usar dictado del sistema en `Ask for Input`
2. `Get Contents of URL`
   - URL: `https://agenda.danielmaclean.com/api/voice/shortcut`
   - Método: `POST`
   - Header:
     - `x-voice-token`
   - Body JSON:
     - `text`
3. Leer `reply_text`
4. Opcional: pronunciar `spoken_text`

## Variables de Entorno

- `GROQ_API_KEY`
- `VOICE_ADMIN_TOKEN`
- `VOICE_ADMIN_TENANT_ID`
- `GROQ_STT_MODEL`
- `GROQ_VOICE_MODEL`

## Notas

- Las acciones que hoy cambian datos son:
  - crear cita para cliente existente
  - activar/desactivar recordatorios
  - disparar recordatorios para hoy o mañana
  - actualizar disponibilidad por día
- Cada petición queda auditada en `voice_commands_log`
- La transcripción de audio y el parseo del comando ocurren en el servidor
