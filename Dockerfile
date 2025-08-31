FROM node:20-bookworm-slim

# ffmpeg + stable yt-dlp; verify after download
RUN set -eux; \
  apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3; \
  curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp; \
  chmod a+rx /usr/local/bin/yt-dlp; \
  /usr/local/bin/yt-dlp --version; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["npm","start"]
