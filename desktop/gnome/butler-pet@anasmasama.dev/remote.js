// Remote control: commands from your phone, run on this laptop. Off until you turn it
// on here, and every command must contain your secret word. The word is kept only as a
// salted hash on this laptop, and is taken out before the command goes anywhere else.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {finishedNote, readLine} from './claudeevents.js';
import {addStrike, badWord, locked, normalize, takeSecret} from './secretword.js';

const STATE_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'butler', 'remote.json']);
const LOG_FILE = GLib.build_filenamev([GLib.get_user_state_dir(), 'butler', 'remote-log.jsonl']);
const HASH_ROUNDS = 5000;
const CLAUDE_MINUTES = 120;     // Claude Code is stopped after this long ("claudeMinutes" in pet.json)
const REPORT_EVERY = 10 * 60;   // seconds between "still working" updates on your phone
const LIVE_EVERY = 20 * 1000;   // at most this often, your phone hears what Claude Code is doing now

function hashWord(word, salt) {
    let hash = `${salt}:${normalize(word)}`;
    for (let i = 0; i < HASH_ROUNDS; i++)
        hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, `${salt}${hash}`, -1);
    return hash;
}

/** The project folders, for "finish the Glance project": ~/Desktop/Projects unless pet.json says "projects". */
export function projectsDir(config) {
    const dir = config?.projects ?? GLib.build_filenamev([GLib.get_home_dir(), 'Desktop', 'Projects']);
    return dir.replace(/^~(?=\/|$)/, GLib.get_home_dir());
}

function listFolders(dir) {
    const names = [];
    try {
        const children = Gio.File.new_for_path(dir).enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = children.next_file(null))) {
            if (info.get_file_type() === Gio.FileType.DIRECTORY && !info.get_name().startsWith('.'))
                names.push(info.get_name());
        }
        children.close(null);
    } catch (e) {
        // no projects folder
    }
    return names.sort();
}

/** Where Claude Code is: pet.json's "claude", else the usual places it installs to. Null to ask a login shell. */
function findClaude(config) {
    const home = GLib.get_home_dir();
    const candidates = [config?.claude, GLib.find_program_in_path('claude'),
        `${home}/.local/bin/claude`, `${home}/.claude/local/claude`, `${home}/.npm-global/bin/claude`,
        '/usr/local/bin/claude', '/usr/bin/claude'];
    return candidates.find(path => path && GLib.file_test(path.replace(/^~/, home), GLib.FileTest.IS_EXECUTABLE))
        ?.replace(/^~/, home) ?? null;
}

export class RemoteControl {
    /**
     * `host` is the pet: send(config, path, fields), operate(config, goal, job), notify(title, text),
     * banner(text or null) for the "Butler is in control" bar, and status(state, text) for its bubble.
     */
    constructor(host) {
        this._host = host;
        this._state = this._load();
        this._strikes = [];
        this._job = null;
        this._changed = new Set();
    }

    watch(callback) {
        this._changed.add(callback);
        return () => this._changed.delete(callback);
    }

    get on() {
        return Boolean(this._state.on && this._state.hash);
    }

    get hasWord() {
        return Boolean(this._state.hash);
    }

    /** What's running now, or null. */
    get job() {
        return this._job;
    }

    _load() {
        try {
            const [, bytes] = GLib.file_get_contents(STATE_FILE);
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            return {on: false};
        }
    }

