const dgram = require('dgram');
const axios = require("axios");

const server = dgram.createSocket('udp4');

const port = 3000;

let key = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
let active = false;
let packets = [];
let window = 0;
let last = 0;
let fileType;

const token = 'Nzk4NzM4MjAzMzM4NDczNDky.GOg-AV.iWw07kzUW5R5t6nls9OdvkbR1wp5zZf60HOnMQ';

server.on('message', async (msg, rinfo) => {
    let ack = msg.readInt32BE();

    if (!active) {
        const url = msg.subarray(12).toString();
        window = msg.readInt32BE();
        key = key ^ Number(msg.readBigInt64BE(4));

        console.log('\nReceived request');

        let file = await axios
            .get(url, { responseType: 'arraybuffer', responseEncoding: 'binary' })
            .then((res) => {
                console.log(`Cached ${res.data.length} bytes`);
                fileType = res.headers['content-type'].split('/')[1];
                return Buffer.from(res.data, 0, 2);
            });

        for (let i = 0; i < Math.ceil(file.length / 512); i++) {
            const data = file.subarray(i * 512, (i * 512) + 512).toString('binary');
            const packet = Buffer.alloc(data.length + 4, 0, 'binary');

            for (let j = 0; j < key.length; j++) {
                data[j] = data.charCodeAt(j) ^ key.charCodeAt(j);
            }

            packet.writeInt32BE(i + 1);
            packet.write(data, 4, 'binary');

            packets.push(packet);
        }

        console.log(`Sending ${packets.length} packets...`);

        const header = Buffer.alloc(12);
        header.writeInt32BE(packets.length);
        header.writeBigInt64BE(BigInt(key), 4);

        server.send(header, rinfo.port, rinfo.address, (err) => {
            if (err) { console.log(err); }
        });

        active = true;
        ack = 0;
    }

    if (ack < last) { last = ack; }

    if (ack === packets.length) {
        let packet = Buffer.alloc(4, 0, 'binary');
        packet.writeInt32BE(-1);
        packet = Buffer.concat([packet, Buffer.from(fileType.match(/\w+/)[0], 'binary')]);

        active = false;
        packets = [];
        window = 0;
        last = 0;

        server.send(packet, rinfo.port, rinfo.address, (err) => {
            if (err) {
                console.log(err);
            }
        });

        console.log('Done!');
        return;
    }

    for (let i = 0; i < window; i++) {
        if (last + i >= packets.length) { break; }

        server.send(packets[last + i], rinfo.port, rinfo.address, (err) => {
            if (err) {
                console.log(err);
            }
        });
    }

    last += window;
});

server.bind(port, () => {
    console.log(`Listening on port ${port}`);
});
