# Stage 1: Build the React frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Node.js backend
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production

# Copy backend source
COPY index.js agent.js executor.js trajectoryEngine.js datastore.js seed.js .env* ./

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port (Cloud Run sets PORT env var automatically, but we default to 3000)
ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
