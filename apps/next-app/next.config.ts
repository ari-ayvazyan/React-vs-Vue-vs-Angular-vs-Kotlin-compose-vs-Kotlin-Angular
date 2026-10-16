import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async redirects() {
    // Query strings (e.g. ?seed=1000) are forwarded automatically.
    return [{ source: '/', destination: '/dashboard', permanent: false }];
  },
};

export default nextConfig;
