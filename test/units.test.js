import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength, formatLength, convertText } from '../js/units.js';

const IN = 64000;

test('parses plain and decimal inches', () => {
  assert.equal(parseLength('96', 'in'), 96 * IN);
  assert.equal(parseLength('96.5', 'in'), 96.5 * IN);
  assert.equal(parseLength('.5', 'in'), 0.5 * IN);
  assert.equal(parseLength('7.', 'in'), 7 * IN);
  assert.equal(parseLength('  12  ', 'in'), 12 * IN);
  assert.equal(parseLength('0', 'in'), 0);
});

test('parses fractions and mixed numbers', () => {
  assert.equal(parseLength('1/8', 'in'), IN / 8);
  assert.equal(parseLength('1 / 64', 'in'), 1000);
  assert.equal(parseLength('23 1/2', 'in'), 23.5 * IN);
  assert.equal(parseLength('23-1/2', 'in'), 23.5 * IN);
  assert.equal(parseLength('23 - 1/2', 'in'), 23.5 * IN);
  assert.equal(parseLength('3/2', 'in'), 1.5 * IN);
});

test('parses inch and feet marks', () => {
  assert.equal(parseLength('23 1/2"', 'in'), 23.5 * IN);
  assert.equal(parseLength('12in', 'in'), 12 * IN);
  assert.equal(parseLength('12 inches', 'in'), 12 * IN);
  assert.equal(parseLength("8'", 'in'), 96 * IN);
  assert.equal(parseLength('4ft', 'in'), 48 * IN);
  assert.equal(parseLength(`4' 2 1/2"`, 'in'), 50.5 * IN);
  assert.equal(parseLength("4'-6", 'in'), 54 * IN);
  assert.equal(parseLength("1.5'", 'in'), 18 * IN);
});

test('rejects invalid inch input', () => {
  for (const bad of ['', '   ', 'abc', '-5', '1/0', '5 1/0', '1//2', '2 3', "'", '"', '1.2.3', null, undefined, {}]) {
    assert.equal(parseLength(bad, 'in'), null, `input ${JSON.stringify(bad)}`);
  }
  assert.equal(parseLength(-1, 'in'), null);
  assert.equal(parseLength(NaN, 'in'), null);
  assert.equal(parseLength(Infinity, 'in'), null);
});

test('parses numbers directly', () => {
  assert.equal(parseLength(48, 'in'), 48 * IN);
  assert.equal(parseLength(2440, 'mm'), 2440000);
});

test('parses millimeters', () => {
  assert.equal(parseLength('2440', 'mm'), 2440000);
  assert.equal(parseLength('2440mm', 'mm'), 2440000);
  assert.equal(parseLength('3.2 mm', 'mm'), 3200);
  assert.equal(parseLength('1/2', 'mm'), null);
  assert.equal(parseLength('-3', 'mm'), null);
  assert.equal(parseLength("8'", 'mm'), null);
});

test('formats inches as reduced fractions', () => {
  assert.equal(formatLength(23.5 * IN, 'in'), '23 1/2');
  assert.equal(formatLength(IN / 8, 'in'), '1/8');
  assert.equal(formatLength(1000, 'in'), '1/64');
  assert.equal(formatLength(3000, 'in'), '3/64');
  assert.equal(formatLength(96 * IN, 'in'), '96');
  assert.equal(formatLength(0, 'in'), '0');
  assert.equal(formatLength(-IN / 2, 'in'), '-1/2');
});

test('formats non-1/64 inches as decimals', () => {
  assert.equal(formatLength(Math.round(0.1 * IN), 'in'), '0.1');
  assert.equal(formatLength(1, 'in'), '0');
});

test('formats millimeters', () => {
  assert.equal(formatLength(2440000, 'mm'), '2440');
  assert.equal(formatLength(3200, 'mm'), '3.2');
  assert.equal(formatLength(3206, 'mm'), '3.21');
});

test('converts between units', () => {
  assert.equal(convertText('96', 'in', 'mm'), '2438.4');
  assert.equal(convertText('1/8', 'in', 'mm'), '3.2');
  assert.equal(convertText('25.4', 'mm', 'in'), '1');
  assert.equal(convertText('3.175', 'mm', 'in'), '1/8');
  assert.equal(convertText('48', 'in', 'in'), '48');
  assert.equal(convertText('junk', 'in', 'mm'), 'junk');
});
