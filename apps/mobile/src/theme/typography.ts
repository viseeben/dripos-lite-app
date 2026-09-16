import type { TextStyle } from 'react-native';

/**
 * Dripos uses Roslindale (serif), PP Neue Montreal (sans) and PP Fraktion Mono.
 * Those are licensed, so this app substitutes the open-source equivalents the
 * style guide names: Playfair Display, DM Sans and DM Mono. Swapping in the real
 * families later is a change to this file alone.
 *
 * React Native cannot synthesise weights for a custom family, so each weight is
 * registered as its own family name and referenced explicitly. Never pair these
 * with `fontWeight`.
 */
export const FontFamily = {
  serif: 'PlayfairDisplay_400Regular',
  serifMedium: 'PlayfairDisplay_500Medium',
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansBold: 'DMSans_700Bold',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
} as const;

export const TypeScale = {
  display1: { fontFamily: FontFamily.serif, fontSize: 40, lineHeight: 46, letterSpacing: -0.8 },
  h1: { fontFamily: FontFamily.serif, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  h2: { fontFamily: FontFamily.serif, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  h3: { fontFamily: FontFamily.serifMedium, fontSize: 18, lineHeight: 24 },

  bodyLarge: { fontFamily: FontFamily.sansMedium, fontSize: 17, lineHeight: 26 },
  body: { fontFamily: FontFamily.sans, fontSize: 15, lineHeight: 22 },
  bodySmall: { fontFamily: FontFamily.sans, fontSize: 13, lineHeight: 18 },

  label: {
    fontFamily: FontFamily.mono,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  labelSmall: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /** Money is always mono, so digits line up in columns. */
  amount: { fontFamily: FontFamily.mono, fontSize: 15, lineHeight: 22 },
  amountLarge: { fontFamily: FontFamily.monoMedium, fontSize: 24, lineHeight: 30 },
  amountHero: { fontFamily: FontFamily.monoMedium, fontSize: 36, lineHeight: 42 },
} as const satisfies Record<string, TextStyle>;
