# Extensions Workspace Notes

- After making changes in `extensions/`, run type checking before finishing:
  - `npm run type-check`
- Keep the extensions TypeScript-clean under strict settings.
- After a Pi upgrade, use `npm run sync-pi-deps` to align local tooling with the host and install with lifecycle scripts disabled. `package-lock.json` is the canonical lockfile; use `npm install --ignore-scripts` for installs.
- Run the existing and focused regression tests with `node --test tests/*.test.ts`.
