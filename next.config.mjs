/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Legacy misspelled route — the page moved to /bazaar
      {
        source: '/bazzar',
        destination: '/bazaar',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
