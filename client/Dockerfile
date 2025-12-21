FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --production

COPY .next ./.next
COPY next.config.ts ./

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]