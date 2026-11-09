# eventhorizen (split version)
- `site/`  -> Firebase Hosting (the pages + the browser engine files)
- `relay/` -> Render (the small server the traffic goes through; holds your password)

Steps: 1) push this repo to GitHub  2) Render: New > Blueprint > pick repo, type your PASSWORD  3) put the Render address in site/config.js
4) in .github/workflows/firebase-hosting.yml replace YOUR_FIREBASE_PROJECT_ID  5) add the FIREBASE_SERVICE_ACCOUNT secret, push.
Licence: AGPL-3.0-only (inherited from the libcurl transport).
