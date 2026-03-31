import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { api } from '../../utils/api';
import { useToast, Toast } from '../../hooks/useToast.jsx';

const DAYS = [
  { key: 'lunes', label: 'Lunes', short: 'Lun' },
  { key: 'martes', label: 'Martes', short: 'Mar' },
  { key: 'miercoles', label: 'Miércoles', short: 'Mie' },
  { key: 'jueves', label: 'Jueves', short: 'Jue' },
  { key: 'viernes', label: 'Viernes', short: 'Vie' },
  { key: 'sabado', label: 'Sábado', short: 'Sab' },
  { key: 'domingo', label: 'Domingo', short: 'Dom' },
];

const ALL_CITIES = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Beni',
  'Sucre', 'Oruro', 'Potosí', 'Tarija', 'Cobija', 'El Alto',
];

function generateTimeOptions() {
  const opts = [];
  for (let h = 6; h <= 22; h++) {
    opts.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 22) opts.push(`${String(h).padStart(2, '0')}:30`);
  }
  return opts;
}
const TIME_OPTIONS = generateTimeOptions();

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Convert individual hours array → time range blocks
function hoursToBlocks(hours) {
  if (!hours || hours.length === 0) return [];
  const sorted = [...hours].sort();
  const blocks = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prevMin = timeToMinutes(prev);
    const currMin = timeToMinutes(sorted[i]);
    if (currMin - prevMin > 60) {
      blocks.push({ start, end: minutesToTime(prevMin + 60) });
      start = sorted[i];
    }
    prev = sorted[i];
  }
  blocks.push({ start, end: minutesToTime(timeToMinutes(prev) + 60) });
  return blocks;
}

// Convert time range blocks → individual hours array
function blocksToHours(blocks, duration = 60) {
  const hours = [];
  for (const block of blocks) {
    const startMin = timeToMinutes(block.start);
    const endMin = timeToMinutes(block.end);
    for (let m = startMin; m < endMin; m += duration) {
      hours.push(minutesToTime(m));
    }
  }
  return hours;
}

