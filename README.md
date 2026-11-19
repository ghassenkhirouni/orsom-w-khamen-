# Orsem w Khammen (ارسم وخمّن)

A Tunisian draw-and-guess party game. One player draws a Tunisian word, the others guess it in
Arabizi, Arabic or French. No accounts: anyone with the link can play.

## Run it on your computer

```bash
npm install
npm start
```

Open http://localhost:3000, type a name, press **Bit jdida**, then **Odkhel**.
Friends on the same Wi-Fi can join at `http://<your-computer-ip>:3000`.

## Put it online (Render, free)

1. Push this folder to a new GitHub repository.
2. On https://render.com, sign in with GitHub and choose **New → Blueprint**.
3. Pick the repository. Render reads `render.yaml` and creates the web service.
4. When the deploy finishes, open the `https://….onrender.com` link and share it.

The free plan sleeps after 15 minutes without visitors; the first visit after that takes about
a minute to wake up.

Railway, Fly.io or any host that runs Node 18+ also works: the start command is `npm start`
and the port comes from the `PORT` environment variable.

## Files

- `server.js`: serves the page and relays each player's state between people in the same room (WebSocket at `/ws`).
- `public/game.html`: the game itself.
- `public/room-shim.js`: connects the game to the server.

Rooms live only in memory: restarting the server ends running games. Limits: 16 players per
room, 4 KB of state per player.
