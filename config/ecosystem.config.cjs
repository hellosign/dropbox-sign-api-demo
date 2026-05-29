module.exports = {
  apps: [
    {
      name: 'sign-portal-dev',
      script: 'server.js',
      // Update this path for your development environment
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: true,  // Enable watch for development
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3001
      },
      error_file: './logs/server-error.log',
      out_file: './logs/server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true
    }
  ]
};
