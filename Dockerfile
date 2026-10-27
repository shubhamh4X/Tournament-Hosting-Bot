FROM node:22-alpine

WORKDIR /app

COPY package*.json .npmrc* ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "index.js"]
