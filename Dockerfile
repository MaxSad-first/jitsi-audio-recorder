FROM node:20-bookworm-slim

# python3/make/g++ are needed to install @roamhq/wrtc's native prebuilt binding
# (it ships prebuilds for common platforms, but npm still runs node-gyp-ish
# postinstall checks). ffmpeg is used to encode the mixed PCM stream to Opus.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=3000
ENV OUTPUT_DIR=/recordings
ENV VENDOR_DIR=/app/vendor

EXPOSE 3000
VOLUME ["/recordings"]

CMD ["node", "src/index.js"]
