const dgram = require('dgram');
const fs = require('fs');

const client = dgram.createSocket('udp4');
const host = '45.47.73.5';
const port = 3000;

let link = 'https://ellie.hep.gg/spin';
let windowSize = 8;
let verbose = false;

for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('http')) { link = arg; }
    if (arg === '-v') { verbose = true; }
}

const header = Buffer.alloc(4 + Buffer.byteLength(link));

header.writeInt32BE(windowSize);
header.write(link, 4);

client.send(header, port, host, (err) => {
    if (err) { console.error(err); }
    console.log('\nSent request');
});

let data = Buffer.alloc(0, 0, 'binary');
let lastPacket = windowSize;
let numPackets = 0;
let lastValid = null;
let timeout;

client.on('message', async (msg) => {
    if (lastValid === null) {
        numPackets = msg.readInt32BE();
        console.log(`Receiving ${numPackets} packets...`);
        lastValid = 0;

        return;
    }

    const ack = Buffer.alloc(4);
    const seqNum = msg.readInt32BE();

    clearTimeout(timeout);

    if (seqNum === -1) {
        const fileName = link.substring(link.lastIndexOf('/') + 1).match(/[^.]+/)[0];
        const fileType = msg.subarray(4).toString();

        if (verbose) { console.log(); }
        console.log(`Received ${data.length} bytes`);
        console.log('Done!');

        await fs.writeFileSync(`output/${fileName}.${fileType}`, data.toString('binary'), { encoding: 'binary' });
        import('open').then(async (open) => {
            await open.default(`output/${fileName}.${fileType}`);
        });

        console.log();
        client.close();
        return;
    }

    if (seqNum === lastValid + 1) {
        if (verbose && lastPacket === lastValid + windowSize) { console.log(); }
        if (verbose) { console.log(`   \x1b[1;94mReceived\x1b[0m ${seqNum}`); }

        data = Buffer.concat([data, msg.subarray(4)]);
        lastValid++;
    }

    ack.writeInt32BE(lastValid);

    if (lastValid === lastPacket) {
        client.send(ack, port, host, (err) => {
            if (err) { console.error(err); }
        });

        if (lastPacket + windowSize > numPackets) { windowSize = numPackets - lastPacket; }
        lastPacket += windowSize;
    }

    timeout = setTimeout(() => {
        if (verbose) { console.log(`   \x1b[1;31mDropping\x1b[0m ${lastValid + 1}`); }
        lastPacket = lastValid + windowSize;

        client.send(ack, port, host, (err) => {
            if (err) { console.error(err); }
        });

    }, 500);
});
