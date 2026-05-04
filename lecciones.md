# Lecciones aprendidas - Agenda 4.0

Este documento registra aprendizajes de bugs reales para no repetir errores en futuras versiones.

## Comprobantes OCR y validacion fuzzy

- No podemos depender solo de la cuenta destino completa. Algunos bancos ya imprimen la cuenta parcialmente cubierta, por ejemplo `301********355`.
- Una cuenta enmascarada debe aceptarse solo si el prefijo y sufijo coinciden de forma unica con una cuenta valida configurada, y ademas el destinatario coincide con senales fuertes de identidad.
- Para Daniel, `Mac Lean`, `Daniel`, `Oscar` y `Estrada` son senales validas cuando aparecen combinadas. `Oscar` solo no basta, porque podria ser otra persona.
- El nombre del originante no es criterio confiable. Muchas veces paga un familiar, pareja, amigo o tarjeta de otra persona.
- El monto, fecha, referencia, banco, destinatario y cuenta enmascarada deben actuar como un conjunto de evidencia, no como una regla unica fragil.
- Si el OCR encuentra una cuenta enmascarada pero el destinatario no es confiable, debe quedar como mismatch/revision, no confirmado automaticamente.
- Agregar tests con ejemplos reales de bancos es obligatorio cada vez que aparece un nuevo formato. En este caso se cubrio BNB con `Nombre del destinatario`, `Se acredito a la cuenta` y `Bancarizacion`.

## QR despues de confirmacion

- El QR post-confirmacion no debe depender exclusivamente de que el telefono empiece con `591`.
- Hay clientes bolivianos cuyo telefono puede quedar guardado sin prefijo local esperado o con otro formato despues de una edicion manual.
- La ficha del cliente tambien es una senal valida: `country=Bolivia` o `BO` debe habilitar QR boliviano aunque el prefijo no sea `591`.
- El log `payment_qr_skipped` con razon `non_bolivia_context` es diagnostico clave. Hay que mirar su payload antes de asumir que WhatsApp fallo.
- En el caso Rafael Prada, el recordatorio y la confirmacion si ocurrieron; el QR se salto por la condicion de pais demasiado estricta.
- El texto del QR debe incluir la instruccion operativa completa: pedir que suban el comprobante en el mismo chat.

## Recordatorios, pagos y QR

- El recordatorio normal de cita no es lo mismo que recordatorio de pago.
- El QR puede salir por dos caminos: post-confirmacion en webhook o recordatorio de pago. Ambos deben compartir criterios coherentes de pais/cliente.
- Si un flujo dice "en un momento te mandamos el QR", debe existir un log de exito o skip con razon concreta.
- Un pago pendiente existente no garantiza que el QR haya salido; revisar `wa_conversations` y `webhooks_log`.
- Los montos de pago deben salir de la ficha/configuracion activa del cliente, no de supuestos hardcodeados.

## Edicion de telefono de cliente

- El panel de cliente ya debe permitir editar telefono, nombre, ciudad, pais, timezone, arancel y notas.
- Cambiar telefono en Agenda 4.0 actualiza la ficha interna, pero no necesariamente actualiza Google Contacts si no se implementa sincronizacion explicita.
- Cuando un telefono cambia, los eventos antiguos de Google Calendar pueden seguir teniendo el telefono anterior en el summary. Eso puede romper matching por telefono contra GCal.
- Si Meta manda BSUID y no telefono, resolver identidad por historial es importante para no perder conversaciones.
- Los logs deben guardar `client_id`, `client_phone` y `bsuid` cuando sea posible para poder diagnosticar cambios de numero.

## Stripe, USD y metodo de pago

- `payment_method` no debe usarse para guardar perfiles como `usd-1`. Esa columna representa metodo local: `QR`, `Efectivo`, `Transferencia`.
- Los enlaces/perfiles de Stripe definidos en Aranceles deben guardarse en `foreign_pricing_key`.
- Al elegir un perfil Stripe en el panel de cliente, deben actualizarse juntos: `foreign_pricing_key`, `fee_currency` y `fee`.
- La UI debe distinguir claramente `Metodo local` de `Perfil Stripe` para evitar que el usuario intente seleccionar `usd-1` en el campo equivocado.
- El perfil completo y el modal rapido de cliente deben exponer las mismas capacidades administrativas.

## Google Contacts

- Crear un contacto nuevo en Agenda 4.0 debe crear el contacto en Google Contacts con etiquetas utiles, incluyendo `Agenda4.0`.
- Crear contacto y editar contacto son flujos distintos. Si se edita telefono/nombre despues, no se sincroniza automaticamente salvo que exista codigo especifico para update en Google People API.
- No asumir que Google Contacts es la fuente de verdad. La app debe usar su base interna para citas, pagos y WhatsApp.

## Business OS y cableado temporal

- Los puentes temporales entre Agenda 4.0 y Business OS deben estar documentados y ser faciles de retirar.
- Variables como `INTERNAL_SECRET` y `BUSINESS_OS_URL` pueden dejar dependencias invisibles si no se eliminan del codigo y del entorno.
- Los webhooks de Meta apuntando a una URL de Agenda no deben convertirse en un bus opaco para otra app sin trazabilidad.
- Cuando se limpia un puente, revisar rutas, env vars, logs y llamadas salientes. No basta con quitar variables del hosting.

## Limites publicos y devmode

- Los limites publicos de intentos deben leerse de Ajustes/configuracion real, no quedar hardcodeados.
- `?devmode=1` puede ser util para QA, pero en produccion debe estar detras de un flag explicito como herramienta temporal, no como bypass permanente abierto.
- Si el usuario cambia valores en Ajustes y "vuelven por arte de magia", buscar seeds, defaults, efectos de carga y procesos que sobrescriben config.

## Frontend y despliegue

- Si `client/dist` esta versionado, despues de cambiar UI hay que correr build y commitear dist.
- El cambio de fuente y el build deben ir juntos si Hostinger sirve los assets versionados.
- No tocar cambios ajenos en el working tree. En esta sesion quedo un cambio local no relacionado en `client/ios/App/App/AppDelegate.swift`.

## Diagnostico practico

- Para incidentes de WhatsApp, revisar en orden: cliente, cita, pago, `wa_conversations`, `webhooks_log`.
- Los estados `sent` y `delivered` de Meta confirman entrega del mensaje, no que el flujo de negocio completo haya terminado.
- Cuando algo "no se mando", buscar primero si fue `failed`, `skipped`, deduplicado o si nunca entro al flujo.
- Cada skip automatico debe guardar razon y contexto suficiente para diagnosticar sin adivinar.
