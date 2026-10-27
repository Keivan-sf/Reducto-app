import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { StyleSheet } from 'react-native';
import { syncBrowserTheme } from '../lib/browser-theme';
import { readClientPreference, writeClientPreference } from '../lib/client-preferences';
import { parseTheme, themePalettes, type ThemeColors, type ThemeName } from '../lib/themes';

type ThemeContextValue = {
  theme: ThemeName;
  colors: ThemeColors;
  setTheme: (theme: ThemeName) => Promise<void>;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);
const preferenceKey = 'reducto-theme';

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setCurrentTheme] = useState<ThemeName>('light');
  const [ready, setReady] = useState(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    void readClientPreference(preferenceKey)
      .then((value) => {
        if (alive) setCurrentTheme(parseTheme(value));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) syncBrowserTheme(theme);
  }, [ready, theme]);

  function setTheme(next: ThemeName) {
    setCurrentTheme(next);
    // Serialize writes so quickly switching twice still saves the last choice.
    const write = writes.current
      .catch(() => {})
      .then(() => writeClientPreference(preferenceKey, next));
    writes.current = write;
    return write;
  }

  return (
    <ThemeContext.Provider value={{ theme, colors: themePalettes[theme], setTheme }}>
      {ready ? children : null}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}

// Each palette gets one immutable stylesheet, shared by every instance.
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors) => T,
) {
  const cache = new Map<ThemeColors, T>();
  return function useThemedStyles(): T {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
