FROM node:25.8-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

CMD ["npm", "run", "dev"]
