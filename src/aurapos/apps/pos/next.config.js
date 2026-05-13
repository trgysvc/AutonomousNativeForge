const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
});

module.exports = withPWA({
  output: 'export',
  images: {
    domains: ['images.unsplash.com', 'example.com'],
  },
});