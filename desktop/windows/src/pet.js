// The pet's page: Little Butler's sprites, the menu, and the bubble over its head. Everything
// it does goes to the app through window.butler (preload.cjs); the app says what to show.
'use strict';

const $ = id => document.getElementById(id);
const api = window.butler;

// --- the sprites ----------------------------------------------------------------------------

let pets = null;
let clip = 'idle';
let frame = 0;
let clipTimer = 0;
let peeking = true;

async function loadPets() {
    pets = await api.pets();
    play('idle');
}

/** Plays a clip from pets/clips.json; one that doesn't loop goes on to its `next`. */
function play(name) {
    if (!pets?.clips[name])
        name = 'idle';
    clearInterval(clipTimer);
    clip = name;
    frame = 0;
    const {frames, duration, loop, next} = pets.clips[name];
    const step = Math.max(40, duration / frames);
    const show = () => {
        $('face').src = peeking && name === 'idle' ? `${pets.dir}/peek.png` : `${pets.dir}/${name}/${String(frame).padStart(2, '0')}.png`;
    };
    show();
    clipTimer = setInterval(() => {
        frame++;
        if (frame >= frames) {
            if (!loop) {
                clearInterval(clipTimer);
                play(next ?? 'idle');
                return;
            }
            frame = 0;
        }
        show();
    }, step);
}

function setPeeking(on) {
    peeking = on;
    $('pet').classList.toggle('peeking', on);
    if (clip === 'idle')
        play('idle');
}

// --- clicks pass through everywhere but the pet, menu and bubble ------------------------------

let over = false;
document.addEventListener('mousemove', e => {
    const now = Boolean(e.target.closest?.('.hit'));
    if (now !== over) {
        over = now;
        api.mouse(now);
    }
});
document.addEventListener('mouseleave', () => {
    if (over) {
        over = false;
        api.mouse(false);
    }
});

// --- dragging and tapping the pet -------------------------------------------------------------

let drag = null;
$('pet').addEventListener('pointerdown', e => {
    drag = {x: e.screenX, y: e.screenY, moved: false};
    $('pet').setPointerCapture(e.pointerId);
});
$('pet').addEventListener('pointermove', e => {
    if (!drag)
        return;
    const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5)
        return;
    drag.moved = true;
    $('pet').classList.add('dragging');
    setPeeking(false);
    api.drag(dx, dy);
    drag.x = e.screenX;
    drag.y = e.screenY;
});
$('pet').addEventListener('pointerup', () => {
    const moved = drag?.moved;
    drag = null;
    $('pet').classList.remove('dragging');
    if (moved) {
        api.dropped();
        return;
    }
    tapped();
});

function tapped() {
    if (ringing || recording) {
        if (recording)
            recorder.stop();
        api.stop();
        return;
    }
    const open = $('menu').hidden;
    setMenu(open);
}

function setMenu(open) {
    $('menu').hidden = !open;
    setPeeking(!open && $('bubble').hidden);
    if (open) {
        play('summon');
        hideBubble();
    } else {
        $('ask').value = '';
        $('ask').blur();
    }
}

for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
        setMenu(false);
        api.action(button.dataset.action);
    });
}

// The ask box: it takes the keyboard while you type. Enter asks Butler; Escape closes the menu.
$('ask').addEventListener('focus', () => api.typing(true));
$('ask').addEventListener('blur', () => api.typing(false));
$('ask').addEventListener('keydown', e => {
    if (e.key === 'Enter' && $('ask').value.trim()) {
        const text = $('ask').value.trim();
        setMenu(false);
        api.ask(text);
    } else if (e.key === 'Escape') {
        setMenu(false);
    }
});

// --- the bubble ---------------------------------------------------------------------------------

let said = '';         // all of what the bubble says, for Copy and replies
let working = false;
let hideAt = 0;
let reading = false;   // mouse over it, Show more open, or typing a reply: it stays

function showBubble() {
    $('bubble').hidden = false;
    $('menu').hidden = true;
    setPeeking(false);
}

function hideBubble() {
    $('bubble').hidden = true;
    $('reply').blur();
    working = false;
    hideAt = 0;
    if ($('menu').hidden)
        setPeeking(true);
}

/** Puts `text` in the bubble: 6 lines, then Show more if there's more. */
function setText(text, tappable = false) {
    said = text;
    const box = $('text');
    box.textContent = text;
    box.classList.remove('open');
    box.classList.toggle('tappable', tappable);
    $('more').textContent = 'Show more';
    // Measured once it's laid out: more than fits means Show more.
    requestAnimationFrame(() => {
        $('more').hidden = !(box.scrollHeight > box.clientHeight + 2);
    });
}

$('more').addEventListener('click', () => {
    const open = $('text').classList.toggle('open');
    $('more').textContent = open ? 'Show less' : 'Show more';
    if (!open)
        $('text').scrollTop = 0;
});

function setHeading(text) {
    $('heading').textContent = text ?? '';
    $('heading').hidden = !text;
}

function setButtons({stop = false, copy = false, close = false, confirm = null, reply = false}) {
    $('stop').hidden = !stop;
    $('copy').hidden = !copy;
    $('close').hidden = !close;
    $('confirm').hidden = !confirm;
    if (confirm)
        $('yes').textContent = confirm;
    $('reply').hidden = !reply;
    $('reply').value = '';
}

