# eventhorizen

Browser-in-a-browser with an animated black hole wallpaper. Engine: Scramjet (Mercury Workshop) + libcurl transport + a Wisp relay, all in this one Node app.

## Deploy on Render (no terminal, no card)
1. Put every file in this folder into a new GitHub repo (keep the `public` and `src` folders).
2. render.com -> sign in with GitHub -> New -> Blueprint -> pick the repo.
3. When asked for PASSWORD, type the password you want. Click Apply.
4. Open the URL Render gives you (https://eventhorizen-xxxx.onrender.com) and sign in.

The free plan sleeps after 15 min idle; the first visit after that takes about a minute.

## Run locally
    npm install
    PASSWORD=yourpassword npm start      # then open http://localhost:8080

## Licence
AGPL-3.0 (inherited from the libcurl transport). If you let other people use your copy, they are entitled to its source.
