# Anand Kumar Keshavan — Personal site

This folder contains the source for [anand-keshavan-pune.in](https://anand-keshavan-pune.in). The site is built with [Eleventy](https://www.11ty.dev/) and reads content from the repo’s `01-About Me/` and `02-Tutorials/` folders.

## Edit content and rebuild

- **Landing intro:** Edit the intro paragraph in `index.njk` (hero section).
- **Tutorial text:** Edit the `.md` files in `02-Tutorials/` (e.g. `chapter-01.md`, `01-Introduction.md`). No need to touch anything in `webpage/` — the next build will pick up changes.
- **Tutorial list / TOC:** To add a tutorial or change chapter titles, edit `_data/tutorials.js`.

Then rebuild:

```bash
cd webpage
npm install   # only first time (or after adding deps)
npm run build
```

Output is in `webpage/build/`. Deploy the contents of `build/` to your host.

## Local preview

```bash
cd webpage
npm run dev
```

Then open http://localhost:8080 (or the port shown).

## Hosting for anand-keshavan-pune.in

### Option 1: GitHub Pages

1. Push this repo to GitHub (e.g. `yourusername/ak-webpage`).
2. In the repo: **Settings → Pages**. Source: **GitHub Actions** (or “Deploy from a branch”).
3. **If using “Deploy from a branch”:**  
   - Run locally: `cd webpage && npm run build`.  
   - Push the contents of `webpage/build/` to a branch named `gh-pages` (or use the `docs/` folder on `main` and set Pages to “main / docs”).  
   - In Pages settings, set custom domain to `anand-keshavan-pune.in` and enable “Enforce HTTPS”.
4. **If using GitHub Actions:** Add a workflow that runs `npm ci` and `npm run build` in `webpage/`, then uploads `webpage/build` to GitHub Pages (e.g. with `peaceiris/actions-gh-pages`). Set custom domain in repo Settings → Pages as above.
5. **DNS (at your domain registrar):**  
   - Add a **CNAME** record: `anand-keshavan-pune.in` → `yourusername.github.io`, **or**  
   - Follow the exact A/CNAME records shown in GitHub Pages settings.  
   After DNS propagates, the site will be available at https://anand-keshavan-pune.in.

### Option 2: Netlify

1. Sign up at [netlify.com](https://www.netlify.com/) and connect this repo.
2. Build settings:  
   - **Base directory:** (leave empty or `webpage`)  
   - **Build command:** `cd webpage && npm install && npm run build` (or set “Base directory” to `webpage` and use `npm run build`)  
   - **Publish directory:** `webpage/build`
3. Add custom domain: **Domain settings → Add custom domain** → `anand-keshavan-pune.in`. Netlify will show the required DNS records (CNAME or A).
4. At your registrar, add the CNAME (or A) record as shown. After DNS propagates, enable HTTPS in Netlify.

### Option 3: Vercel or Cloudflare Pages

Same idea: connect the repo, set build command to run from `webpage` and output `webpage/build`, then add `anand-keshavan-pune.in` as a custom domain and set the DNS records they provide.

## Can I publish the .md files directly as webpages?

The site doesn’t serve raw `.md` files. The build step converts them to HTML. That way you keep editing the same Markdown in `02-Tutorials/` and get a fast, static site with one `npm run build` and deploy of `webpage/build/`.
