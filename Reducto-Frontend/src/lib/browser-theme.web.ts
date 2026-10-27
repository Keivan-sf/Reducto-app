import { themePalettes, type ThemeName } from './themes';

export function syncBrowserTheme(theme: ThemeName) {
  if (typeof document === 'undefined') return;
  const background = themePalettes[theme].surface;
  for (const [name, content] of [
    ['theme-color', background],
    ['color-scheme', theme],
  ]) {
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = name;
      document.head.appendChild(meta);
    }
    meta.content = content;
  }
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.backgroundColor = background;
  document.body.style.backgroundColor = background;
}
