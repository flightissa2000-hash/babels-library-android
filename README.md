# Babel's Library for Android

The phone companion to Babel's Library, the desktop library app (a separate repository). It pairs with your computer
over Wi-Fi (or from anywhere, through the computer's private tunnel) and keeps your library, reading positions,
notes and journal in sync.

## What it does
- **Library and home:** everything on your computer's shelves, with covers and the same sorts as the computer, as a
  fan deck of paper cards on a binder: swipe to flip cards away around their pin, tap the front card to open it.
  Download books, comics, articles and videos to the phone to read or watch offline.
- **Dictation in notes:** hold ✎ Quick to say a quick note (it's saved when you let go); 🎙 on a quick note keeps
  dictating into it, and 🎙 by the journal's text boxes types what you say (hold to talk, or tap to start and stop).
  Uses Android's own speech recognition.
- **Readers:** PDF, EPUB, comics/manga (CBZ) and video. Pages are prepared ahead, so turning them is instant;
  ⇅ switches between page-by-page and continuous scrolling. Video has 5/15/30-second skip buttons and double-tap
  to skip.
- **Details:** the full details from the computer (tags, citations, series, synopsis…), editable, plus the
  computer's actions (re-sort, pull cover, Hardcover, find poster, remove).
- **Catalogue and News:** the computer's catalogue (books, manga, comics, films, TV, animation) and its news desk.
- **Journal:** your reading log and review journal, synced both ways; quick notes stay on the phone.
- **Browser:** ads, trackers and pop-ups blocked with the computer's block lists (and YouTube's own ads removed);
  ⧉ splits it into two pages, one above the other; reopen the last page with ↺; history behind a button.
  Videos keep playing with the screen off (a quiet "playing" notification with Stop).
  Passwords are left to Android's own password manager.
- **Send to computer:** share or pick files and they're uploaded into the library (resumable, in the background).

## Building
No Gradle: `build_apk.ps1` runs aapt2 → javac → d8 → zipalign → apksigner directly.

```powershell
powershell -File build_apk.ps1
```

It needs:
- Python 3 (`BABEL_PYTHON` to point at it), with Pillow for the launcher icons (`make_icons.py`).
- Android build tools 34 and an OpenJDK. Unity's `AndroidPlayer` folder has both; point `BABEL_ANDROID_TOOLS` at
  any folder laid out the same way (`SDK\build-tools\34.0.0`, `SDK\platforms\android-34`, `OpenJDK`).
- The desktop app next to it (`BABEL_DESKTOP` = its `app\static` folder): the themes, fonts, reader libraries and
  the YouTube ad remover are shared with it.

The first build creates a personal signing key (`babel-personal.keystore` and `keystore-password.txt`). Keep them
safe and private: updates must be signed with the same key, and they're excluded from the repository.

## Testing
`emu.ps1` drives an Android emulator (its own AVD): `create`, `start`, `install`, `launch`, `shot <name>`,
`tap`, `swipe`, `forward` (for Chrome DevTools), `stop`. `cdp.py` runs JavaScript in the app's page over DevTools
(debug builds only: set `DEBUG = true` in `BuildConfigDebug.java`).

## Layout
- `android/` the Java side: `MainActivity` (WebView host, files, downloads), `BrowserActivity`, `UploadService`,
  `Net` (finds the computer: same Wi-Fi, last address, or the tunnel).
- `web/` the app itself (HTML/CSS/JS), shown in the WebView.
- `tools/pack_apk.py` adds the compiled code to the APK.
