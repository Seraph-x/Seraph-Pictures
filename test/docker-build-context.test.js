const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Docker API build context', function () {
  it('includes the server runtime and shared contracts in every build entrypoint', function () {
    const compose = read('docker-compose.yml');
    const dockerfile = read('server/Dockerfile');
    const dockerignore = read('.dockerignore');
    const workflow = read('.github/workflows/docker-image.yml');

    assert.match(compose, /api:\s+[\s\S]*?build:\s+[\s\S]*?context: \.\s+[\s\S]*?dockerfile: server\/Dockerfile/);
    assert.match(workflow, /image_name: k-vault-api\s+context: \.\s+file: \.\/server\/Dockerfile/);
    assert.match(dockerfile, /COPY server\/package\.json server\/package-lock\.json\* \.\//);
    assert.match(dockerfile, /COPY server\/ \.\//);
    assert.match(dockerfile, /COPY shared\/ \/shared\//);
    for (const pattern of ['.env', '.env.*', '.dev.vars*', 'cookies.txt', 'test-login.json']) {
      assert.ok(dockerignore.split(/\r?\n/).includes(pattern), `.dockerignore must exclude ${pattern}`);
    }
  });
});
