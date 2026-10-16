import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POINTS, pointsOf } from '../src/scope.ts';
import { pointsFrom } from '../server/scope.js';

test('pointsOf defaults to 3 when unset or invalid', () => {
  assert.equal(DEFAULT_POINTS, 3);
  assert.equal(pointsOf({ points: null }), 3);
  assert.equal(pointsOf({}), 3);
  assert.equal(pointsOf({ points: 0 }), 3);
  assert.equal(pointsOf({ points: 8 }), 8);
});

test('pointsFrom takes the first numeric Points value', () => {
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: null }, { fieldValueByName: { name: '5' } }] }), 5);
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: { name: 'XL' } }] }), null);
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: { name: '5XL' } }, { fieldValueByName: { name: '2' } }] }), 2);
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: { number: 2 } }] }), 2);
  assert.equal(pointsFrom(undefined), null);
});
