# Dockerfile for Dropbox Sign API Demo Portal
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Expose port
EXPOSE 3001

# Start the application (skip prestart setup wizard in Docker)
CMD ["node", "server.js"]
