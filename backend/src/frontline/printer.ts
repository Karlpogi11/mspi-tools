import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 4000;

function connect(ip: string, port: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port });
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    socket.setTimeout(timeoutMs, () => fail(new Error('Printer connection timed out.')));
    socket.once('error', fail);
    socket.once('connect', () => { socket.removeListener('error', fail); resolve(socket); });
  });
}

export async function testPrinterConnection(ip: string, port: number): Promise<void> {
  const socket = await connect(ip, port);
  socket.end();
}

function code128Barcode(value: string): Buffer {
  if (!/^[\x20-\x7e]+$/.test(value)) throw new Error('AR number contains unsupported barcode characters.');
  const data = Buffer.from(value, 'ascii');
  if (data.length === 0 || data.length > 255) throw new Error('AR number is not valid for barcode printing.');
  const codeSetB = Buffer.from([0x7b, 0x42]);
  return Buffer.concat([
    Buffer.from([0x1d, 0x68, 48, 0x1d, 0x77, 1, 0x1d, 0x48, 0]),
    Buffer.from([0x1d, 0x6b, 0x49, data.length + codeSetB.length]), codeSetB, data,
  ]);
}

export async function printRawArLabel(ip: string, port: number, arNumber: string): Promise<void> {
  const socket = await connect(ip, port);
  const ar = arNumber.trim();
  const payload = Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01, 0x1d, 0x21, 0x33]),
    Buffer.from(`${ar}\n`, 'ascii'),
    Buffer.from([0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00]),
    code128Barcode(ar),
    Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]),
  ]);
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.end(payload, resolve);
  });
}
