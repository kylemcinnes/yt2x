FROM node:20-slim

# OS deps for ffmpeg + yt-dlp
RUN apt-get update && apt-get install -y ffmpeg python3-pip && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm","start"]
