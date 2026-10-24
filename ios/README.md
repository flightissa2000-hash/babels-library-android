# Babel's Library for iPhone & iPad

**Open it:** https://flightissa2000-hash.github.io/babels-library-web/

This is the phone companion of [Babel's Library](https://github.com/flightissa2000-hash/babels-library), the same app as the
[Android version](https://github.com/flightissa2000-hash/babels-library-android), as a web app for iPhone and iPad.

## Setting it up

1. On the computer, Babel's Library → **Settings → Phone**: switch on **Reach this library from anywhere**.
2. On the iPhone, open the address above in **Safari**, tap **Share → Add to Home Screen**, and open it from the Home Screen.
   (The Home Screen app keeps its own storage, so pair it there, not in Safari.)
3. On the computer, **Pair a phone…** and type the 6-digit code in the app. It finds your computer by itself.

## What's different from Android

Everything else works the same: the library, Home, the Bulletin, profiles, the journal, the catalogue, the news,
dictation, the readers and players, files kept for offline, 30-day saves, and sending files to the computer.

These are the differences:

- Websites open in Safari, with Safari's own passwords and content blockers. A web app can't hold other sites inside it.
- Videos don't keep playing with the screen locked.
- News notifications need the app on the Home Screen (iOS 16.4 or later). Tap a notification to share the event or open it.
- Files go to the computer with **Send to computer** (a file picker) instead of the Share sheet.
- It reaches the computer through its away-from-home address, at home too, so the computer needs **Reach this library from anywhere** on.

Your library, files and pairing never pass through GitHub. This site only holds the app's code, and the app talks to
your own computer directly, using the token it gets when you pair.

## Building

This folder is built from the Android project (`web/` plus `ios/`) with `python ios/build_web.py`.
