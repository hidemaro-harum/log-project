# log-project

佐渡市向けのGoogle Apps Script業務自動化プロジェクトです。

## Structure

```text
.
├── image-collector/   # GAS source, clasp config, and tests
├── index.html         # Vercel static operations portal
├── package.json       # Repository-level helper scripts
├── vercel.json        # Static Vercel deployment config
└── .github/workflows/ # GitHub Actions for GAS deployment
```

## Deployments

- GAS: pushing changes under `image-collector/` to `main` runs tests and deploys with `clasp push --force`.
- Vercel: the root static portal is deployed from this repository.

## Local Checks

```bash
npm run test:gas
npm run check:gas
```
