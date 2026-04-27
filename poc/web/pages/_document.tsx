import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Verge type stack — Anton = Manuka substitute, Space Grotesk = PolySans,
            Space Mono = PolySans Mono. Weights picked to match the spec
            (Anton 400 is the only weight; Space Grotesk 300/400/500/700;
             Space Mono 400/700). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
