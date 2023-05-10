FROM node

WORKDIR /app

COPY package.json /app

RUN npm install

COPY src /app/src

CMD ["node", "src/server.js"]
