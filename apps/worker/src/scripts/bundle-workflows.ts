// Build step: packages the workflow code once, at image-build time (Temporal's production setup),
// instead of the worker bundling it on every startup.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode } from '@temporalio/worker';

const workflowsPath = fileURLToPath(new URL('../workflows/index.js', import.meta.url));
const bundlePath = new URL('../workflow-bundle.js', import.meta.url);

const { code } = await bundleWorkflowCode({ workflowsPath });
await writeFile(bundlePath, code);
console.log(`workflow bundle written to ${fileURLToPath(bundlePath)}`);
