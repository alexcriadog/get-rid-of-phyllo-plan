import type { AppProps } from 'next/app';
import Head from 'next/head';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceProvider } from '../lib/workspace-context';
import { ThemeProvider } from '../lib/theme';
import '../styles/globals.css';

const displayFont = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], display: 'swap' });
const monoFont = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '700'], display: 'swap' });

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Connector PoC</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Favicon: vector for modern browsers, mask-icon for Safari pinned
            tabs. Theme-color tints the Chrome address bar dark to match. */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="mask-icon" href="/favicon.svg" color="#3cffd0" />
        <meta name="theme-color" content="#0e0e0e" />
      </Head>
      {/* Font variables on <html> so Radix portals (mounted on body) inherit. */}
      <style jsx global>{`
        html {
          --font-display: ${displayFont.style.fontFamily};
          --font-mono: ${monoFont.style.fontFamily};
        }
      `}</style>
      {/* TooltipProvider is required by Radix's <Tooltip>. delayDuration=200
          gives a snappier hover than the 700ms default. WorkspaceProvider
          exposes the topbar filter (slug + withQuery) to every admin page. */}
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <WorkspaceProvider>
            <Component {...pageProps} />
          </WorkspaceProvider>
        </TooltipProvider>
      </ThemeProvider>
    </>
  );
}
