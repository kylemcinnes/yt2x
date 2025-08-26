# Use bookworm so apt has ffmpeg packaged
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && curl -L https://github.com/yt-dlp/yt-dlp-nightly/releases/latest/download/yt-dlp_nightly \
      -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["npm","start"]