    _save() {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(STATE_FILE), 0o700);
            GLib.file_set_contents(STATE_FILE, JSON.stringify(this._state));
            GLib.chmod(STATE_FILE, 0o600);
        } catch (e) {
            console.error('butler-pet: could not save the remote control settings', e);
        }
        for (const callback of this._changed)
            callback();
    }

    /** Sets the secret word. Returns why it can't be used, or null when it's saved. */
    setWord(word) {
        const problem = badWord(word);
        if (problem)
            return problem;
        const salt = GLib.uuid_string_random();
        this._state = {...this._state, salt, hash: hashWord(word, salt)};
        this._strikes = [];
        this._save();
        this._log({event: 'word changed'});
        return null;
    }

    setOn(on) {
        if (on && !this.hasWord)
            return;
        this._state = {...this._state, on};
        this._strikes = [];
        this._save();
        this._log({event: on ? 'turned on' : 'turned off'});
    }

    _isSecret(word) {
        return Boolean(this._state.hash) && hashWord(word, this._state.salt) === this._state.hash;
    }

    // --- the activity log -----------------------------------------------------------------

    _log(entry) {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(LOG_FILE), 0o700);
            const line = `${JSON.stringify({at: new Date().toISOString(), ...entry})}\n`;
            const stream = Gio.File.new_for_path(LOG_FILE).append_to(Gio.FileCreateFlags.PRIVATE, null);
            stream.write_all(new TextEncoder().encode(line), null);
            stream.close(null);
        } catch (e) {
            console.error('butler-pet: could not write the remote control log', e);
        }
        for (const callback of this._changed)
            callback();
    }

    /** The newest `count` log entries, newest first. */
    recent(count = 8) {
        try {
            const [, bytes] = GLib.file_get_contents(LOG_FILE);
            const lines = new TextDecoder().decode(bytes).trim().split('\n').filter(Boolean);
            return lines.slice(-count).reverse().map(line => JSON.parse(line));
        } catch (e) {
            return [];
        }
    }

    // --- commands ---------------------------------------------------------------------------

    /** Tells your phone how it's going, and shows the same in the pet's bubble here. */
    _report(config, state, text, job = this._job?.id) {
        this._host.status?.(state, text);
        return this._host.send(config, '/api/laptop/status', {device: 'laptop', state, text, job: job ?? ''})
            .catch(e => console.warn(`Butler: couldn't tell the phone (${state}): ${e.message}`));
    }

    /** A command from another device, still holding the secret word. */
    async handle(config, message) {
        const from = message.from_device ?? 'phone';
        if (!this.on) {
            this._log({event: 'refused', from, why: 'remote control is off'});
            return this._report(config, 'refused', "Remote control is off on the laptop. Turn it on from the pet's menu there.", message.job);
        }
        const {ok, rest} = takeSecret(message.body ?? '', word => this._isSecret(word));
        if (!ok) {
            this._strikes = addStrike(this._strikes);
            this._log({event: 'refused', from, why: 'no secret word'});
            if (locked(this._strikes)) {
                this.setOn(false);
                this._host.notify('Remote control locked',
                    '3 commands came without your secret word, so remote control is off. Turn it back on from the pet\'s menu if that was you.');
                return this._report(config, 'locked',
                    '3 commands came without the secret word, so remote control is now off. Turn it back on at the laptop.', message.job);
            }
            return this._report(config, 'refused', "That command didn't have the secret word, so I ignored it.", message.job);
        }
        this._strikes = [];
        if (!rest)
            return this._report(config, 'refused', 'I only got the secret word. What should I do?', message.job);
        if (this._job)
            return this._report(config, 'refused', `I'm still on "${this._job.command}". Stop it first.`, message.job);

        this._job = {id: message.job ?? null, command: rest, from, stop: false, started: Date.now(), proc: null};
        this._log({event: 'started', from, command: rest});
        this._host.banner(`Butler is in control: ${rest}`);
        this._host.notify('Butler is controlling this laptop', `From your ${from}: ${rest}\nTap the pet or press Esc to stop.`);
        this._report(config, 'started', rest);
        let result;
        try {
            result = await this._run(config, rest);
        } catch (e) {
            result = {state: 'failed', text: e.message};
        }
        if (this._job.stop && result.state !== 'done')
            result = {state: 'stopped', text: `Stopped: ${rest}`};
        this._log({event: result.state, command: rest, result: result.text.slice(0, 500)});
        this._job = null;
        this._host.banner(null);
        return this._report(config, result.state, result.text);
    }

    async _run(config, command) {
        const folders = listFolders(projectsDir(config));
        const job = await this._host.send(config, '/api/laptop/plan', {text: command, folders: JSON.stringify(folders)});
        if (this._job.stop)
            return {state: 'stopped', text: ''};
        switch (job.do) {
        case 'open':
            Gio.AppInfo.launch_default_for_uri(job.url, null);
            return {state: 'done', text: `Opened ${job.url}`};
        case 'app':
            return this._openApp(job.name);
        case 'screen': {
            const {ok, say} = await this._host.operate(config, job.goal, this._job, text => this._report(config, 'working', text));
            return {state: ok ? 'done' : 'failed', text: say};
        }
        case 'claude':
            return this._claude(config, job);
        default:
            return {state: 'refused', text: job.say || "I won't do that remotely."};
        }
    }

    _openApp(name) {
        const ids = Shell.AppSystem.search(name).flat();
        const app = ids.map(id => Shell.AppSystem.get_default().lookup_app(id)).find(Boolean);
        if (!app)
            return {state: 'failed', text: `I couldn't find an app called ${name}.`};
        app.activate();
        return {state: 'done', text: `Opened ${app.get_name()}`};
    }

    /** Runs Claude Code in a project folder until it's done, telling your phone how it's going. */
    async _claude(config, job) {
        const dir = GLib.build_filenamev([projectsDir(config), job.folder]);
        if (!GLib.file_test(dir, GLib.FileTest.IS_DIR))
            return {state: 'failed', text: `There's no folder ${dir}.`};
        const args = ['-p', job.prompt, '--output-format', 'stream-json', '--verbose',
            ...(config.claudeArgs ?? ['--permission-mode', 'acceptEdits'])];
        const claude = findClaude(config);
        // Not found? A login shell knows the PATH you set up in ~/.profile.
        const command = claude ? [claude, ...args] : ['bash', '-lc', 'exec claude "$@"', 'claude', ...args];
        // In its own process group, so Stop ends Claude Code and every command it started.
        const argv = GLib.find_program_in_path('setsid') ? ['setsid', ...command] : command;
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE});
        launcher.set_cwd(dir);
        const proc = launcher.spawnv(argv);
        const cancel = new Gio.Cancellable();
        this._job.proc = proc;
        this._job.end = () => {
            cancel.cancel();
            const pid = proc.get_identifier();
            if (pid && argv[0] === 'setsid')
                Gio.Subprocess.new(['kill', '-TERM', '--', `-${pid}`], Gio.SubprocessFlags.STDERR_SILENCE);
            proc.force_exit();
        };
        this._report(config, 'working', `Claude Code is working in ${job.folder}: ${job.prompt.slice(0, 300)}`);

        const started = Date.now();
        const limit = (config.claudeMinutes ?? CLAUDE_MINUTES) * 60;
        let last = 'Starting up';
        let lastLive = Date.now();
        let result = null;
        const errors = [];
        let overtime = false;
        const minutes = () => (Date.now() - started) / 60000;
        const ticker = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REPORT_EVERY, () => {
            if (minutes() * 60 >= limit) {
                overtime = true;
                this._job.end();
                return GLib.SOURCE_REMOVE;
            }
            this._report(config, 'working', `${Math.round(minutes())} min in, in ${job.folder}. Last: ${last}`);
            return GLib.SOURCE_CONTINUE;
        });

        const lines = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe(), close_base_stream: true});
        try {
            for (;;) {
                const [line] = await new Promise((resolve, reject) => lines.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (stream, res) => {
                    try {
                        resolve(stream.read_line_finish_utf8(res));
                    } catch (e) {
                        reject(e);
                    }
                }));
                if (line === null)
                    break;
                const got = readLine(line);
                if (got?.action) {
                    last = got.action;
                    if (Date.now() - lastLive > LIVE_EVERY) { // the line in your phone's pet bubble
                        lastLive = Date.now();
                        this._report(config, 'working', last);
                    } else {
                        this._host.status?.('working', last); // the laptop's bubble shows every step
                    }
                }
                else if (got?.result)
                    result = got.result;
                else if (got?.error)
                    errors.push(got.error) > 5 && errors.shift();
            }
            await new Promise(resolve => proc.wait_async(cancel, () => resolve()));
        } catch (e) {
            if (!cancel.is_cancelled())
                errors.push(e.message);
        } finally {
            GLib.source_remove(ticker);
        }

        if (this._job.stop)
            return {state: 'stopped', text: `Stopped Claude Code in ${job.folder} after ${Math.round(minutes())} min. Last: ${last}`};
        if (overtime)
            return {state: 'failed', text: `Claude Code ran past ${Math.round(limit / 60)} min in ${job.folder}, so I stopped it. Last: ${last}`};
        if (result?.ok)
            return {state: 'done', text: finishedNote(job.folder, minutes(), result)};
        const code = proc.get_if_exited() ? proc.get_exit_status() : 'unknown';
        const why = result?.text || errors.join('\n') || `it exited with code ${code}`;
        return {state: 'failed', text: `Claude Code didn't finish in ${job.folder}: ${why.slice(0, 700)}`};
    }

    /** Stops what's running. `off` also switches remote control off (the phone's kill switch). */
    stop(off = false) {
        if (this._job) {
            this._job.stop = true;
            this._job.end?.();
        }
        if (off && this._state.on) {
            this.setOn(false);
            this._host.notify('Remote control is off', 'Your phone switched it off. Turn it back on from the pet\'s menu.');
        }
        this._log({event: off ? 'kill switch' : 'stop', running: this._job?.command ?? null});
    }
}
