import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';
import '../styles/embed.css';

export const metadata: Metadata = {
  title: 'Connect — Camaleonic',
  robots: { index: false, follow: false },
  icons: {
    icon: { url: '/favicon.svg', type: 'image/svg+xml' },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e0e0e',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
        />
        <link rel="mask-icon" href="/favicon.svg" color="#3cffd0" />
      </head>
      <body>{children}</body>
    </html>
  );
}
