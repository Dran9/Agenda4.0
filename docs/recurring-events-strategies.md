# Eventos repetitivos de Google Calendar

## Lectura rápida

### 1. Sync por ventana
- Un cron lee GCal con recurrencias expandidas.
- Solo guarda en DB una ventana útil, por ejemplo `-90 días / +45 días`.
- Es la mejor opción para arreglar métricas sin llenar Agenda.

### 2. Serie maestra + ocurrencias
- La app guarda una serie recurrente como entidad propia.
- Solo crea ocurrencias cuando entran en ventana operativa.
- Es el modelo más limpio, pero también el más caro de implementar.

### 3. Stats internas + solo próxima cita visible
- La recurrencia alimenta churn y retención en segundo plano.
- Agenda muestra solo la próxima ocurrencia de cada cliente.
- Es visualmente limpio, pero peor para operación y trazabilidad.

## Recomendación

- Primera etapa: `Sync por ventana`
- Futuro: evolucionar a `Serie maestra + ocurrencias` si quieres que las series se administren desde tu app
