FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p uploads processed temp

ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
