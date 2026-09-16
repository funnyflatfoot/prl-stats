import './globals.css'

export const metadata = {
  title: 'PRL Stats',
  description: 'Pearl Network chain and market statistics'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Source Code Pro is the number face pearlresearch.ai uses. Hanken Grotesk stands in for
            Degular until licensed files are dropped into public/fonts. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&family=Source+Code+Pro:wght@400;500&display=swap"
        />
      </head>
      <body className="bg-bg font-sans text-ink">{children}</body>
    </html>
  )
}
