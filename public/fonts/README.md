# Fonts

`pearlresearch.ai` sets its UI in **Degular** (OH no Type Co., weights 400 / 500 / 600) and its numbers
in **Source Code Pro**.

Source Code Pro is open licensed (SIL OFL) and loads from Google Fonts in `app/layout.jsx`, so every
figure on the dashboard is already in the site's number face.

Degular is commercial and is not included in this repo. To match the site exactly, buy a webfont licence
and drop these three files here:

    public/fonts/degular-regular.woff2    (400)
    public/fonts/degular-medium.woff2     (500)
    public/fonts/degular-semibold.woff2   (600)

The `@font-face` rules in `app/globals.css` already point at those paths. With the files absent the stack
falls through to Hanken Grotesk, the closest free match on x-height and proportion, and nothing breaks.

Do not copy the woff2 files served by pearlresearch.ai: those are licensed to them, not to you.
