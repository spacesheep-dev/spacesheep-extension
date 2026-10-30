import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePolicy, captureNotice } from '../lib/capture-plan.js';
test('capture policy validates server allowance, with no silent paid-tier fallback', () => {
  for (const [plan, max_assets] of [['free',40],['pro',150],['max',500]]) assert.equal(capturePolicy({plan,max_assets}).max_assets,max_assets);
  for (const value of [null,{}, {plan:'pro',max_assets:NaN}, {plan:'pro',max_assets:-1}, {plan:'pro',max_assets:'150'}, {plan:'',max_assets:40}, {max_assets:40}, {plan:{},max_assets:40}]) assert.throws(()=>capturePolicy(value));
});
test('a plan the extension has never heard of is taken as the server gives it', () => {
  // The server adds plans without a new extension: one above Max carries 1,500 assets.
  assert.deepEqual(capturePolicy({plan:'enterprise',max_assets:1500,limits:{max_files:12000}}), {plan:'enterprise',max_assets:1500,limits:{max_files:12000}});
  assert.equal(captureNotice({plan:'enterprise',limit:1500,omitted:0}), 'Enterprise: 1500 assets per page.');
});
test('capture notice briefly explains the allowance and any assets left out', () => {
  assert.equal(captureNotice({plan:'free',limit:40,omitted:133}), 'Free: 40 assets per page. 133 left out.');
  assert.equal(captureNotice({plan:'max',limit:500,omitted:0}), 'Max: 500 assets per page.');
});
