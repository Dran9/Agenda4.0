const { z } = require('zod');
const { normalizePhone } = require('../utils/phone');

const phoneSchema = z.string()
  .transform(normalizePhone)
  .refine(value => value.length >= 8 && value.length <= 20, {
    message: 'Telefono invalido',
  });

// Schemas
const onboardingSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  age: z.number().int().min(1).max(120).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  source: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
});

const bookingContextSchema = {
  timezone: z.string().max(50).optional(),
  ip_country_code: z.string().max(10).optional(),
  ip_country_name: z.string().max(100).optional(),
  location_country_code: z.string().max(10).optional(),
  location_country_name: z.string().max(100).optional(),
  location_confirmed_manually: z.boolean().optional(),
  device_type: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  user_agent: z.string().max(500).optional(),
};

const publicBookingSchema = z.object({
  phone: phoneSchema,
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  fee_mode: z.enum(['pe']).optional(),
  code: z.string().max(1000).optional(),
  onboarding: onboardingSchema.optional(),
  ...bookingContextSchema,
});

const adminBookingSchema = z.object({
  client_id: z.number().int().positive(),
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  fee_override: z.union([z.string(), z.number()]).optional(),
});

const publicRescheduleSchema = z.object({
  phone: phoneSchema,
  old_appointment_id: z.number().int().positive(),
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  reschedule_token: z.string().min(1).max(1000),
  ...bookingContextSchema,
});

const adminRescheduleSchema = z.object({
  client_id: z.number().int().positive(),
  old_appointment_id: z.number().int().positive(),
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});

const clientSchema = z.object({
  phone: phoneSchema,
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
  fee_currency: z.enum(['BOB', 'USD']).optional(),
  foreign_pricing_key: z.string().max(60).nullable().optional(),
  payment_method: z.enum(['QR', 'Efectivo', 'Transferencia']).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  diagnosis: z.string().optional(),
  notes: z.string().optional(),
});

const paymentGoalSchema = z.object({
  goal: z.union([z.number(), z.string()])
    .transform((v) => (v === null || v === undefined || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 1_000_000), {
      message: 'Meta inválida',
    })
    .nullable(),
});

const appointmentNotesSchema = z.object({
  notes: z.string().max(5000).nullable().optional(),
});

const appointmentStatusSchema = z.object({
  status: z.enum(['Agendada', 'Confirmada', 'Reagendada', 'Cancelada', 'Completada', 'No-show']),
});

const paymentStatusSchema = z.object({
  status: z.enum(['Pendiente', 'Confirmado', 'Rechazado', 'Mismatch']),
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

module.exports = {
  validate,
  publicBookingSchema,
  adminBookingSchema,
  publicRescheduleSchema,
  adminRescheduleSchema,
  clientSchema,
  paymentGoalSchema,
  paymentStatusSchema,
  appointmentStatusSchema,
  appointmentNotesSchema,
};
