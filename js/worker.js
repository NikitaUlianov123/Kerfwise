import { solve } from './packer.js';
import { verifySolution } from './verify.js';

// One job per material: { id, jobs: [{ materialId, input }], options } → { id, results: [{ materialId, result, problems }] }
self.onmessage = (event) => {
  const { id, jobs, options } = event.data;
  try {
    const results = jobs.map((job) => {
      const result = solve(job.input, options);
      let problems = [];
      if (!result.errors) {
        problems = verifySolution(job.input, result);
      }
      return { materialId: job.materialId, result, problems };
    });
    self.postMessage({ id, results });
  } catch (err) {
    let message = String(err);
    if (err && err.message) {
      message = err.message;
    }
    self.postMessage({ id, failure: message });
  }
};
