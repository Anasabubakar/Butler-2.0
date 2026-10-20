# Integration contract

All DOM events bubble and cross shadow DOM boundaries. Their names begin `butler:`.

| Event | detail | Host responsibility |
| --- | --- | --- |
| ready | `{}` | Assets loaded |
| asseterror | `{message}` | Report broken asset path |
| command | `{text, deviceId}` | Route text to your agent |
| action | `{action, deviceId}` | Implement save/screenshot/record/remind/clipboard/more |
| stop | `{}` | Cancel actual tool/recording/network execution |
| talkrequest | `{microphoneEnabled}` | Request permission and start voice input |
| preference | `{name, value}` | Persist voice/microphone/quiet preferences |
| contextrequest | `{enabled}` | Obtain/revoke screen permission then call setScreenContext |
| contextchange | `{enabled}` | Screen-context status updated |
| statechange | `{state}` | Optional telemetry/local UI |
| devicechange | `{deviceId}` | Update chosen task target |
| dock | `{side}` | Save placement |

`ready` is also an awaitable promise on the element after connection.
Errors reject that promise and emit `asseterror`.

## Voice and context

The microphone setting is a preference, not permission acquisition. Set it only
after your host's permission flow succeeds, or reset it when permission is denied.
Screen-context toggle emits a request; it does not claim that capture started.
Call `setScreenContext(true)` only after capture is live. No wake-name listener
is included. Your host can call `pet.open()` after recognizing the wake name.

## Devices

Call `setDevices([{id, name, online}])` on real connection-state changes. Online
status here is presentation state supplied by the host, not a network heartbeat.
The default target is the first online item. Every command/action includes the
selected id; the host must revalidate that target before execution. Update the
list if it disconnects. Do not run on a different device silently.

## Native desktop

Use the component in an existing Electron/Tauri app, or render the PNG atlas in
your own native window. A native shell must implement transparency, always-on-top,
non-focus-stealing windows, click-through outside the pet/control bounds, startup,
taskbar handling and permission/auth flows. No Electron/Tauri dependency is required
for the kit, and no native desktop application binary is included.

The element itself is transparent outside the mascot rectangle, but its rectangle
still receives input. An OS overlay must update its native input region rather than
making an entire fullscreen window intercept clicks. Wayland may require compositor
specific integration; this kit does not bypass compositor policy.

## Android

The Kotlin sample is a normal View that draws PNG animation strips. It is suitable
for your existing activity or overlay service. Your application must implement the
overlay service, permissions, foreground-service lifecycle, notifications, safe
insets and native controls. No background microphone/capture services are included.

## Data boundary

This package processes local UI text and animation only. It makes no network
requests other than loading local asset URLs. Browser speech synthesis may use
device/vendor voices; choose a local voice in your host if offline-only speech is
required. No email, WhatsApp, calendar, clipboard, terminal or cloud integration
is executed by the sample buttons. Demo devices and recipient are fictional.
