const { z } = require('zod');

// Schemas
const bookingSchema = z.object({
  phone: z.string().min(8).max(20).optional(),
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  client_id: z.number().int().positive().optional(),
  code: z.string().max(50).optional(),
  onboarding: z.object({
    first_name: z.string().min(1).max(100),
    last_name: z.string().min(1).max(100),
    age: z.number().int().min(1).max(120).optional(),
    city: z.string().max(100).optional(),
    country: z.string().max(100).optional(),
    source: z.string().max(100).optional(),
    timezone: z.string().max(50).optional(),
  }).optional(),
});

const rescheduleSchema = z.object({
  client_id: z.number().int().positive(),
  old_appointment_id: z.number().int().positive(),
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});

const clientSchema = z.object({
  phone: z.string().min(8).max(20),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  age: z.number().int().min(1).max(120).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
  modality: z.enum(['Presencial', 'Online', 'Mixto']).optional(),
  frequency: z.enum(['Semanal', 'Quincenal', 'Mensual', 'Irregular']).optional(),
  source: z.string().max(100).optional(),
  referred_by: z.string().max(200).optional(),
  fee: z.number().positive().optional(),
  payment_method: z.enum(['QR', 'Efectivo', 'Transferencia']).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  diagnosis: z.string().optional(),
  notes: z.string().optional(),
});

// Middleware factory
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      return res.status(400).json({ error: 'Datos inválidos', details: errors });
    }
    req.validated = result.data;
    next();
  };
}

module.exports = { validate, bookingSchema, rescheduleSchema, clientSchema };
