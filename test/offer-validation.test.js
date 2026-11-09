import test from 'node:test';
import assert from 'node:assert/strict';
import { offerInput, looksLikeContact } from '../src/validation.js';
const base={name:'Buyer',message:'Interested',amount:'CAD 40',email:'buyer@example.com',privacyAccepted:true,nonBindingAccepted:true};
test('public offer amounts accept currency amounts and reject contact or arbitrary text',()=>{
 for(const amount of ['555-1234','416/555/1234','buyer@example.com','call me','2026-11-09','-20','1e5','Infinity','NaN']) assert.throws(()=>offerInput({...base,amount}),e=>e.status===400,amount);
 for(const amount of ['CAD 40','40 CAD','$40.50','¥120','C$1,200.00','0','25.99','EUR 1234.50']) assert.equal(offerInput({...base,amount}).amount,amount);
});
test('public names and messages reject common local and full telephone forms without rejecting dates or prices',()=>{
 for(const value of ['416/555/1234','555-1234','555.1234','555 1234','(416) 555-1234','4165551234','+44 20 7946 0958','416-555-1234 x123']) {
  assert.equal(looksLikeContact(value),true,value);
  for(const field of ['name','message']) assert.throws(()=>offerInput({...base,[field]:value}),e=>e.status===400,`${field}: ${value}`);
 }
 for(const value of ['2026-11-09','2026/11/09','CAD 30','At 10:00','25.99','CAD 1,200.00','Lot 123','2026-11-09 10:00']) assert.equal(looksLikeContact(value),false,value);
});
