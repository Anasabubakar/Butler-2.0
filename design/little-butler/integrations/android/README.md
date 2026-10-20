# Android sprite view

Integration source, not a compiled Android application. Adjust `package your.app.butler`.

1. Copy `ButlerSpriteView.kt` into your existing Android app's Kotlin sources.
2. Copy `assets/motion.json` to `app/src/main/assets/butler/motion.json`.
3. Copy the 20 horizontal PNG strips from `assets/animations/*.png` to
   `app/src/main/assets/butler/animations/`. You do not need the individual frame
   subfolders, WebP previews or large atlas for this adapter.
4. Instantiate the view in your activity or your own overlay window.

```kotlin
val pet = ButlerSpriteView(this)
pet.onTap = { /* Open your compact controls */ }
pet.onHold = { /* Show quick actions */ }
pet.onDragBy = { dx, dy -> /* Move your host overlay by these pixels */ }
pet.onDragEnd = { /* Snap host window to safe left/right bottom inset */ }
pet.setState("listen")
pet.reduceMotion = true // Respect the user's system motion preference in your host.
```

The renderer draws only the mascot. Draw recording/status/progress indicators and
controls in your native UI. Permission prompts, overlay service, safe insets,
notifications, voice input and device synchronization belong in your host app.
Do not infer microphone or screen-capture status from the selected animation.

The source uses Android SDK classes only. It has not been Gradle-compiled or
device-tested in this environment. Default view dimensions should be 64 × 80 dp
or larger with at least a 48 dp interactive target. Pause or hide the view when the
screen is off; normal window visibility already pauses frame callbacks.
