import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePolicy, captureNotice } from '../lib/capture-plan.js';
test('capture policy validates server allowance, with no silent paid-tier fallback', () => {
  for (const [plan, max_assets] of [['free',40],['pro',150],['max',500]]) assert.equal(capturePolicy({plan,max_assets}).max_assets,max_assets);
  for (const value of [null,{}, {plan:'pro',max_assets:NaN}, {plan:'max',max_assets:1001}, {plan:'unknown',max_assets:40}]) assert.throws(()=>capturePolicy(value));
});
test('capture notice briefly explains the allowance and any assets left out', () => {
  assert.equal(captureNotice({plan:'free',limit:40,omitted:133}), 'Free: 40 assets per page. 133 left out.');
  assert.equal(captureNotice({plan:'max',limit:500,omitted:0}), 'Max: 500 assets per page.');
});
