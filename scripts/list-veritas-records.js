#!/usr/bin/env node

const { Connection, PublicKey } = require("@solana/web3.js");

const PROGRAM_ID = new PublicKey("4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi");
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const VIDEO_RECORD_DISCRIMINATOR = Buffer.from([
  0x40, 0x86, 0x1b, 0x88, 0x73, 0xc7, 0x00, 0x1d,
]);

function readString(buf, offset, maxLength) {
  if (offset + 4 > buf.length) throw new Error("Invalid string offset");
  const len = buf.readUInt32LE(offset);
  if (len > maxLength) throw new Error("Invalid string length");
  if (offset + 4 + len > buf.length) throw new Error("Invalid string data");

  return [buf.slice(offset + 4, offset + 4 + len).toString("utf8"), offset + 4 + len];
}

function decodeVideoRecord(data) {
  if (data.length < 8 || !data.subarray(0, 8).equals(VIDEO_RECORD_DISCRIMINATOR)) {
    throw new Error("Not a Veritas VideoRecord account");
  }

  let offset = 8;
  const [watermarkId, o1] = readString(data, offset, 32); offset = o1;
  const [videoHash, o2] = readString(data, offset, 64); offset = o2;
  const [sourceId, o3] = readString(data, offset, 32); offset = o3;
  const [sourceName, o4] = readString(data, offset, 64); offset = o4;

  if (offset + 8 + 32 > data.length) throw new Error("Invalid record data");
  const timestamp = Number(data.readBigInt64LE(offset)); offset += 8;
  const registeredBy = new PublicKey(data.subarray(offset, offset + 32)).toBase58();

  return { watermarkId, videoHash, sourceId, sourceName, timestamp, registeredBy };
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const accounts = await connection.getProgramAccounts(PROGRAM_ID);
  const records = [];

  for (const { pubkey, account } of accounts) {
    try {
      records.push({
        account: pubkey.toBase58(),
        ...decodeVideoRecord(Buffer.from(account.data)),
      });
    } catch {
      // Ignore non-VideoRecord accounts owned by the same program.
    }
  }

  records.sort((a, b) => b.timestamp - a.timestamp);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Records: ${records.length}`);

  console.table(records.map((record) => ({
    time: new Date(record.timestamp * 1000).toISOString(),
    source: record.sourceName,
    hash: record.videoHash,
    watermark: record.watermarkId,
    registeredBy: record.registeredBy,
    account: record.account,
  })));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
