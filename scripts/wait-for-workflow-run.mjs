#!/usr/bin/env node

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
    args.set(process.argv[i], process.argv[i + 1]);
}

const workflow = args.get('--workflow');
const ref = args.get('--ref');
const sha = args.get('--sha');
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (!workflow || !ref || !sha) {
    throw new Error('Usage: wait-for-workflow-run.mjs --workflow <file> --ref <ref> --sha <sha>');
}

if (!token || !repository) {
    throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
}

const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
};
const startedAt = new Date(Date.now() - 60_000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function github(path) {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}\n${body}`);
    }

    return response.json();
}

async function findRun() {
    const data = await github(`/actions/workflows/${encodeURIComponent(workflow)}/runs?event=push&per_page=100`);
    const matchingRuns = (data.workflow_runs ?? []).filter(run => run.head_sha === sha);
    const exactRuns = matchingRuns.filter(run => run.head_branch === ref);
    const recentRuns = matchingRuns.filter(run => new Date(run.created_at) >= startedAt);

    return (
        recentRuns.find(run => run.head_branch === ref) ??
        recentRuns[0] ??
        exactRuns.find(run => run.conclusion === 'success') ??
        exactRuns[0] ??
        matchingRuns.find(run => run.conclusion === 'success') ??
        matchingRuns[0]
    );
}

let run;
for (let attempt = 1; attempt <= 60; attempt++) {
    run = await findRun();

    if (run) {
        break;
    }

    console.log(`Waiting for ${workflow} run on ${ref} (${sha}), attempt ${attempt}/60...`);
    await sleep(10_000);
}

if (!run) {
    throw new Error(`No ${workflow} run found for ${ref} at ${sha}.`);
}

console.log(`Found ${workflow} run ${run.id}: ${run.html_url}`);

while (run.status !== 'completed') {
    console.log(`Run ${run.id} status is ${run.status}; waiting...`);
    await sleep(15_000);
    run = await github(`/actions/runs/${run.id}`);
}

if (run.conclusion !== 'success') {
    throw new Error(`${workflow} run ${run.id} finished with conclusion ${run.conclusion}: ${run.html_url}`);
}

console.log(`${workflow} run ${run.id} completed successfully.`);
