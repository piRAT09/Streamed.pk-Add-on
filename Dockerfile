FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY src/ ./src/

# Railway / Render inject PORT automatically
EXPOSE 7000

CMD ["node", "src/index.js"]
