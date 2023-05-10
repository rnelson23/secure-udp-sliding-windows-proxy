const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');

const client = dgram.createSocket('udp4');
const host = '45.47.73.5';
const port = 3000;

let link = 'https://example.com';
let encryption = 'dhke';
let windowSize = 8;
let verbose = false;

for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('http')) { link = arg; }
    if (arg === '-v') { verbose = true; }
    if (arg === '-rsa') { encryption = 'rsa'; }
}

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

const primeFactorization = (n) => {
    const factors = [];

    a: for (let f = 2n; f * f <= n; f++) {
        for (let factor of factors) {
            if (f % factor === 0n) {
                continue a;
            }
        }

        if (n % f === 0n) {
            factors.push(f);

            while (n % f === 0n) {
                n /= f;
            }
        }
    }

    if (n > 1n) {
        factors.push(n);
    }

    return factors;
}

const generateGenerator = (p, factors) => {
    a: for (let g = 2n; g < p; g++) {
        for (const f of factors) {
            if (powerMod(g, (p - 1n) / f, p) === 1n) {
                continue a;
            }
        }

        return g;
    }
}

let header = Buffer.alloc(0);

let secret;
let prime;

let privKey;

if (encryption === 'dhke') {
    prime = crypto.generatePrimeSync(32, {bigint: true});
    secret = crypto.randomInt(3, (2 ** 48) - 3);
    const generator = generateGenerator(prime, primeFactorization(prime - 1n));

    header = Buffer.alloc(32 + Buffer.byteLength(link));

    header.write(link,
        header.writeBigInt64BE(powerMod(generator, secret, prime),
            header.writeBigInt64BE(generator,
                header.writeBigInt64BE(prime,
                    header.writeInt32BE(1,
                        header.writeInt32BE(windowSize))))));

} else if (encryption === 'rsa') {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    const pubKey = publicKey.export({ type: 'pkcs1', format: 'pem' });
    privKey = privateKey.export({ type: 'pkcs1', format: 'pem' });

    let pubKeyLength = Buffer.byteLength(pubKey);

    header = Buffer.alloc(12 + pubKeyLength + Buffer.byteLength(link));

    header.writeInt32BE(windowSize);
    header.writeInt32BE(2, 4);
    header.writeInt32BE(pubKeyLength, 8);
    header.write(pubKey, 12);
    header.write(link, 12 + pubKeyLength);
}

client.send(header, port, host, (err) => {
    if (err) { console.error(err); }
    console.log('\nSent request');
});

let key = Buffer.alloc(8);
let data = Buffer.alloc(0);
let lastPacket = windowSize;
let lastValid = null;
let numPackets = 0;
let timeout;

client.on('message', async (msg) => {
    clearTimeout(timeout);

    const seqNum = msg.readInt32BE();

    if (lastValid === null) {
        if (encryption === 'dhke') {
            key.writeBigInt64BE(powerMod(msg.readBigInt64BE(4), secret, prime));
        }

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
        let newData = msg.subarray(4);

        if (encryption === 'dhke') {
            for (let i = 0; i < newData.length; i++) {
                newData[i] = newData[i] ^ key[i % key.length];
            }

        } else if (encryption === 'rsa') {
            newData = crypto.privateDecrypt({
                key: privKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'

            }, newData);
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
