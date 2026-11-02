// Convert a legacy archive via stdin/stdout; no plaintext temporary files.
import { encryptDocument, decryptDocument, parseEncryptionKey } from './encryption.js';
const key=parseEncryptionKey(process.env.SCALETAG_ENCRYPTION_KEY);
const parts=[];for await(const chunk of process.stdin) parts.push(chunk);
const raw=Buffer.concat(parts);
try {
 if(process.argv.includes('--encrypt')) {
  const output=encryptDocument({content:raw.toString('base64')},key,'scaletag:legacy-archive:v1');
  if(!Buffer.from(decryptDocument(output,key,'scaletag:legacy-archive:v1').content,'base64').equals(raw)) throw Error('Archive encryption verification failed');
  process.stdout.write(output);
 } else {
  const data=decryptDocument(raw.toString(),key,'scaletag:legacy-archive:v1');
  if(!process.argv.includes('--verify')) process.stdout.write(Buffer.from(data.content,'base64'));
 }
} finally {key.fill(0);}
