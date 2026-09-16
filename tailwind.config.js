/** @type {import('tailwindcss').Config} */

// Colours resolve to the CSS custom properties defined in app/globals.css, so the light/dark
// toggle is a single attribute on <html> and no class needs to change. Opacity modifiers
// (text-ink/50) do not work against var() colours; the design does not use any — it separates
// states with the --ink / --ink2 / --muted ramp and hairline borders instead.
const token = name => `var(--${name})`

export default {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        raise: token('raise'),
        line: token('line'),
        hair: token('hair'),
        ink: token('ink'),
        ink2: token('ink2'),
        muted: token('muted'),
        accent: token('accent'),
        pos: token('pos'),
        neg: token('neg'),
        s1: token('s1'),
        s2: token('s2'),
        s3: token('s3'),
        s4: token('s4'),
        s5: token('s5'),
        s6: token('s6'),
        s7: token('s7')
      },
      fontFamily: {
        // Degular is what pearlresearch.ai uses. It is a commercial face (OH no Type Co.) and is
        // not shipped here: drop licensed woff2 files into public/fonts and the @font-face rules in
        // app/globals.css pick them up. Until then the stack falls through to Hanken Grotesk, the
        // closest free match on proportion and x-height. Source Code Pro is the site's number face
        // and is free, so digits match exactly either way.
        sans: ['Degular', 'Hanken Grotesk', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Source Code Pro', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      fontSize: {
        // The design's type ramp: 9.5px eyebrow, 11px rail, 12px legend, 13px footnote,
        // 15/16px prose. Headings and figures use clamp() inline so they scale with viewport.
        eyebrow: ['9.5px', { lineHeight: '14px', letterSpacing: '0.16em' }],
        rail: ['11px', { lineHeight: '19px' }],
        chip: ['11.5px', { lineHeight: '16px' }],
        legend: ['12px', { lineHeight: '17px' }],
        note: ['13px', { lineHeight: '20px' }],
        body: ['15px', { lineHeight: '24px' }],
        lede: ['16px', { lineHeight: '25px' }]
      },
      letterSpacing: {
        eyebrow: '0.16em',
        rail: '0.14em',
        mark: '0.24em'
      }
    }
  },
  plugins: []
}
