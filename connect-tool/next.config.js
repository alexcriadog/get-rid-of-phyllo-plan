/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone build keeps the container image small. Toggle off if you
  // ever need server-side filesystem access beyond what's bundled.
  output: 'standalone',
  // Connect-tool only proxies tokens to the POC API. We never load remote
  // images or do anything fancy.
  poweredByHeader: false,
};

module.exports = nextConfig;
