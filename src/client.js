const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');

const client = dgram.createSocket('udp4');
const host = '45.47.73.5';
const port = 3000;

let link = 'https://example.com';
let windowSize = 8;
let verbose = false;

for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('http')) { link = arg; }
    if (arg === '-v') { verbose = true; }
}

const prime = Number(crypto.generatePrimeSync(31, { bigint: true }));
const secret = crypto.randomInt(3, 32);
const factors = [];

let phi = prime - 1;
let generator;

for (let num = 2; num * num <= phi; num++) {
    let isPrime = true;

    for (let i = 2; i < num; i++) {
        if (num % i === 0) { isPrime = false; }
    }

    if (!isPrime) { continue; }

    if (phi % num === 0) {
        factors.push(num);

        while (phi % num === 0) {
            phi /= num;
        }
    }
}

if (phi > 1) { factors.push(phi); }

for (let gen = 2; gen < prime; gen++) {
    let valid = true;

    for (const factor of factors) {
        if (gen ** ((prime - 1) / factor) % prime === 1) {
            valid = false;
            break;
        }
    }

    if (valid) {
        generator = gen;
        break;
    }
}

const header = Buffer.alloc(28 + Buffer.byteLength(link));

header.write(link,
    header.writeInt32BE(generator ** secret % prime,
        header.writeInt32BE(generator,
            header.writeInt32BE(prime,
                header.writeInt32BE(windowSize)))));

client.send(header, port, host, (err) => {
    if (err) { console.error(err); }
    console.log('\nSent request');
});

let key = Buffer.alloc(4);
let data = Buffer.alloc(0);
let lastPacket = windowSize;
let lastValid = null;
let numPackets = 0;
let timeout;

client.on('message', async (msg) => {
    clearTimeout(timeout);

    const seqNum = msg.readInt32BE();

    if (lastValid === null) {
        key.writeInt32BE(msg.readInt32BE(4) ** secret % prime);
        numPackets = seqNum;
        lastValid = 0;

        console.log(`Receiving ${numPackets} packets...`);
        return;
    }

    if (seqNum === -1) {
        const fileName = link.substring(link.lastIndexOf('/') + 1).match(/[^.]+/)[0];
        const fileType = msg.subarray(4).toString();

        await fs.writeFileSync(`output/${fileName}.${fileType}`, data);
        import('open').then(async (open) => {
            await open.default(`output/${fileName}.${fileType}`);
        });

        if (verbose) { console.log(); }
        console.log(`Received ${data.length} bytes`);
        console.log('Done!\n');

        client.close();
        return;
    }

    if (seqNum === lastValid + 1) {
        if (verbose && lastPacket === lastValid + windowSize) { console.log(); }
        if (verbose) { console.log(`   \x1b[1;94mReceived\x1b[0m ${seqNum}`); }

        const ack = Buffer.alloc(4);
        const newData = msg.subarray(4);

        for (let i = 0; i < newData.length; i++) {
            newData[i] = newData[i] ^ key[i % key.length];
        }

        lastValid++;
        ack.writeInt32BE(lastValid);
        data = Buffer.concat([data, newData]);

        if (lastValid === lastPacket) {
            client.send(ack, port, host, (err) => {
                if (err) { console.error(err); }
            });

            if (lastPacket + windowSize > numPackets) { windowSize = numPackets - lastPacket; }
            lastPacket += windowSize;
        }

        timeout = setTimeout(() => {
            client.send(ack, port, host, (err) => {
                if (err) { console.error(err); }
                if (verbose) { console.log(`   \x1b[1;31mDropping\x1b[0m ${lastValid + 1}`); }
            });

            if (lastValid + windowSize > numPackets) { windowSize = numPackets - lastValid; }
            lastPacket = lastValid + windowSize;

        }, 500);
    }
});
