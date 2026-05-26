import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expectedTag = `v${packageJson.version}`;
const isExpectedGithubTag = process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME === expectedTag;

let tags;
try {
    tags = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    })
        .split(/\r?\n/)
        .map(tag => tag.trim())
        .filter(Boolean);
} catch (error) {
    console.error('Could not read git tags for the current commit.');
    console.error(error.stderr?.toString().trim() || error.message);
    process.exit(1);
}

if (!tags.includes(expectedTag) && !isExpectedGithubTag) {
    console.error(`Release tag ${expectedTag} is missing on the current commit.`);
    console.error(
        'Create releases with `npm run release -- <bump>` so @alcalzone/release-script creates and pushes the tag.',
    );
    process.exit(1);
}
