import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

export default function InlineConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  idleTitle,
  disabled = false,
  timeoutMs = 5000,
  wrapperClassName = '',
  idleClassName = '',
  confirmClassName = '',
  cancelClassName = '',
  compactCancel = false,
}) {
  const [armed, setArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!armed || submitting) return undefined;
    const timer = window.setTimeout(() => setArmed(false), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [armed, submitting, timeoutMs]);

  useEffect(() => {
    if (disabled) {
      setArmed(false);
      setSubmitting(false);
    }
  }, [disabled]);

  async function handleConfirm() {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
      setArmed(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (armed) {
    return (
      <div className={`inline-flex items-center gap-2 ${wrapperClassName}`}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={disabled || submitting}
          className={confirmClassName}
        >
          <Check size={14} />
          {submitting ? 'Procesando...' : confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={submitting}
          className={cancelClassName}
          aria-label={cancelLabel}
          title={cancelLabel}
        >
          <X size={14} />
          {!compactCancel ? cancelLabel : null}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      disabled={disabled}
      className={idleClassName}
      title={idleTitle}
    >
      {children}
    </button>
  );
}
