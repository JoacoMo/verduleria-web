import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // No anunciar el framework en cada respuesta (X-Powered-By: Next.js).
  poweredByHeader: false,
};

export default nextConfig;
