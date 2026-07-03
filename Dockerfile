# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Backend and serve
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production

# Copy backend source
COPY index.js agent.js executor.js trajectoryEngine.js datastore.js seed.js ./

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
