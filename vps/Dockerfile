FROM node:22-alpine

WORKDIR /app
ENV PORT=3000

COPY server.js ./server.js
COPY index.html ./index.html

EXPOSE 3000

CMD ["node", "server.js"]
