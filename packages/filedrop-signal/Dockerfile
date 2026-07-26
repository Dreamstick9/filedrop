# packages/filedrop-signal/Dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package definition and source code
COPY package*.json ./
COPY server.js ./

# Install production dependencies and set ownership to non-root node user
RUN npm ci --omit=dev || npm install --omit=dev && \
    chown -R node:node /app

# Expose default signaling port
EXPOSE 8080

# Environment defaults
ENV PORT=8080
ENV BIND_IP=0.0.0.0

# Run container as non-root user
USER node

# Command to run signaling server
CMD ["node", "server.js"]
