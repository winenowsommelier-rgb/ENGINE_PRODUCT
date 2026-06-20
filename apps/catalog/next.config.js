/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'th.wine-now.com', pathname: '/media/**' },
    ],
  },
};
module.exports = nextConfig;
