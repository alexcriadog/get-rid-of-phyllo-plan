import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>YouTube Connector — Camaleonic Analytics</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="description"
          content="Connect your YouTube channel to Camaleonic Analytics to view your audience, engagement, and revenue insights."
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <meta name="theme-color" content="#0e0e0e" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
