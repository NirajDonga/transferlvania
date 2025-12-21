FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --production
RUN npx prisma generate

COPY dist ./dist

EXPOSE 4000

CMD ["node", "dist/index.js"]