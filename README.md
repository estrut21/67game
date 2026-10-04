# 67 — The Extremely Unnecessary Hand Game

**Hackathon Track 6: Dumbest Idea**

An entirely unnecessary sport in which you wave your hands at a webcam to earn deeply unimportant points. The rules are simple: start with your hand(s) low, lift them, lower them, and try to get as many reps as possible before the timer runs out. At six and seven reps, a tiny unicorn appears to celebrate your questionable athletic achievement.

**Play it:** [67game-pi.vercel.app](https://67game-pi.vercel.app/)

## What it does

- Tracks up to two hands in the browser using MediaPipe.
- Counts completed up-and-down hand movements during 15-, 30-, or 60-second rounds.
- Celebrates scores six and seven with a floating hand-drawn unicorn.
- Saves a top-five leaderboard and personal best in the current browser on the current device. It is not a shared online leaderboard.
- Keeps camera frames on-device; they are not uploaded or recorded.

## Run locally

1. Install [Node.js](https://nodejs.org/).
2. Run `npm install`.
3. Run `npm run dev` and open the local URL Vite prints.
4. Allow camera access, enter a name, and press **Start game**.

The first run needs an internet connection to load MediaPipe's runtime and hand-tracking model.
