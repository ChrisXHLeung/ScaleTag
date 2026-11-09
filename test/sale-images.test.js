import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { saleImages } from '../src/sale-images.js';

test('real original raster uploads obey thresholds and strip metadata', async () => {
  // An incompressible PNG lies between 600 KiB and 1 MiB before re-encoding.
  const original = await sharp(randomBytes(500 * 500 * 3), {raw:{width:500,height:500,channels:3}})
    .withMetadata({exif:{IFD0:{Artist:'Private seller'}}}).png().toBuffer();
  assert.ok(original.length > 614400 && original.length <= 1048576);
  const [url] = await saleImages([`data:image/png;base64,${original.toString('base64')}`]);
  const output = Buffer.from(url.split(',')[1], 'base64');
  assert.ok(output.length <= 307200);
  const meta = await sharp(output).metadata();
  assert.equal(meta.exif,undefined);assert.equal(meta.width,500);assert.equal(meta.height,500);
  const small = await sharp({create:{width:20,height:20,channels:3,background:'#123456'}}).png().toBuffer();
  const [smallUrl] = await saleImages([`data:image/png;base64,${small.toString('base64')}`]);
  assert.ok(Buffer.from(smallUrl.split(',')[1],'base64').length <= 614400);
  for (const value of [
    `data:image/jpeg;base64,${small.toString('base64')}`,
    `data:image/png;base64,${original.subarray(0,400).toString('base64')}`,
    `data:image/png;base64,${Buffer.alloc(1048577).toString('base64')}`,
    'data:image/svg+xml;base64,PHN2Zy8+',
  ]) await assert.rejects(saleImages([value]),e=>e.status===400);
  const bomb=await sharp({create:{width:4096,height:4096,channels:3,background:'#123456'}}).png().toBuffer();
  await assert.rejects(saleImages([`data:image/png;base64,${bomb.toString('base64')}`]), e=>e.status===400);
});
