const dgram = require('dgram');
const fs = require('fs');

const client = dgram.createSocket('udp4');

const host = '45.47.73.5';
// const host = 'localhost';
const port = 3000;

// let link = 'https://example.com';
let link = 'https://ellie.hep.gg/spin';
// let link = 'https://ellie.hep.gg/l7acw6nTE';
// let link = 'https://gee.cs.oswego.edu/dl/csc445/a2.html';
// let link = 'https://stackoverflow.com/questions/25647004/difference-between-webstorm-and-phpstorm';

if (process.argv[process.argv.length - 1].startsWith('http')) {
    link = process.argv[process.argv.length - 1];
}

let window = 8;
// let window = 16;

let dropFlag = false;
let verbose = false;

for (const arg of process.argv.slice(2)) {
    if (arg === '-d') { dropFlag = true; }
    if (arg === '-v') { verbose = true; }
    if (arg === '-w') { window = parseInt(process.argv[process.argv.indexOf('-w') + 1]); }
}

const header = Buffer.alloc(Buffer.byteLength(link) + 12);

header.writeInt32BE(window);
header.writeBigInt64BE(BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)), 4);
header.write(link, 12);

client.send(header, port, host, (err) => {
    if (err) { console.error(err); }
    console.log('\nSent request');
});

let data = Buffer.alloc(0, 0, 'binary');
let active = false;
let max = window;
let last = 0;
let timeout;
let drop = new Set();
let key;
let start;
let end;

client.on('message', async (msg) => {
    if (!active) {
        start = Date.now();
        let len = msg.readInt32BE();
        key = msg.readBigInt64BE(4);
        active = true;

        if (dropFlag) {
            for (let i = 0; i < Math.ceil(len * 0.01); i++) {
                drop.add(Math.floor(Math.random() * len) + 1);
            }
        }

        if (drop.size > 0) { console.log(`Dropping ${drop.size} packets`); }
        console.log(`Receiving ${len} packets...`);

        return;
    }

    const ack = Buffer.alloc(4, 0, 'binary');
    const seqNum = msg.readInt32BE();

    clearTimeout(timeout);

    if (seqNum === -1) {
        end = Date.now();

        const fileName = link.substring(link.lastIndexOf('/') + 1).match(/[^.]+/)[0];
        const fileType = msg.subarray(4).toString('binary');

        const size = (data.length * 8) / 1000000;
        const time = (end - start) / 1000;
        const throughput = Math.round((size / time) * 100) / 100;

        if (verbose) { console.log(); }
        console.log(`Received at ${throughput} Mbps`);
        console.log('Done!');

        await fs.writeFileSync(`output/${fileName}.${fileType}`, data.toString('binary'), { encoding: 'binary' });
        import('open').then(async (open) => {
            await open.default(`output/${fileName}.${fileType}`);
        });

        console.log();
        client.close();
        return;
    }

    if (seqNum === last + 1) {
        if (verbose && max === last + window) { console.log(); }

        if (drop.has(seqNum)) {
            if (verbose) { console.log(`   Dropped packet ${seqNum}`); }
            drop.delete(seqNum);

        } else {
            if (verbose) { console.log(`   Received packet ${seqNum}`); }
            let packet = msg.subarray(4).toString('binary');

            for (let i = 0; i < key.length; i++) {
                packet[i] = packet.charCodeAt(i) ^ key.charCodeAt(i);
            }

            data = Buffer.concat([data, Buffer.from(packet, 'binary')]);
            last++;
        }
    }

    ack.writeInt32BE(last);

    if (last === max) {
        client.send(ack, port, host, (err) => {
            if (err) {
                console.log(err);
            }
        });

        max += window;
    }

    timeout = setTimeout(() => {
        max = last + window;

        client.send(ack, port, host, (err) => {
            if (err) {
                console.log(err);
            }
        });

        if (verbose) { console.log(`   Timeout packet ${last + 1}`); }

    }, 50);
});