function setProgress(progress) {
    $('track').hidden = !progress;
    $('detail').hidden = !progress?.detail;
    if (progress) {
        $('fill').style.width = `${Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100)}%`;
        $('detail').textContent = progress.detail ?? '';
    }
}

/** Long answers stay up longer; it never goes while you're reading or typing. */
function lingerFor(text) {
    hideAt = Date.now() + Math.min(60_000, Math.max(6000, text.length * 60));
}

setInterval(() => {
    const open = $('text').classList.contains('open');
    if (hideAt && !working && !reading && !open && document.activeElement !== $('reply') && Date.now() > hideAt)
        hideBubble();
}, 500);
$('bubble').addEventListener('mouseenter', () => {
    reading = true;
});
$('bubble').addEventListener('mouseleave', () => {
    reading = false;
});

$('stop').addEventListener('click', () => api.stop());
$('copy').addEventListener('click', () => api.copy(said));
$('close').addEventListener('click', () => hideBubble());
$('yes').addEventListener('click', () => {
    setButtons({});
    api.answer(true);
});
$('no').addEventListener('click', () => {
    setButtons({});
    api.answer(false);
});
$('text').addEventListener('click', () => {
    if ($('text').classList.contains('tappable')) {
        api.tappedNote();
        hideBubble();
    }
});
$('reply').addEventListener('focus', () => api.typing(true));
$('reply').addEventListener('blur', () => api.typing(false));
$('reply').addEventListener('keydown', e => {
    if (e.key === 'Enter' && $('reply').value.trim()) {
        const text = $('reply').value.trim();
        $('reply').value = '';
        $('reply').blur();
        api.ask(text, said);
    } else if (e.key === 'Escape') {
        $('reply').blur();
    }
});

// --- what the app says to show ------------------------------------------------------------------

api.onUi(message => {
    switch (message.type) {
    case 'play':
        play(message.clip);
        break;
    case 'menu':
        setMenu(Boolean(message.open));
        break;
    case 'working':
        working = true;
        hideAt = 0;
        showBubble();
        setHeading(message.heading);
        $('spinner').hidden = false;
        $('mark').hidden = true;
        setText(message.text);
        setButtons({stop: message.stop});
        setProgress(message.progress ?? null);
        break;
    case 'progress':
        setProgress({fraction: message.fraction, detail: message.detail});
        $('stop').hidden = false;
        break;
    case 'result':
        working = false;
        showBubble();
        setHeading(message.heading);
        $('spinner').hidden = true;
        $('mark').hidden = false;
        $('mark').textContent = message.ok ? '✓' : '!';
        $('mark').classList.toggle('bad', !message.ok);
        setText(message.text);
        setProgress(null);
        setButtons({copy: message.text.length > 40, close: true, reply: message.reply});
        lingerFor(message.text);
        break;
    case 'confirm':
        working = false;
        hideAt = 0;
        showBubble();
        setHeading('This computer • Waiting for you');
        $('spinner').hidden = true;
        $('mark').hidden = true;
        setText(message.text);
        setProgress(null);
        setButtons({confirm: message.yes, close: false});
        break;
    case 'note':
        showBubble();
        setHeading(message.title);
        $('spinner').hidden = true;
        $('mark').hidden = true;
        setText(message.text, message.tappable);
        setProgress(null);
        setButtons({copy: message.text.length > 40, close: true, reply: true});
        lingerFor(message.text);
        break;
    case 'ring':
        setRinging(message.on);
        break;
    case 'sync':
        $('sync').textContent = `Clipboard sync: ${message.on ? 'on' : 'off'}`;
        break;
    default:
        break;
    }
});

// --- ringing ------------------------------------------------------------------------------------

let ringing = false;
let ringTimer = 0;
let audio = null;

/** A phone-like double beep every 1.2 seconds, until the pet is tapped. */
function setRinging(on) {
    ringing = on;
    clearInterval(ringTimer);
    if (!on) {
        if (!working)
            hideBubble();
        return;
    }
    audio ??= new AudioContext();
    const beep = at => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 0.4);
    };
    const ring = () => {
        beep(audio.currentTime);
        beep(audio.currentTime + 0.45);
    };
    ring();
    ringTimer = setInterval(ring, 1200);
    play('summon');
    working = true;
    showBubble();
    setHeading('This computer • Ringing');
    setText('right here. tap me to stop the ringing.');
    setButtons({stop: true});
}

// --- Talk to Butler -------------------------------------------------------------------------------

let recording = false;
let recorder = null;

$('talk').addEventListener('click', async () => {
    setMenu(false);
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({audio: true});
    } catch {
        showBubble();
        setHeading(null);
        setText("couldn't use the microphone. check Windows Settings → Privacy → Microphone.");
        setButtons({close: true});
        lingerFor('x'.repeat(200));
        return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
        recording = false;
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, {type: recorder.mimeType || 'audio/webm'});
        if (blob.size < 4000) {
            setText("I didn't hear anything.");
            setButtons({close: true});
            working = false;
            lingerFor('x'.repeat(100));
            return;
        }
        api.voice(new Uint8Array(await blob.arrayBuffer()), blob.type);
    };
    recording = true;
    recorder.start();
    play('summon');
    working = true;
    showBubble();
    setHeading('Microphone on');
    $('spinner').hidden = false;
    setText("Listening… tap me when you're done");
    setButtons({});
    setTimeout(() => recording && recorder.stop(), 20_000);
});

loadPets();
