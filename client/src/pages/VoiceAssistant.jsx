import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LoaderCircle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { api } from '../utils/api';

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
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [micSupported, setMicSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [holdActive, setHoldActive] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const pressTriggeredRef = useRef(false);
  const selectedVoiceRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const speakRequestRef = useRef(0);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setAuthReady(false);
      return;
    }

    setAuthReady(true);

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

    return undefined;
  }, [navigate]);

  useEffect(() => {
    if (!authReady) return undefined;
    loadHistory();
    return () => {
      stopTracks();
      stopSpokenAudio();
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [authReady]);

  useEffect(() => {
    document.documentElement.classList.add('voice-app-mode');
    document.body.classList.add('voice-app-mode');
    return () => {
      document.documentElement.classList.remove('voice-app-mode');
      document.body.classList.remove('voice-app-mode');
    };
  }, []);

  const lastResponse = result?.reply_text || '';
  const statusTone = useMemo(() => {
    const status = result?.status;
    if (status === 'resolved') return 'text-emerald-900 bg-emerald-100 border-emerald-200';
    if (status === 'clarification') return 'text-amber-950 bg-amber-100 border-amber-200';
    return 'text-slate-900 bg-slate-100 border-slate-300';
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

  function stopSpokenAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  async function speak(text) {
    if (!authReady || !voiceEnabled || !text) return;
    const requestId = Date.now();
    speakRequestRef.current = requestId;
    stopSpokenAudio();

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          message = data.error || message;
        } catch (_) {
          // ignore
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (speakRequestRef.current !== requestId || !voiceEnabled) return;

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
      };
      await audio.play();
      return;
    } catch (_) {
      // Fallback below.
    }

    if (!('speechSynthesis' in window)) return;
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

  useEffect(() => {
    if (!voiceEnabled) {
      stopSpokenAudio();
    }
  }, [voiceEnabled]);

  function stopTracks() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }

  async function startRecording() {
    if (!authReady || loading || isRecording || !micSupported) return;

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

          setLoading(true);
          const response = await api.upload('/voice/admin-command', formData);
          setResult(response);
          void speak(response.spoken_text || response.reply_text);
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
    } catch (_) {
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
    ? 'Escuchando'
    : loading
      ? 'Procesando'
      : 'Hablar';

  if (!authReady) {
    return (
      <div className="voice-app-root bg-[#f6f1e8] text-slate-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(78,118,155,0.22),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(179,78,53,0.16),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.94),_rgba(246,241,232,0.96))]" />
        <div className="relative mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
          <div className="w-full rounded-[2rem] border border-white/70 bg-white/90 p-8 text-center shadow-[0_30px_80px_rgba(15,23,42,0.10)] backdrop-blur">
            <div className="mx-auto mb-4 inline-flex rounded-full bg-[#0f172a] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/80">
              Voice
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              Sesión de voz requerida
            </h1>
            <p className="mt-4 text-[1.02rem] leading-7 text-slate-700">
              Esta app necesita una sesión válida antes de abrir la consola.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/admin/login')}
                className="inline-flex items-center gap-2 rounded-full bg-[#0f172a] px-5 py-3 text-sm font-semibold text-white transition hover:translate-y-[-1px]"
              >
                Ir a login admin
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-app-root bg-[#f1e8da] text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(6,78,94,0.16),_transparent_36%),radial-gradient(circle_at_bottom,_rgba(179,78,53,0.14),_transparent_30%),linear-gradient(180deg,_#fffdf8,_#f1e8da_44%,_#eadfce_100%)]" />
      <div className="pointer-events-none absolute left-[-5rem] top-12 h-56 w-56 rounded-full bg-[#0f766e]/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-4rem] top-44 h-48 w-48 rounded-full bg-[#b45309]/10 blur-3xl" />

      <div className="voice-scroll-shell">
        <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-40 pt-5 sm:px-6">
          <section className="rounded-[2rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(252,247,239,0.96))] p-5 shadow-[0_26px_70px_rgba(15,23,42,0.10)] sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-slate-700">Voice Console</div>
                <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.04em] text-slate-950">
                  Lo que entendió
                </h1>
              </div>
              <div className="flex flex-col items-end gap-2">
                {result?.status && (
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusTone}`}>
                    {result.status}
                  </span>
                )}
                {!micSupported && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-900">
                    Mic no disponible
                  </span>
                )}
              </div>
            </div>

            {error && (
              <div className="mt-5 rounded-[1.4rem] border border-[#B34E35]/25 bg-[#fff1ed] px-4 py-3 text-[0.98rem] leading-7 text-[#7f2f1f]">
                {error}
              </div>
            )}

            <div className="mt-5 space-y-4">
              <div className="rounded-[1.5rem] border border-[#d8d1c7] bg-[#f7f0e7] px-5 py-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-slate-700">Intent</div>
                <div className="mt-2 text-[1.28rem] font-semibold leading-8 text-slate-950">
                  {result?.parsed?.intent || 'Esperando comando'}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-[#d8d1c7] bg-white px-5 py-4">
                <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-slate-700">Entrada reconocida</div>
                <div className="mt-3 whitespace-pre-line text-[1.08rem] leading-8 text-slate-800">
                  {result?.input_text || result?.transcript || 'Todavía no hay audio reconocido.'}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-[#d8d1c7] bg-white px-5 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-slate-700">Respuesta</div>
                <div className="mt-3 whitespace-pre-line text-[1.14rem] leading-8 text-slate-900">
                  {lastResponse || 'Aquí aparecerá la respuesta completa después de hablar.'}
                </div>
              </div>
            </div>
          </section>

          <section className="mt-8 rounded-[2rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(247,241,231,0.94))] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-slate-700">Historial</div>
                <div className="mt-1 text-[1.7rem] font-semibold tracking-[-0.03em] text-slate-950">Reciente</div>
              </div>
              <button
                type="button"
                onClick={loadHistory}
                className="rounded-full border border-[#cfc5b9] bg-white px-4 py-2 text-[0.95rem] font-semibold text-slate-800 transition hover:border-slate-500 hover:text-slate-950"
              >
                Actualizar
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {historyLoading && (
                <div className="rounded-[1.25rem] border border-[#d8d1c7] bg-white px-4 py-5 text-[1rem] text-slate-700">
                  Cargando historial...
                </div>
              )}

              {!historyLoading && history.length === 0 && (
                <div className="rounded-[1.25rem] border border-[#d8d1c7] bg-white px-4 py-5 text-[1rem] text-slate-700">
                  Todavía no hay comandos registrados.
                </div>
              )}

              {history.map((item) => (
                <div key={item.id} className="rounded-[1.35rem] border border-white/80 bg-white px-4 py-4 shadow-[0_16px_32px_rgba(15,23,42,0.05)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[1rem] font-semibold leading-7 text-slate-900">
                        {item.transcript || item.raw_text || 'Audio sin texto visible'}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-slate-700">
                        {item.parsed_intent || 'unknown'} · {item.source === 'voice_web' ? 'Voice web' : 'Shortcut'}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-700">{formatHistoryDate(item.created_at)}</div>
                  </div>

                  {item.response_text && (
                    <div className="mt-3 rounded-[1.1rem] bg-[#f6efe6] px-3 py-3 text-[0.98rem] leading-7 text-slate-800">
                      {item.response_text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-center gap-3 rounded-[2rem] border border-white/80 bg-[rgba(20,28,36,0.84)] px-4 py-3 shadow-[0_24px_50px_rgba(15,23,42,0.32)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setVoiceEnabled((current) => !current)}
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/16"
            title={voiceEnabled ? 'Silenciar respuesta hablada' : 'Activar respuesta hablada'}
          >
            {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>

          <button
            type="button"
            onPointerDown={handlePressStart}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onClick={handleRecordButtonClick}
            disabled={loading || !micSupported}
            className={`voice-record-button relative flex h-[4.8rem] w-[4.8rem] shrink-0 items-center justify-center rounded-full border transition ${
              isRecording
                ? 'border-[#ffcfbf] bg-[radial-gradient(circle_at_30%_30%,_#d97757,_#8c2f19)] text-white shadow-[0_0_0_10px_rgba(179,78,53,0.22)]'
                : 'border-[#d8eced] bg-[radial-gradient(circle_at_30%_30%,_#4e769b,_#0b5d69)] text-white shadow-[0_0_0_10px_rgba(78,118,155,0.18)]'
            } ${loading || !micSupported ? 'cursor-not-allowed opacity-55' : 'cursor-pointer active:scale-[0.98]'}`}
          >
            {loading ? (
              <LoaderCircle size={28} className="animate-spin" />
            ) : isRecording ? (
              <MicOff size={28} />
            ) : (
              <Mic size={28} />
            )}
          </button>

          <div className="min-w-[5.5rem] text-left">
            <div className="text-[0.98rem] font-semibold text-white">{activePrompt}</div>
            <div className="text-[12px] uppercase tracking-[0.16em] text-white/70">
              {holdActive || isRecording ? 'Grabando' : loading ? 'LLM' : 'Voice'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
