const dgram = require('dgram');
const crypto = require('crypto');
const axios = require('axios');

const server = dgram.createSocket('udp4');
const port = 3000;

const powerMod = (n, e, p) => {
    const binary = e.toString(2).slice(1);
    let x = n;

    for (let digit of binary) {
        x *= x;

        if (digit === '1') {
            x *= n;
        }

        x %= p;
    }

    return x;
};

let pubKey;
let key = Buffer.alloc(8);
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

        let encryption = msg.readInt32BE(4);
        let linkStart = 32;

        let prime;
        let secret;
        let generator;

        if (encryption === 1) {
            prime = msg.readBigInt64BE(8);
            generator = msg.readBigInt64BE(16);
            secret = crypto.randomInt(3, 32);

            key.writeBigInt64BE(powerMod(msg.readBigInt64BE(24), secret, prime));

        } else if (encryption === 2) {
            pubKey = msg.subarray(12, 12 + msg.readInt32BE(8)).toString(); // this means I can read the key separately from the link
            linkStart = 12 + msg.readInt32BE(8);
        }

        windowSize = ack;
        lastSent = 0;
        ack = 0;

        const file = await axios
            .get(msg.subarray(linkStart).toString(), { responseType: 'arraybuffer' })
            .then((res) => {
                console.log(`Cached ${res.data.length} bytes`);

                fileType = res.headers['content-type'].split('/')[1].match(/\w+/)[0];
                return Buffer.from(res.data);
            });

        const packetSize = 64;
        const numPackets = Math.ceil(file.length / packetSize);

        for (let i = 0; i < numPackets; i++) {
            const data = file.subarray(i * packetSize, i * packetSize + packetSize);
            let packet = Buffer.alloc(4 + data.length);

            if (encryption === 1) {
                for (let j = 0; j < data.length; j++) {
                    packet[j + 4] = data[j] ^ key[j % key.length];
                }

            } else if (encryption === 2) {
                const encrypted = crypto.publicEncrypt({
                    key: pubKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256'

                }, data);

                packet = Buffer.alloc(4 + encrypted.length);

                const temp = Buffer.alloc(encrypted.length);
                temp.write(encrypted.toString('base64'), 'base64');
                temp.copy(packet, 4);
            }

            packet.writeInt32BE(i + 1);
            packets.push(packet);
        }

        let header = Buffer.alloc(0);

        if (encryption === 1) {
            header = Buffer.alloc(12);

            header.writeBigInt64BE(powerMod(generator, secret, prime),
                header.writeInt32BE(numPackets));

        } else if (encryption === 2) {
            header = Buffer.alloc(4);

            header.writeInt32BE(numPackets);
        }

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
