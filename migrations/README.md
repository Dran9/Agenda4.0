# Migraciones versionadas

Folder para todo cambio de schema de aquí en adelante. **No se toca `server/db.js` para cambios de schema nuevos** — todo va aquí.

## Convención

Archivos nombrados: `NNN_descripcion_corta.sql` donde `NNN` es un entero con padding de 3 dígitos, secuencial y único.

Ejemplos:
- `002_add_client_email.sql`
- `003_add_payment_currency.sql`
- `004_meta_health_retention_policy.sql`

El runner (`server/migrations.js`) corre los archivos en orden alfabético al arrancar el server. Cada archivo se aplica **una sola vez** — la tabla `schema_migrations` lleva el registro.

## Reglas

1. **Un archivo = un cambio lógico atómico.** Si agregás una columna + backfill + índice, todo en el mismo archivo.
2. **Nunca editar un archivo ya commiteado.** Si te equivocaste, escribí una migración nueva que corrija.
3. **Siempre idempotente cuando sea razonable**: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc. Pero no uses eso como excusa para no pensar si la migración es correcta.
4. **Sin `DROP TABLE` ni `DROP COLUMN` sin aviso.** Cambios destructivos requieren conversación previa con el equipo.
5. **Un archivo por migración.** Múltiples statements SQL en el mismo archivo OK; el runner los separa por `;` respetando strings.

## Estado histórico

La tabla `schema_migrations` se crea automáticamente al arrancar el server por primera vez tras este refactor. En DBs existentes (prod), el runner detecta que las tablas ya están y NO intenta aplicar `001_baseline.sql` — simplemente registra que el baseline ya estaba.

En DBs nuevas, `001_baseline.sql` (si existe) se corre tal cual.

Mientras tanto, `server/db.js` sigue teniendo `initializeDatabase()` con los `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... .catch(() => {})` históricos. Eso **no se borra** — queda como el "ancestro" del schema. Los cambios nuevos van acá.

## Cómo correr manualmente (dev)

```bash
node -e "require('./server/migrations').runMigrations().then(() => process.exit(0))"
```

## Cómo ver qué migraciones están aplicadas

```sql
SELECT * FROM schema_migrations ORDER BY version;
```
