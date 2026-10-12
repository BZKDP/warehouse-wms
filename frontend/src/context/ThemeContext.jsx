import { createContext, useContext, useState, useEffect, useMemo } from 'react';

const THEMES = ['purple', 'blue', 'green', 'orange', 'rose'];
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [color, setColor] = useState(() => localStorage.getItem('theme_color') || 'purple');
  const [mode, setMode] = useState(() => localStorage.getItem('theme_mode') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', color);
    localStorage.setItem('theme_color', color);
  }, [color]);

  useEffect(() => {
    if (mode === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme_mode', mode);
  }, [mode]);

  const value = useMemo(() => ({ color, setColor, mode, setMode, THEMES }), [color, mode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
