# Use bookworm so apt has yt-dlp packaged
FROM node:20-bookworm-slim

# ffmpeg + yt-dlp from apt (no pip), plus certs for HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg yt-dlp ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["npm","start"]
