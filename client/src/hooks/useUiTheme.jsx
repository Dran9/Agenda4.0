import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ui_theme_preference';
const THEME_OPTIONS = ['system', 'light', 'dark'];

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredPreference() {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return THEME_OPTIONS.includes(stored) ? stored : 'system';
}

function applyThemePreference(preference, resolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.uiThemePreference = preference;
  document.documentElement.dataset.uiTheme = resolvedTheme;
  document.body.dataset.uiThemePreference = preference;
  document.body.dataset.uiTheme = resolvedTheme;
}

export function useUiTheme() {
  const [themePreference, setThemePreferenceState] = useState(getStoredPreference);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY) {
        setThemePreferenceState(getStoredPreference());
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const resolvedTheme = useMemo(
    () => (themePreference === 'system' ? systemTheme : themePreference),
    [themePreference, systemTheme]
  );

  useEffect(() => {
    applyThemePreference(themePreference, resolvedTheme);
  }, [themePreference, resolvedTheme]);

  const setThemePreference = useCallback((value) => {
    const nextValue = THEME_OPTIONS.includes(value) ? value : 'system';
    setThemePreferenceState(nextValue);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, nextValue);
    }
  }, []);

  const cycleTheme = useCallback(() => {
    const currentIndex = THEME_OPTIONS.indexOf(themePreference);
    const nextValue = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length];
    setThemePreference(nextValue);
  }, [setThemePreference, themePreference]);

  return {
    themePreference,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    setThemePreference,
    cycleTheme,
  };
}

export function getThemeLabel(themePreference) {
  if (themePreference === 'dark') return 'Oscuro';
  if (themePreference === 'light') return 'Claro';
  return 'Sistema';
}
