import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';

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
      <Component {...pageProps} />
    </>
  );
}
