// Reading Claude Code's progress (claude -p --output-format stream-json): one JSON
// event per line. Butler turns it into short status lines for your phone.

const base = path => String(path ?? '').split('/').filter(Boolean).pop() ?? '';

/** A few words about what a tool call is doing, like "Editing extension.js". */
export function describeTool(name, input = {}) {
    switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
        return `Editing ${base(input.file_path ?? input.notebook_path) || 'a file'}`;
    case 'Read':
        return `Reading ${base(input.file_path) || 'a file'}`;
    case 'Bash': {
        const command = String(input.command ?? '').replace(/\s+/g, ' ').trim();
        return `Running ${command.length > 60 ? `${command.slice(0, 60)}…` : command || 'a command'}`;
    }
    case 'Grep':
    case 'Glob':
        return 'Searching the code';
    case 'WebFetch':
    case 'WebSearch':
        return 'Looking something up online';
    case 'TodoWrite':
        return 'Planning the next steps';
    case 'Task':
    case 'Agent':
        return 'Handing part of it to a helper';
    default:
        return `Using ${name}`;
    }
}

/**
 * Reads one line of output. Returns {action} for something Claude did, {result} when it
 * finished, {error} for a line that isn't JSON (a crash or a message from the shell), or null.
 */
export function readLine(line) {
    const text = line.trim();
    if (!text)
        return null;
    let event;
    try {
        event = JSON.parse(text);
    } catch (e) {
        return {error: text.slice(0, 300)};
    }
    if (event.type === 'result') {
        return {result: {
            ok: event.subtype === 'success' && !event.is_error,
            text: String(event.result ?? event.error ?? event.subtype ?? '').trim(),
            turns: event.num_turns ?? null,
            cost: event.total_cost_usd ?? null,
        }};
    }
    if (event.type === 'assistant') {
        const tools = (event.message?.content ?? []).filter(part => part.type === 'tool_use');
        if (tools.length)
            return {action: describeTool(tools.at(-1).name, tools.at(-1).input)};
    }
    return null;
}

/** The message your phone gets when Claude Code is done. */
export function finishedNote(folder, minutes, result) {
    const took = minutes < 1 ? 'under a minute' : `${Math.round(minutes)} min`;
    const summary = result.text.length > 700 ? `${result.text.slice(0, 700)}…` : result.text;
    return `Claude Code finished in ${folder} (${took}).${summary ? `\n\n${summary}` : ''}`;
}
