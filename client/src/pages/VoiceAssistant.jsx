import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  LoaderCircle,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { api } from '../utils/api';

const SUGGESTIONS = [
  'pagos pendientes',
  'manda recordatorios para mañana',
  'qué citas tengo hoy',
  'quiénes no han confirmado mañana',
  'activar recordatorios',
  'el jueves solo voy a trabajar de 8 a 12 en la mañana, en la tarde nada',
];

function formatHistoryDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function pickSpanishVoice(voices = []) {
  return (
    voices.find((voice) => voice.lang?.toLowerCase().startsWith('es-bo')) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith('es')) ||
    null
  );
}

export default function VoiceAssistant() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [micSupported, setMicSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [holdActive, setHoldActive] = useState(false);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const pressTriggeredRef = useRef(false);
  const selectedVoiceRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      navigate('/admin/login');
      return;
    }

    const hasMediaRecorder =
      typeof window !== 'undefined' &&
      !!window.MediaRecorder &&
      !!navigator.mediaDevices?.getUserMedia;
    setMicSupported(hasMediaRecorder);

    if ('speechSynthesis' in window) {
      const updateVoices = () => {
        selectedVoiceRef.current = pickSpanishVoice(window.speechSynthesis.getVoices());
      };
      updateVoices();
      window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
      };
    }
  }, [navigate]);

  useEffect(() => {
    loadHistory();
    return () => {
      stopTracks();
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const lastResponse = result?.reply_text || '';
  const statusTone = useMemo(() => {
    const status = result?.status;
    if (status === 'resolved') return 'text-emerald-800 bg-emerald-100 border-emerald-200';
    if (status === 'clarification') return 'text-amber-900 bg-amber-100 border-amber-200';
    return 'text-slate-800 bg-slate-100 border-slate-200';
  }, [result?.status]);

  async function loadHistory() {
    try {
      setHistoryLoading(true);
      const response = await api.get('/voice/history');
      setHistory(response.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  function speak(text) {
    if (!voiceEnabled || !text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = selectedVoiceRef.current?.lang || 'es-ES';
    if (selectedVoiceRef.current) {
      utterance.voice = selectedVoiceRef.current;
    }
    utterance.rate = 1;
    utterance.pitch = 0.92;
    window.speechSynthesis.speak(utterance);
  }

  async function sendTextCommand(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    try {
      setLoading(true);
      setError('');
      const response = await api.post('/voice/admin-command', { text: trimmed });
      setResult(response);
      setDraft('');
      speak(response.spoken_text || response.reply_text);
      await loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function stopTracks() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }

  async function startRecording() {
    if (loading || isRecording || !micSupported) return;

    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined,
      });

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          if (!blob.size) return;
          const extension = blob.type.includes('mp4') || blob.type.includes('mpeg') ? 'm4a' : 'webm';
          const formData = new FormData();
          formData.append('audio', blob, `voice-command.${extension}`);
          if (draft.trim()) formData.append('text', draft.trim());

          setLoading(true);
          const response = await api.upload('/voice/admin-command', formData);
          setResult(response);
          speak(response.spoken_text || response.reply_text);
          await loadHistory();
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
          setIsRecording(false);
          setHoldActive(false);
          stopTracks();
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setError('No pude abrir el micrófono.');
      stopTracks();
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    mediaRecorderRef.current = null;
  }

  function handlePressStart() {
    pressTriggeredRef.current = true;
    setHoldActive(true);
    startRecording();
  }

  function handlePressEnd() {
    setHoldActive(false);
    if (isRecording) stopRecording();
    window.setTimeout(() => {
      pressTriggeredRef.current = false;
    }, 50);
  }

  function handleRecordButtonClick() {
    if (pressTriggeredRef.current) return;
    if (isRecording) stopRecording();
    else startRecording();
  }

  const activePrompt = isRecording
    ? 'Escuchando. Suelta cuando termines.'
    : loading
      ? 'Procesando tu comando...'
      : 'Mantén pulsado para hablar o toca una vez para grabar.';

  return (
    <div className="min-h-screen overflow-x-hidden overflow-y-hidden bg-[#f6f1e8] text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(78,118,155,0.22),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(179,78,53,0.16),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.94),_rgba(246,241,232,0.96))]" />
      <div className="pointer-events-none absolute left-[-4rem] top-24 h-56 w-56 rounded-full bg-[#cfe8e9]/70 blur-3xl sm:left-[-6rem] sm:h-72 sm:w-72" />
      <div className="pointer-events-none absolute bottom-[-4rem] right-[-2rem] h-56 w-56 rounded-full bg-[#fdda78]/30 blur-3xl sm:bottom-[-6rem] sm:right-[-4rem] sm:h-72 sm:w-72" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-end gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setVoiceEnabled((current) => !current)}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-white/75 text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur transition hover:scale-[1.02] hover:text-slate-950"
              title={voiceEnabled ? 'Silenciar respuesta hablada' : 'Activar respuesta hablada'}
            >
              {voiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur transition hover:translate-y-[-1px] hover:text-slate-950"
            >
              <ArrowLeft size={16} />
              Volver al admin
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(238,246,247,0.92))] p-5 shadow-[0_30px_80px_rgba(15,23,42,0.10)] sm:p-7">
            <div className="absolute right-6 top-6 hidden rounded-full bg-[#0f172a] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/80 sm:block">
              Privado
            </div>

            <div className="flex flex-col items-center text-center">
              <button
                type="button"
                onPointerDown={handlePressStart}
                onPointerUp={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onPointerCancel={handlePressEnd}
                onClick={handleRecordButtonClick}
                disabled={loading || !micSupported}
                className={`group relative flex h-64 w-64 max-w-full select-none items-center justify-center rounded-full border border-white/70 transition duration-200 sm:h-72 sm:w-72 ${
                  isRecording
                    ? 'scale-[1.02] bg-[radial-gradient(circle_at_center,_rgba(179,78,53,0.94),_rgba(120,34,15,0.98))] shadow-[0_0_0_18px_rgba(179,78,53,0.12),0_40px_80px_rgba(120,34,15,0.32)]'
                    : 'bg-[radial-gradient(circle_at_30%_30%,_rgba(78,118,155,0.96),_rgba(8,92,109,0.98))] shadow-[0_0_0_18px_rgba(78,118,155,0.12),0_40px_80px_rgba(8,92,109,0.30)] hover:scale-[1.01]'
                } ${loading || !micSupported ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <div className="absolute inset-5 rounded-full border border-white/20" />
                <div className="absolute inset-10 rounded-full border border-white/10" />

                <div className="relative z-10 flex items-center justify-center text-white">
                  {loading ? (
                    <LoaderCircle size={54} className="animate-spin" />
                  ) : isRecording ? (
                    <MicOff size={54} />
                  ) : (
                    <Mic size={54} />
                  )}
                </div>

                <div className="absolute bottom-12 flex gap-2">
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      key={index}
                      className={`h-10 w-2 rounded-full bg-white/70 ${isRecording ? 'animate-[voicePulse_1.2s_ease-in-out_infinite]' : 'opacity-45'}`}
                      style={{ animationDelay: `${index * 0.15}s` }}
                    />
                  ))}
                </div>
              </button>

              <p className="mt-6 max-w-lg text-[1rem] leading-7 text-slate-600">{activePrompt}</p>

              {!micSupported && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Este navegador no soporta grabación directa. Puedes seguir usando la caja de texto.
                </div>
              )}
            </div>

            <div className="mt-8 grid gap-4">
              <div className="rounded-[1.75rem] border border-white/80 bg-white/90 p-4 shadow-[0_20px_45px_rgba(15,23,42,0.06)] sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <label htmlFor="voice-draft" className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Texto directo
                  </label>
                  <div className="text-xs text-slate-400">Fallback rápido</div>
                </div>

                <textarea
                  id="voice-draft"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Escribe o dicta aquí. Ejemplo: manda recordatorios para mañana."
                  className="min-h-[116px] w-full resize-none rounded-[1.3rem] border border-slate-200/90 bg-[#fbfaf7] px-4 py-4 text-[1.08rem] leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#4E769B] focus:ring-2 focus:ring-[#4E769B]/15"
                />

                <div className="mt-4 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setDraft(suggestion)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-[#4E769B]/30 hover:text-slate-950"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Waves size={16} className="text-[#4E769B]" />
                    {holdActive || isRecording ? 'Listo para capturar audio.' : 'Texto y audio usan el mismo motor de comandos.'}
                  </div>
                  <button
                    type="button"
                    onClick={() => sendTextCommand(draft)}
                    disabled={loading || !draft.trim()}
                    className="inline-flex items-center gap-2 rounded-full bg-[#0f172a] px-5 py-3 text-sm font-semibold text-white transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={16} />
                    Enviar texto
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-[1.5rem] border border-[#B34E35]/20 bg-[#fff1ed] px-4 py-3 text-sm text-[#8f3520]">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6">
            <div className="rounded-[2rem] border border-white/70 bg-white/86 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Última respuesta</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Lo que entendió el sistema</div>
                </div>
                {result?.status && (
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusTone}`}>
                    {result.status}
                  </span>
                )}
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-[1.4rem] bg-[#f7f5ef] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Intent</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900">
                    {result?.parsed?.intent || 'Todavía no hay comando'}
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Respuesta</div>
                  <div className="mt-3 whitespace-pre-line text-[1.02rem] leading-7 text-slate-800">
                    {lastResponse || 'Aquí aparecerá la respuesta textual cada vez que hables o escribas.'}
                  </div>
                </div>

                {(result?.input_text || result?.transcript || draft) && (
                  <div className="rounded-[1.4rem] border border-dashed border-slate-200 bg-white/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Entrada reconocida</div>
                    <div className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">
                      {result?.input_text || result?.transcript || draft}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(244,239,231,0.96))] p-5 shadow-[0_30px_80px_rgba(15,23,42,0.08)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Historial</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Reciente</div>
                </div>
                <button
                  type="button"
                  onClick={loadHistory}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
                >
                  Actualizar
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {historyLoading && (
                  <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                    Cargando historial...
                  </div>
                )}

                {!historyLoading && history.length === 0 && (
                  <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                    Todavía no hay comandos registrados.
                  </div>
                )}

                {history.map((item) => (
                  <div key={item.id} className="rounded-[1.3rem] border border-white/80 bg-white/92 px-4 py-4 shadow-[0_18px_34px_rgba(15,23,42,0.05)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {item.transcript || item.raw_text || 'Audio sin texto visible'}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                          {item.parsed_intent || 'unknown'} · {item.source === 'voice_web' ? 'Voice web' : 'Shortcut'}
                        </div>
                      </div>
                      <div className="text-xs text-slate-400">{formatHistoryDate(item.created_at)}</div>
                    </div>

                    {item.response_text && (
                      <div className="mt-3 rounded-2xl bg-[#f7f5ef] px-3 py-3 text-sm leading-6 text-slate-700">
                        {item.response_text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
