# Releasing

This repository publishes two npm packages from one GitHub repository:

- `@yadimon/claude-code-to-llm`
- `@yadimon/claude-code-to-llm-server`

The packages are versioned independently and are released through package-specific tags.

Do not set `"private": true` in either publishable package. The root workspace stays private.

## Package tags

- core package: `claude-code-to-llm-v<version>`
- server package: `claude-code-to-llm-server-v<version>`

Examples:

- `claude-code-to-llm-v0.1.1`
- `claude-code-to-llm-server-v0.1.1`

## First Publish

This section only matters for a new package name or a fresh registry bootstrap.

For the current published packages, the one-time manual bootstrap publish is already complete.

Before the first publish:

```bash
npm login
npm run check
```

Then publish each package once manually:

```bash
npm publish --workspace @yadimon/claude-code-to-llm --access public
npm publish --workspace @yadimon/claude-code-to-llm-server --access public
```

## Trusted Publishing

After both packages exist on npm, add a Trusted Publisher for each package in npm:

- GitHub user or org: `yadimon`
- repository: `claude-code-to-llm`
- workflow filename: `publish.yml`
- environment: none

The publish workflow uses GitHub Actions OIDC with the npm version bundled with the selected Node runtime.

## Normal Release Flow

Choose the package and version bump type:

```bash
npm run release:core:patch
npm run release:core:minor
npm run release:core:major

npm run release:server:patch
npm run release:server:minor
npm run release:server:major
```

These scripts:

- run `npm run check`
- bump only the selected workspace version
- update the server's `@yadimon/claude-code-to-llm` dependency automatically when releasing core
- create a release commit
- create a package-specific Git tag
- push the commit and tag to `origin`

GitHub Actions publishes only the package that matches the pushed tag.

## Manual Equivalent

Core package:

```bash
npm run check
npm version patch --workspace @yadimon/claude-code-to-llm --no-git-tag-version
node -e "const fs=require('node:fs'); const p='packages/claude-code-to-llm-server/package.json'; const pkg=JSON.parse(fs.readFileSync(p,'utf8')); pkg.dependencies['@yadimon/claude-code-to-llm']='^<version>'; fs.writeFileSync(p, JSON.stringify(pkg, null, 2)+'\n');"
git add package-lock.json packages/claude-code-to-llm/package.json packages/claude-code-to-llm-server/package.json
git commit -m "release(claude-code-to-llm): <version>"
git tag -a claude-code-to-llm-v<version> -m "Release claude-code-to-llm-v<version>"
git push origin HEAD claude-code-to-llm-v<version>
```

Server package:

```bash
npm run check
npm version patch --workspace @yadimon/claude-code-to-llm-server --no-git-tag-version
git add package-lock.json packages/claude-code-to-llm-server/package.json
git commit -m "release(claude-code-to-llm-server): <version>"
git tag -a claude-code-to-llm-server-v<version> -m "Release claude-code-to-llm-server-v<version>"
git push origin HEAD claude-code-to-llm-server-v<version>
```

## Notes

- `repository`, `homepage`, and `bugs` in both package manifests must match the canonical GitHub repository.
- `@yadimon/claude-code-to-llm-server` depends on `@yadimon/claude-code-to-llm`; core releases update that dependency range automatically.
- The publish workflow verifies that the pushed tag matches the target package version exactly.
