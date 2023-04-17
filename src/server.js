const dgram = require('dgram');
const axios = require('axios');

const server = dgram.createSocket('udp4');
const port = 3000;

let windowSize = 0;
let lastSent = null;
let packets = [];
let fileType;
let timeout;

server.on('message', async (msg, rinfo) => {
    let ack = msg.readInt32BE();
    clearTimeout(timeout);

    if (lastSent === null) {
        console.log('\nReceived request');
        
        const url = msg.subarray(4).toString();
        windowSize = ack;
        
        const file = await axios
            .get(url, { responseType: 'arraybuffer', responseEncoding: 'binary' })
            .then((res) => {
                console.log(`Cached ${res.data.length} bytes`);
                
                fileType = res.headers['content-type'].split('/')[1];
                return Buffer.from(res.data, 0, 2);
            });

        for (let i = 0; i < Math.ceil(file.length / 512); i++) {
            const offset = i * 512;
            const data = file.subarray(offset, offset + 512).toString('binary');
            const packet = Buffer.alloc(4 + data.length, 0, 'binary');

            packet.writeInt32BE(i + 1);
            packet.write(data, 4, 'binary');

            packets.push(packet);
        }

        console.log(`Sending ${packets.length} packets...`);

        const header = Buffer.alloc(4);
        header.writeInt32BE(packets.length);

        server.send(header, rinfo.port, rinfo.address, (err) => {
            if (err) { console.error(err); }
        });

        lastSent = 0;
        ack = 0;
    }

    if (ack < lastSent) { lastSent = ack; }
    
    if (ack === packets.length) {
        let packet = Buffer.alloc(4);
        
        packet.writeInt32BE(-1);
        packet.write(fileType.match(/\w+/)[0], 4);

        server.send(packet, rinfo.port, rinfo.address, (err) => {
            if (err) { console.error(err); }
        });

        packets = [];
        windowSize = 0;
        lastSent = null;

        console.log('Done!');
        return;
    }

    for (let i = 0; i < windowSize; i++) {
        const seqNum = lastSent + i;
        if (seqNum >= packets.length) { break; }

        server.send(packets[seqNum], rinfo.port, rinfo.address, (err) => {
            if (err) { console.error(err); }
        });
    }

    lastSent += windowSize;

    timeout = setTimeout(() => {
        packets = [];
        windowSize = 0;
        lastSent = null;

        console.log('Aborted!');

    }, 10000);
});

server.bind(port, () => {
    console.log(`Listening on port ${port}`);
});
