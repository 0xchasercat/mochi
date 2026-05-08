# 0241: Cloudflare Pages deploy + mochijs.com DNS

**Package:** repo-level CI / infra
**Phase:** `0.13` (post-0240)
**Estimated size:** S
**Dependencies:** 0240 (Astro site at `docs/site/`)

## Goal

Deploy the `docs/site/` Astro build to Cloudflare Pages, wire DNS for the user-owned `mochijs.com` apex + `www.mochijs.com` subdomain. Single deploy URL serves both landing (`/`) and docs (`/docs/*`).

After this lands: every push to `main` deploys to mochijs.com automatically. PRs deploy to ephemeral preview URLs.

## Success criteria

### Cloudflare Pages

- [ ] Cloudflare Pages project `mochi-js-site` connected to the GitHub repo. (User does this manually via CF dashboard — agent provides the exact configuration.)
- [ ] Production branch: `main`. Preview branches: any non-main branch.
- [ ] **Build configuration** (committed in repo as documentation, executed by CF):
  - Framework preset: Astro
  - Root directory: `/` (repo root)
  - Build command: `cd docs/site && bun install --frozen-lockfile && bun run build`
  - Build output: `docs/site/dist`
  - Node version: not used (Bun-only). Use Cloudflare's Bun build runtime if available; otherwise wrangler-deploy via GH Actions (option B below).
- [ ] Environment variables: none required at v1. Document the override path for future analytics keys.

### Option B (fallback / preferred per Bun-only invariant): Wrangler GH Actions deploy

CF Pages's built-in build runner doesn't natively support Bun. Two paths:

1. **CF Pages with Node runtime + Bun shim** — build runs `npm install -g bun && cd docs/site && bun install && bun run build`. Hacky but works.
2. **GH Actions builds with Bun, uploads artifact via `cloudflare/wrangler-action@v3`** — the build runs in our environment (bun-native), CF only serves. Cleaner.

Implement option 2 unless CF Pages adds first-class Bun support before this task ships.

- [ ] `.github/workflows/deploy-docs.yml`:
  - Triggers: push to `main` (production deploy), pull_request (preview deploy)
  - Steps: checkout → setup-bun → `cd docs/site && bun install --frozen-lockfile && bun run build` → `cloudflare/wrangler-action@v3` deploy with `command: pages deploy docs/site/dist --project-name=mochi-js-site --branch=${{ github.head_ref || github.ref_name }}`
  - Secrets required: `CLOUDFLARE_API_TOKEN` (Pages:Edit scope), `CLOUDFLARE_ACCOUNT_ID`. Document the exact CF token permissions needed.
- [ ] PR previews comment back the preview URL on the PR (`cloudflare/pages-action`'s built-in PR-comment feature, or a `peter-evans/create-or-update-comment@v4` step).

### DNS — mochijs.com

User owns the domain (registrar TBD). Agent provides the exact DNS records the user adds:

- [ ] CNAME `mochijs.com` → `mochi-js-site.pages.dev` (CF Pages will accept apex via CNAME flattening if domain is on CF DNS; otherwise use `A` records to CF Pages IPs).
- [ ] CNAME `www.mochijs.com` → `mochi-js-site.pages.dev`.
- [ ] Add custom domains in CF Pages dashboard: `mochijs.com` + `www.mochijs.com`. CF auto-issues TLS certs.
- [ ] HTTP → HTTPS redirect: enabled (CF default).
- [ ] `www` → apex redirect: enabled (CF Page Rule / Bulk Redirect).
- [ ] Document all of the above in `docs/README.md` "Deployment" section so future maintainers can recreate.

### Verification

- [ ] After deploy: `curl -I https://mochijs.com/` returns 200, valid TLS cert (let's encrypt via CF).
- [ ] `https://mochijs.com/docs/getting-started/01-install` returns 200.
- [ ] `https://mochijs.com/foo-not-a-real-page` returns 404 with the styled 404 page from 0240.
- [ ] PR-preview deploys land within 2 minutes of push.

### Other

- [ ] Add badge to README: build status of the deploy workflow.
- [ ] Document the deploy in `docs/README.md`: how to deploy locally (wrangler CLI), how to override the preview branch, how to roll back.
- [ ] Changeset: NONE (infra-only, no published package).

## Out of scope

- Analytics (Plausible, etc.) — separate task.
- A/B testing — separate task.
- Comment system on docs — separate task.
- Custom redirects beyond apex/www — separate task.

## Implementation notes

- Read `docs/site/package.json` (lands in 0240) for the actual build command. If it differs from this brief, adapt.
- Cloudflare API token scope: `Account / Cloudflare Pages:Edit` + `Account / Account Settings:Read`. Nothing else needed.
- The CF Pages free tier covers our expected traffic comfortably; no paid plan required at v1.
- Wrangler v3 is the current major. Pin via the `wrangler-action` version, don't pin `wrangler` itself in the project `package.json` (unnecessary dev dep).
- Set `Cache-Control: max-age=31536000, immutable` on hashed assets, `max-age=300, must-revalidate` on HTML — CF Pages defaults are sensible but explicitly document if we override.

## Submission

```sh
bun work create 0241 docs
cd worktrees/0241
# write .github/workflows/deploy-docs.yml + docs/README.md "Deployment" section
git add .github/workflows/deploy-docs.yml docs/README.md README.md  # README badge
git commit -m "ci(docs): Cloudflare Pages deploy via wrangler + mochijs.com DNS notes"
bun work submit 0241 --draft
```

User must do BEFORE the workflow goes green:

1. Create CF Pages project `mochi-js-site` (CF dashboard → Pages → Create → Connect to Git).
2. Add CF API token + account ID as repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
3. Add `mochijs.com` + `www.mochijs.com` as custom domains in CF Pages.
4. Add DNS records per above (CNAME or A/AAAA depending on whether domain is on CF DNS).
