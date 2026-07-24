# packages/filedrop-signal/Dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package definition and lockfile
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source code
COPY server.js ./

# Expose default signaling port
EXPOSE 8080

# Environment defaults
ENV PORT=8080
ENV BIND_IP=0.0.0.0

# Command to run signaling server
CMD ["node", "server.js"]
