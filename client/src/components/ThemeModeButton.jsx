import { Monitor, Moon, SunMedium } from 'lucide-react';
import { getThemeLabel } from '../hooks/useUiTheme';

function getThemeIcon(themePreference) {
  if (themePreference === 'dark') return Moon;
  if (themePreference === 'light') return SunMedium;
  return Monitor;
}

export default function ThemeModeButton({
  themePreference,
  onCycle,
  className = '',
  labelClassName = '',
  iconClassName = '',
}) {
  const Icon = getThemeIcon(themePreference);
  const label = getThemeLabel(themePreference);

  return (
    <button
      type="button"
      onClick={onCycle}
      className={className}
      title={`Tema: ${label}. Toca para cambiar.`}
      aria-label={`Tema actual ${label}. Toca para cambiar`}
    >
      <Icon size={16} className={iconClassName} />
      <span className={labelClassName}>{label}</span>
    </button>
  );
}
