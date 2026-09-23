FROM node:22-alpine

WORKDIR /app
ENV PORT=3000 NODE_ENV=production

COPY package.json ./package.json
RUN npm install --omit=dev
COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "server.js"]
