FROM node

WORKDIR /usr/src/app

COPY package.json /usr/src/app

RUN npm install

COPY src /usr/src/app/src

EXPOSE 3000

CMD ["node", "src/server.js"]
