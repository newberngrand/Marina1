# New Bern Grand Marina — Website

This is the source for the New Bern Grand Marina website, published free with GitHub Pages.

## Making changes

You don't need to know how to code. The easiest way to make a change is to open a chat with Claude (claude.ai or the Claude app) and say something like:

> "Open my GitHub repo newberngrand/Marina1 and change the marina's phone number on every page to (252) 555-0100."

Give Claude access to this repository (or a Personal Access Token scoped to it) and it can read the files, make the edit, and push the change directly. A few minutes after pushing, the change is live on the site automatically — nothing to "publish" separately.

If you'd rather edit by hand: every page is a plain `.html` file (`index.html`, `rates.html`, `marina-map.html`, `contact.html`) plus one shared style sheet (`style.css`). You can click any file on GitHub's website, click the pencil (edit) icon, make your change, and commit it directly from the browser — no software to install.

## Structure

- `index.html` — homepage
- `rates.html` — slip rates, electric rates, and amenities
- `marina-map.html` — the marina layout map
- `contact.html` — contact info and embedded maps
- `style.css` — colors, fonts, and layout shared by every page
- `images/` — put your own photos here (see images/README.md)

## Publishing (GitHub Pages)

This site is served directly from this repository via GitHub Pages. If Pages isn't already turned on: go to **Settings → Pages** in this repo, set **Source** to **Deploy from a branch**, branch **master**, folder **/ (root)**, then save. The site will be live at:

`https://newberngrand.github.io/Marina1/`

To use a real domain (like newberngrandmarina.com) instead, add a `CNAME` file with just the domain name in it, and point the domain's DNS at GitHub Pages — ask Claude to walk you through it when you're ready.
