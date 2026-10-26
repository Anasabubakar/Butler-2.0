# Android app

## Install

Every push builds a debug APK. Download `butler-debug-apk` from the latest run on the repo's **Actions** tab, install it, open **Butler**, and enter:

- Save URL: `https://butler.yourdomain.com/api/save`
- Token: your `BUTLER_TOKEN`

So each new build installs over the old app (keeping its settings and switches), give CI one fixed signing key, once, from your laptop:

```sh
sudo apt install openjdk-17-jre-headless   # if keytool is missing
mkdir -p ~/.android
keytool -genkeypair -keystore ~/.android/butler.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Butler"
base64 -w0 ~/.android/butler.keystore | gh secret set ANDROID_DEBUG_KEYSTORE -R Anasabubakar/Butler-2.0
```

Without it, every build has a different key and Android makes you uninstall first. After adding it, uninstall once more and install the next build; from then on updates install over the top.

Opening **Butler** shows your library as a native app that works with no internet. The phone keeps its own copy of everything you saved (titles, summaries, key points, tags, categories, and the last 40 pictures), so it opens, searches and filters offline. The home screen is a grid of tiles: **Save something** (type or paste a link or note, or pick pictures), how many things you've saved, saved this week, waiting to sync and pictures, then your categories, subjects and recent saves. Tap any save for its summary and key points, with **Open**, **Share**, **Copy** and **Delete**.

Saves and deletes made offline happen on the phone at once, marked **Waiting to sync**, and go to the server by themselves as soon as there's internet, even with the app closed. A save that's sent twice (the answer got lost on a bad connection) still makes one item. The phone catches up with what changed elsewhere when you open it, when the internet comes back, when you pull down on the screen, and about every 15 minutes in the background. It follows the phone's light or dark mode. The board, recipes and connections are still the website: the tile at the bottom opens it inside the app (needs internet). The ⚙ button opens setup, and the pet's menu has **Open library** too.

Then in TikTok, Instagram, YouTube, Chrome or Gallery: **Share → Save to Butler**, add a note if you like, tap **Save**. It shows in the library straight away and uploads when you're online.

## Little Butler on your phone

Tap **Start Little Butler** on the setup screen. It asks for two switches, one at a time:

1. **Display over other apps**, so the pet can peek from the corner.
2. **Butler** under **Accessibility**, so it can screenshot and tap for you. It only does that when you press one of its buttons. On Android 13 and newer, an app installed from an APK has this switch greyed out at first: open Butler's **App info**, tap **⋮**, choose **Allow restricted settings**, and try again.

Drag the pet anywhere on the screen; it stays where you drop it, and peeks again if you drop it on the bottom edge. Tap it for **Save this** (a screenshot plus the post's link, using Share → Copy link inside apps), **Copy this**, **Analyze this**, **Solve this** and **Translate this** (into English, or into another language if you ask). It also has **Send to laptop** (the page, the selected text, or a screenshot) and, at the top of the menu, a **Tell me what to do…** bar (tap it to type, or the mic to talk; holding the pet opens it too): type or say what you want, like "remind me at 3 to call Mum" or "send this to my laptop". Talk uses the phone's own speech recognizer. "WhatsApp David I'm running late" or "send this to David on Telegram" opens the app with the message (and the screenshot, if you said "this") ready for you to press Send; Butler looks David up in your phone's contacts, asking for access the first time. Ask it to do something on screen ("search YouTube for jollof rice") and the pet taps, swipes and types for you step by step. While it works, a bubble over its head shows what it's doing right now, with **Stop**; when it's done, the bubble shows the answer with **Copy** and **Share** (tap it to read all of it). The pet itself shows it too: a pop and three bouncing dots while it works, a hop and a green tick when it's done, a shake and a red ! when it fails. The menu and the command sheet are dark; the **×** in each closes it and leaves just the pet, and the command sheet sits at the top of the screen so the keyboard never covers the box. It stops by itself before paying, sending, posting, deleting or typing passwords. Reminders and things your laptop sends arrive as notifications; files land in Downloads/Butler. Screenshots need Android 11 or newer, and Share, Analyze, Solve and Ask Butler need `GEMINI_API_KEY` on the server.

