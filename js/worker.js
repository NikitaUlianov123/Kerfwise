import { solve } from './packer.js';
import { verifySolution } from './verify.js';

self.onmessage = (event) => {
  const { id, input, options } = event.data;
  try {
    const result = solve(input, options);
    let problems = [];
    if (!result.errors) {
      problems = verifySolution(input, result);
    }
    self.postMessage({ id, result, problems });
  } catch (err) {
    let message = String(err);
    if (err && err.message) {
      message = err.message;
    }
    self.postMessage({ id, failure: message });
  }
};
