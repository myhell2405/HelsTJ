'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const dataFile = path.join(projectRoot, 'data', 'jobs.json');
  let jobs;
  try {
    jobs = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read existing tracker data at ${dataFile}: ${error.message}`);
  }
  if (!Array.isArray(jobs)) throw new Error('Existing tracker data must be a JSON array.');

  const escapedJobs = JSON.stringify(jobs).replaceAll("'", "''");
  const sql = `INSERT INTO shared_jobs (id, jobs_json) VALUES (1, '${escapedJobs}') `
    + 'ON CONFLICT(id) DO NOTHING;\n';
  const sqlFile = path.join(os.tmpdir(), `helmy-job-tracker-import-${process.pid}.sql`);
  await fs.writeFile(sqlFile, sql, { encoding: 'utf8', flag: 'wx' });

  try {
    const wranglerCli = path.resolve(
      path.dirname(require.resolve('wrangler')),
      '..',
      'bin',
      'wrangler.js',
    );
    const result = spawnSync(process.execPath, [
      wranglerCli,
      'd1',
      'execute',
      'helmy-job-tracker',
      '--remote',
      '--file',
      sqlFile,
    ], { cwd: projectRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Wrangler D1 import exited with status ${result.status}.`);
    console.log(`Imported ${jobs.length} tracker rows if the shared D1 database was empty.`);
  } finally {
    await fs.rm(sqlFile, { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
