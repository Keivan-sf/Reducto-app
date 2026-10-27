import { lightColors, type ThemeColors } from '../../src/lib/themes';

/** Theme hooks for isolated component harnesses that do not mount React providers. */
export const themeContextMock = {
  useTheme: () => ({ theme: 'light', colors: lightColors }),
  createThemedStyles: <T>(factory: (colors: ThemeColors) => T) => {
    const styles = factory(lightColors);
    return () => styles;
  },
};
