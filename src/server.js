const dgram = require('dgram');
const crypto = require('crypto');
const axios = require('axios');

const server = dgram.createSocket('udp4');
const port = 3000;

let key = Buffer.alloc(4);
let lastSent = null;
let packets = [];
let windowSize;
let fileType;
let timeout;

server.on('message', async (msg, rinfo) => {
    clearTimeout(timeout);

    let ack = msg.readInt32BE();
    if (ack < lastSent) { lastSent = ack; }

    if (lastSent === null) {
        console.log('\nReceived request');

        const prime = msg.readInt32BE(4);
        const generator = msg.readInt32BE(8);
        const secret = crypto.randomInt(3, 32);

        key.writeInt32BE(msg.readInt32BE(12) ** secret % prime);
        windowSize = ack;
        lastSent = 0;
        ack = 0;

        const file = await axios
            .get(msg.subarray(16).toString(), { responseType: 'arraybuffer' })
            .then((res) => {
                console.log(`Cached ${res.data.length} bytes`);

                fileType = res.headers['content-type'].split('/')[1].match(/\w+/)[0];
                return Buffer.from(res.data);
            });

        const packetSize = 512;
        const numPackets = Math.ceil(file.length / packetSize);

        for (let i = 0; i < numPackets; i++) {
            const data = file.subarray(i * packetSize, i * packetSize + packetSize);
            const packet = Buffer.alloc(4 + data.length);

            for (let j = 0; j < data.length; j++) {
                packet[j + 4] = data[j] ^ key[j % key.length];
            }

            packet.writeInt32BE(i + 1);
            packets.push(packet);
        }

        const header = Buffer.alloc(12);

        header.writeInt32BE(generator ** secret % prime,
            header.writeInt32BE(numPackets));

        server.send(header, rinfo.port, rinfo.address, (err) => {
            if (err) { console.error(err); }
            console.log(`Sending ${numPackets} packets...`);
        });
    }

    if (ack < packets.length) {
        for (let i = 0; i < windowSize; i++) {
            const seqNum = lastSent + i;
            if (seqNum >= packets.length) { break; }

            server.send(packets[seqNum], rinfo.port, rinfo.address, (err) => {
                if (err) { console.error(err); }
            });
        }

        lastSent += windowSize;

        timeout = setTimeout(() => {
            console.log('Aborted!');

            key = Buffer.alloc(4);
            lastSent = null;
            packets = [];

        }, 10000);
    }

    if (ack === packets.length) {
        let packet = Buffer.alloc(4 + fileType.length);

        packet.writeInt32BE(-1);
        packet.write(fileType, 4);

        key = Buffer.alloc(4);
        lastSent = null;
        packets = [];

        server.send(packet, rinfo.port, rinfo.address, (err) => {
            if (err) { console.error(err); }
            console.log('Done!');
        });
    }
});

server.bind(port, () => {
    console.log(`Listening on port ${port}`);
});
