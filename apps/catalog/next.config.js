/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // stop wholesale iframe-mirroring of the catalog
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'th.wine-now.com', pathname: '/media/**' },
      { protocol: 'https', hostname: 'cdn.hashnode.com' },
    ],
  },
};
module.exports = nextConfig;
