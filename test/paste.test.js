import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePasteLine } from '../js/paste.js';

test('comma, tab and semicolon fields', () => {
  assert.deepEqual(parsePasteLine('72, 11 1/4, 2, Side, y'), { length: '72', width: '11 1/4', qty: '2', label: 'Side', grain: true });
  assert.deepEqual(parsePasteLine('72\t11 1/4\t2\tSide\tn'), { length: '72', width: '11 1/4', qty: '2', label: 'Side', grain: false });
  assert.deepEqual(parsePasteLine('30;15'), { length: '30', width: '15', qty: '1', label: '', grain: null });
});

test('optional fields default', () => {
  assert.deepEqual(parsePasteLine('30, 15, , Top'), { length: '30', width: '15', qty: '1', label: 'Top', grain: null });
  assert.equal(parsePasteLine('30, 15, 1, Top, grain').grain, true);
  assert.equal(parsePasteLine('30, 15, 1, Top, no').grain, false);
});

test('L x W and L x W x Q forms', () => {
  assert.deepEqual(parsePasteLine('30 x 15'), { length: '30', width: '15', qty: '1', label: '', grain: null });
  assert.deepEqual(parsePasteLine('23 1/2 X 11 1/4 x 4'), { length: '23 1/2', width: '11 1/4', qty: '4', label: '', grain: null });
  assert.deepEqual(parsePasteLine('600×300'), { length: '600', width: '300', qty: '1', label: '', grain: null });
});

test('lines without two sizes are rejected', () => {
  for (const bad of ['30', 'hello', ',', '30,', ', 15', 'x 15', '30 x']) {
    assert.equal(parsePasteLine(bad), null, bad);
  }
});
