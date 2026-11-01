import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePolicy, captureNotice } from '../lib/capture-plan.js';
test('capture policy validates server allowance, with no silent paid-tier fallback', () => {
  for (const [plan, max_assets] of [['free',40],['pro',150],['max',500],['supermax',1500]]) assert.equal(capturePolicy({plan,max_assets}).max_assets,max_assets);
  for (const value of [null,{}, {plan:'pro',max_assets:NaN}, {plan:'supermax',max_assets:1501}, {plan:'supermax',max_assets:-1}, {plan:'supermax',max_assets:1.5}, {plan:'supermax',max_assets:'1500'}, {plan:'unknown',max_assets:40}]) assert.throws(()=>capturePolicy(value));
});
test('Flagsheep preserves server limits and its API identifier', () => {
  const policy = { plan: 'supermax', max_assets: 1500, limits: { max_files: 12000, max_file_bytes: 100 * 1024 ** 2, max_total_bytes: 2048 * 1024 ** 2 } };
  assert.deepEqual(capturePolicy(policy), policy);
  assert.equal(capturePolicy({ ...policy, max_assets: 0 }).max_assets, 0);
});
test('capture notice briefly explains the allowance and any assets left out', () => {
  assert.equal(captureNotice({plan:'free',limit:40,omitted:133}), 'Free: 40 assets per page. 133 left out.');
  assert.equal(captureNotice({plan:'max',limit:500,omitted:0}), 'Max: 500 assets per page.');
  assert.equal(captureNotice({plan:'supermax',limit:1500,omitted:1}), 'Flagsheep: 1500 assets per page. 1 left out.');
});