export default function Config() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast, show: showToast } = useToast();
  const [availability, setAvailability] = useState({});
  const [expandedDay, setExpandedDay] = useState(null);
  const [copyTo, setCopyTo] = useState({});

  useEffect(() => {
    api.get('/config')
      .then(data => {
        const hours = typeof data.available_hours === 'string'
          ? JSON.parse(data.available_hours) : (data.available_hours || {});
        const days = typeof data.available_days === 'string'
          ? JSON.parse(data.available_days) : (data.available_days || []);

        const avail = {};
        for (const day of DAYS) {
          const dayHours = hours[day.key] || [];
          avail[day.key] = {
            enabled: days.includes(day.key),
            blocks: hoursToBlocks(dayHours),
          };
        }
        setAvailability(avail);

        const capitalCities = (data.capital_cities || '').split(',').map(c => c.trim()).filter(Boolean);
        setConfig({ ...data, _capitalCities: capitalCities });
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  function updateAvailability(dayKey, update) {
    setAvailability(prev => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...update },
    }));
  }

  function addBlock(dayKey) {
    const blocks = availability[dayKey]?.blocks || [];
    const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end : '08:00';
    const startMin = timeToMinutes(lastEnd);
    const newStart = minutesToTime(Math.max(startMin, timeToMinutes('14:00')));
    const endMin = Math.min(timeToMinutes(newStart) + 240, timeToMinutes('22:00'));
    updateAvailability(dayKey, {
      blocks: [...blocks, { start: newStart, end: minutesToTime(endMin) }],
    });
  }

  function removeBlock(dayKey, idx) {
    const blocks = [...(availability[dayKey]?.blocks || [])];
    blocks.splice(idx, 1);
    updateAvailability(dayKey, { blocks });
  }

  function updateBlock(dayKey, idx, field, value) {
    const blocks = [...(availability[dayKey]?.blocks || [])];
    blocks[idx] = { ...blocks[idx], [field]: value };
    updateAvailability(dayKey, { blocks });
  }

  function handleCopy(fromDayKey) {
    const fromBlocks = availability[fromDayKey]?.blocks || [];
    const targets = Object.entries(copyTo).filter(([k, v]) => v && k !== fromDayKey).map(([k]) => k);
    if (targets.length === 0) return;

    const updated = { ...availability };
    for (const dayKey of targets) {
      updated[dayKey] = {
        ...updated[dayKey],
        blocks: JSON.parse(JSON.stringify(fromBlocks)),
        enabled: true,
      };
    }
    setAvailability(updated);
    setCopyTo({});

    const names = targets.map(k => DAYS.find(d => d.key === k)?.short).join(', ');
    showToast(`Horario copiado a ${names}`);
  }

  function toggleCity(city) {
    setConfig(prev => {
      const cities = [...(prev._capitalCities || [])];
      const idx = cities.indexOf(city);
      if (idx >= 0) cities.splice(idx, 1);
      else cities.push(city);
      return { ...prev, _capitalCities: cities, capital_cities: cities.join(',') };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const available_hours = {};
      const available_days = [];
      const duration = config?.appointment_duration || 60;

      for (const day of DAYS) {
        const dayAvail = availability[day.key];
        if (dayAvail?.enabled) {
          available_days.push(day.key);
          available_hours[day.key] = blocksToHours(dayAvail.blocks || [], duration);
        }
      }

      await api.put('/config', {
        available_hours,
        available_days,
        window_days: config.window_days,
        buffer_hours: config.buffer_hours,
        appointment_duration: config.appointment_duration,
        min_age: config.min_age,
        max_age: config.max_age,
        capital_fee: config.capital_fee,
        default_fee: config.default_fee,
        special_fee: config.special_fee,
        foreign_fee: config.foreign_fee,
        foreign_currency: config.foreign_currency,
        capital_cities: config._capitalCities?.join(',') || '',
        reminder_enabled: config.reminder_enabled ? 1 : 0,
        reminder_time: config.reminder_time || '18:40',
      });
      showToast('Configuración guardada');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleQRUpload(key, file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.upload(`/config/qr/${key}`, formData);
      showToast('QR subido');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  if (loading) {
    return <AdminLayout title="Configuración"><div className="text-gray-400">Cargando...</div></AdminLayout>;
  }

  return (
    <AdminLayout title="Configuración">
      <Toast toast={toast} />
      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-gray-500 -mt-2">Disponibilidad, aranceles y preferencias</p>

        {/* SECTION 1: Weekly Availability */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-1">Disponibilidad semanal</h3>
          <p className="text-sm text-gray-400 mb-5">Configura tus horarios por día. Usa "Copiar a" para replicar.</p>

          <div className="space-y-3">
            {DAYS.map(day => {
              const dayAvail = availability[day.key] || { enabled: false, blocks: [] };
              const isExpanded = expandedDay === day.key;
              const blockCount = dayAvail.blocks?.length || 0;

              return (
                <div
                  key={day.key}
                  className={`border rounded-xl overflow-hidden ${dayAvail.enabled ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}
                >
                  <div
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer"
                    onClick={() => {
                      if (!dayAvail.enabled) return;
                      const next = isExpanded ? null : day.key;
                      setExpandedDay(next);
                      setCopyTo({});
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={dayAvail.enabled}
                        onChange={e => {
                          e.stopPropagation();
                          const nowEnabled = e.target.checked;
                          if (nowEnabled && blockCount === 0) {
                            updateAvailability(day.key, {
                              enabled: true,
                              blocks: [{ start: '08:00', end: '13:00' }, { start: '15:00', end: '20:00' }],
                            });
                            setExpandedDay(day.key);
                          } else {
                            updateAvailability(day.key, { enabled: nowEnabled });
                          }
                        }}
                        className="w-4 h-4 accent-black rounded"
                        onClick={e => e.stopPropagation()}
                      />
                      <span className="font-medium text-sm">{day.label}</span>
                      {dayAvail.enabled && blockCount > 0 && (
                        <span className="text-xs text-gray-400">
                          {blockCount} bloque{blockCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {dayAvail.enabled && (
                      isExpanded
                        ? <ChevronDown size={16} className="text-gray-400" />
                        : <ChevronRight size={16} className="text-gray-400" />
                    )}
                  </div>

                  {isExpanded && dayAvail.enabled && (
                    <div className="px-4 py-4 space-y-3 border-t border-gray-100">
                      {dayAvail.blocks.map((block, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={block.start}
                            onChange={e => updateBlock(day.key, idx, 'start', e.target.value)}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                          >
                            {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <span className="text-gray-400 text-sm">a</span>
                          <select
                            value={block.end}
                            onChange={e => updateBlock(day.key, idx, 'end', e.target.value)}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                          >
                            {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeBlock(day.key, idx)}
                            className="text-gray-300 hover:text-red-400 ml-1"
                            title="Eliminar bloque"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => addBlock(day.key)}
                        className="text-sm text-gray-500 hover:text-black flex items-center gap-1"
                      >
                        <Plus size={14} />
                        Agregar bloque
                      </button>

                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="text-xs text-gray-400 mb-2">Copiar esta configuración a:</div>
                        <div className="flex flex-wrap gap-2">
                          {DAYS.filter(d => d.key !== day.key).map(d => (
                            <label key={d.key} className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={copyTo[d.key] || false}
                                onChange={e => setCopyTo(prev => ({ ...prev, [d.key]: e.target.checked }))}
                                className="w-3.5 h-3.5 accent-black rounded"
                              />
                              {d.short}
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(day.key)}
                          disabled={!Object.values(copyTo).some(Boolean)}
                          className="mt-2 text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-30"
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION 2: Fees */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-1">Aranceles</h3>
          <p className="text-sm text-gray-400 mb-5">4 categorías de precio. El arancel se asigna automáticamente según la ciudad del cliente.</p>

          <div className="space-y-4">
            {/* Capital */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium text-sm">Capital</div>
                  <div className="text-xs text-gray-400">Ciudades del eje troncal</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">Bs</span>
                  <input
                    type="number"
                    value={config?.capital_fee || ''}
                    onChange={e => setConfig(c => ({ ...c, capital_fee: parseFloat(e.target.value) }))}
                    className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-medium"
                  />
                </div>
              </div>
              <div className="text-xs text-gray-400 mb-2">Ciudades que aplican:</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_CITIES.map(city => {
                  const selected = (config?._capitalCities || []).includes(city);
                  return (
                    <button
                      key={city}
                      type="button"
                      onClick={() => toggleCity(city)}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[13px] transition-all ${
                        selected
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {city}
                      {selected && <span className="text-[11px] ml-0.5 opacity-70">x</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Provincia */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Provincia</div>
                  <div className="text-xs text-gray-400">Resto de Bolivia (se asigna automáticamente)</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">Bs</span>
                  <input
                    type="number"
                    value={config?.default_fee || ''}
                    onChange={e => setConfig(c => ({ ...c, default_fee: parseFloat(e.target.value) }))}
                    className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-medium"
                  />
                </div>
              </div>
            </div>

            {/* Precio especial */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Precio especial</div>
                  <div className="text-xs text-gray-400">Asignación manual por cliente</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">Bs</span>
                  <input
                    type="number"
                    value={config?.special_fee || ''}
                    onChange={e => setConfig(c => ({ ...c, special_fee: parseFloat(e.target.value) }))}
                    className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-medium"
                  />
                </div>
              </div>
            </div>

            {/* Extranjero */}
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium text-sm">Extranjero</div>
                  <div className="text-xs text-gray-400">Clientes fuera de Bolivia</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">{config?.foreign_currency || 'USD'}</span>
                  <input
                    type="number"
                    value={config?.foreign_fee || ''}
                    onChange={e => setConfig(c => ({ ...c, foreign_fee: parseFloat(e.target.value) }))}
                    className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-medium"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Moneda:</span>
                <select
                  value={config?.foreign_currency || 'USD'}
                  onChange={e => setConfig(c => ({ ...c, foreign_currency: e.target.value }))}
                  className="px-2 py-1 border border-gray-200 rounded text-xs bg-white"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="Bs">Bs</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: Recordatorios WhatsApp */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-1">Recordatorios WhatsApp</h3>
          <p className="text-sm text-gray-400 mb-5">Envío automático de recordatorios a pacientes.</p>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Enviar recordatorios</div>
              <div className="text-xs text-gray-400">Se envían diariamente a la hora configurada para las citas del día siguiente</div>
            </div>
            <button
              type="button"
              onClick={() => setConfig(c => ({ ...c, reminder_enabled: c.reminder_enabled ? 0 : 1 }))}
              className={`relative w-12 h-7 rounded-full transition-colors ${config?.reminder_enabled ? 'bg-gray-900' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${config?.reminder_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {config?.reminder_enabled ? (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="block text-xs text-gray-500 mb-1">Hora de envío (Bolivia)</label>
              <select
                value={config?.reminder_time || '18:40'}
                onChange={e => setConfig(c => ({ ...c, reminder_time: e.target.value }))}
                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
              >
                {Array.from({ length: 15 }, (_, i) => {
                  const h = i + 8;
                  return [
                    <option key={`${h}:00`} value={`${String(h).padStart(2, '0')}:00`}>{String(h).padStart(2, '0')}:00</option>,
                    <option key={`${h}:30`} value={`${String(h).padStart(2, '0')}:30`}>{String(h).padStart(2, '0')}:30</option>,
                  ];
                }).flat().filter(o => {
                  const v = o.props.value;
                  const [hh] = v.split(':').map(Number);
                  return hh <= 22;
                })}
              </select>
            </div>
          ) : null}
        </div>

        {/* SECTION 4: General Parameters */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-1">Parámetros generales</h3>
          <p className="text-sm text-gray-400 mb-5">Configuración de la sesión y ventana de agendamiento.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duración de sesión</label>
              <select
                value={config?.appointment_duration || 60}
                onChange={e => setConfig(c => ({ ...c, appointment_duration: parseInt(e.target.value) }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ventana de agendamiento</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={config?.window_days || 10}
                  onChange={e => setConfig(c => ({ ...c, window_days: parseInt(e.target.value) || 10 }))}
                  className="w-20 px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                />
                <span className="text-sm text-gray-400">días</span>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Buffer mínimo</label>
                <select
                  value={config?.buffer_hours || 3}
                  onChange={e => setConfig(c => ({ ...c, buffer_hours: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  <option value={1}>1 hora</option>
                  <option value={2}>2 horas</option>
                  <option value={3}>3 horas</option>
                  <option value={6}>6 horas</option>
                  <option value={24}>24 horas</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Edad mínima</label>
                <input
                  type="number"
                  value={config?.min_age || 12}
                  onChange={e => setConfig(c => ({ ...c, min_age: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Edad máxima</label>
                <input
                  type="number"
                  value={config?.max_age || 100}
                  onChange={e => setConfig(c => ({ ...c, max_age: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 4: QR de pago */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-1">QR de pago</h3>
          <p className="text-sm text-gray-400 mb-5">Sube QR para cada categoría de arancel.</p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'qr_300', label: 'Capital' },
              { key: 'qr_250', label: 'Provincia' },
              { key: 'qr_150', label: 'Especial' },
              { key: 'qr_generico', label: 'Genérico' },
            ].map(qr => (
              <div key={qr.key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{qr.label}</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => { if (e.target.files[0]) handleQRUpload(qr.key, e.target.files[0]); }}
                  className="text-xs"
                />
                <img
                  src={`/api/config/qr/${qr.key}`}
                  alt=""
                  className="mt-1 w-24 h-24 object-contain border rounded"
                  onError={e => { e.target.style.display = 'none'; }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end pb-8">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
