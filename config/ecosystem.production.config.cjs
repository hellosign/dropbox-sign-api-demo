module.exports = {
  apps: [
    {
      name: 'sign-portal-production',
      script: 'server.js',
      // Update this path for your deployment environment
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      error_file: './logs/server-error.log',
      out_file: './logs/server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true
    }
  ]
};
