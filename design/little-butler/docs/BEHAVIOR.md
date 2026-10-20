# Behavior specification · v0.1

## Identity

Charcoal shadow creature, wispy asymmetric head, pale half-lidded eyes, white collar,
narrow black tie. Composed and helpful. Mischief is a glance, a tiny shrug, or a
slightly delayed bow. No loud bouncing, unsolicited jokes, deliberate task mistakes,
or wandering across the screen. Default voice is off; text remains available.

## Size and placement

Web component: 88 × 110 CSS pixels on desktop, 64 × 80 on narrow viewports.
Idle peek clips most of the body beyond the bottom edge of the drawing area.
The full rectangle remains interactive, so the tiny visible eyes are easier to touch.
Dock inset: 12 pixels. Drag threshold: 7 pixels. Hold threshold: 500 ms.
On drag release the mascot snaps to the nearest bottom corner.
After 12 seconds of inactivity with controls closed, a visible idle mascot tucks away.
Size preferences offer Small (64 × 80) or Medium (96 × 120).
Native hosts must add system navigation, keyboard, taskbar and cutout insets.

## Controls

| Input | Result |
| --- | --- |
| Tap / click pet | Open or hide compact controls |
| Enter / Space on focused pet | Same as tap |
| Hold / right-click | Quick actions |
| Drag | Dangling pose follows pointer, release docks to nearest side |
| Drag down >80 px with <45 px sideways movement | Hide and dock |
| Escape | Cancel pending approval, tuck away |
| Talk | Emit request for host voice input |
| Type | Focus command field |
| Voice | Toggle spoken replies, independent of microphone |
| Stop | Stop speech, cancel approval, emit host cancellation event |
| Devices | Choose an online device; offline rows disabled |

## States

| State | Duration | End behavior |
| --- | --- | --- |
| idle | 3200 ms | Breathing loop, occasional separate blink |
| blink | 180 ms | Return idle |
| peek | 1600 ms | Clipped eyes-and-fingers loop |
| summon | 520 ms | Rise from edge; idle |
| listen | 2000 ms | Small head tilt, wait for host state change |
| think | 2200 ms | Chin in hand, wait |
| work | 1500 ms | Collar adjustment pose, wait |
| success | 850 ms | Bow; idle |
| error | 650 ms | Shrug; idle |
| sleep | 4000 ms | Closed-eye breathing loop |
| drag | 1100 ms | Dangling sway |
| pleased | 1000 ms | Restrained pleased bounce; idle |
| speak | 700 ms | Alternate speaking and neutral mouth poses |
| attention | 2200 ms | Hold card; wait |
| hide | 400 ms | Sink beneath edge; peek |
| surprised | 700 ms | Small recoil; idle |
| record | 1500 ms | Working pose; runtime recording dot |
| transfer | 1800 ms | Hold card, slight tilt; wait |
| offline | 3500 ms | Restrained shrug/breathing |
| quiet | 4000 ms | Tucked-away sleeping pose |

The runtime overlays the recording dot and host-supplied progress. Exported sprite
frames contain character art only so host renderers can draw accessible indicators
separately. The desktop/mobile UI also uses text labels for listening/recording.

## Motion rules

Breathing scale change <1.2%. Typical tilt <2°. Drag sway up to 7°.
Summon uses cubic easing and a small vertical overshoot. Bow uses a distinct key pose.
Reduced motion removes translation loops, rotation and scaling; hidden poses remain
hidden. It uses instantaneous pose changes. No strobe or flashing UI.

The sheet's 12 frames per state support universal engines. The web component samples
the curves continuously via requestAnimationFrame; pose changes are discrete key
poses, while position, scale and rotation are smooth. Rendering pauses when the
document is hidden. Native hosts should pause similarly when the display is off.

## Task behavior

Host sends listen → think → work → success or error. During actual work, progress
must come from real host measurements; never manufacture a percentage. Offline
devices are disabled. No silent rerouting. Stop must cancel the backend operation
as well as the visible animation; the event provides the hook.

Approvals show action, recipient, device and attachment name. Approval waits without
auto-acceptance. Hiding, Stop, Escape or replacing an approval resolves it false.
Native authentication is a separate host step, using the OS's verification interface.

## Future native-host behavior

These are requirements for the eventual installed app, not implemented here:
avoid keyboard/secure surfaces; reposition above navigation bars; suppress playful
motion during presentations; maintain a visible screen-recording indicator; respect
per-device microphone/context toggles; prevent overlapping speech across devices;
use system insets and OS overlay policies. The same identity should appear everywhere,
with one shared task history and explicit destination device.
