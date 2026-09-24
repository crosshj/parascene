FROM node:22-alpine

WORKDIR /app
ENV PORT=3000 NODE_ENV=production

RUN apk add --no-cache ffmpeg \
	&& command -v ffmpeg \
	&& command -v ffprobe

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "server.js"]
