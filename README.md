# editor-context

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps Claude aware of what you're looking at in **Cursor** or **VS Code**.

It shows your active file and selected lines in a band above the Claude Code prompt, and quietly attaches them to every message you send. "Explain this", "why does this line fail?" and "refactor these" just work, without pasting code or file paths.

```
●  CheckoutForm.tsx   L12–30 · 19 lines selected   unsaved         [Save] [Explain] [Pin] [Recent] [Pause]
   Pinned   useCart.ts   L36–48 · 13 lines                                                        [Unpin]
   Recent   Header.tsx   client.ts   Settings.tsx                                                 [Close]
```

Built for the **Code tab of the Claude desktop app**. In the terminal, Claude Code already gets your editor selection through `/ide`, so the mod stays off there.

## Features

| | |
|---|---|
| **Live file and selection** | The band shows the file name, the cursor line or the selected range, and how many lines are selected. It updates as you click around in your editor. |
| **Automatic context** | Each message you send carries the file's full path, the cursor line and the selected code. It's hidden from your chat; only Claude sees it. |
| **Explain** | One click asks Claude to explain the selection, or the whole file when nothing is selected. |
| **Pin** | Select lines and press Pin to keep them attached to every message, even after you move on to other files. |
| **Unsaved warning** | Flags a file with unsaved changes (so Claude knows the file on disk may differ from what you see), with a Save button that saves it in your editor. |
| **Recent files** | Hidden by default. Press Recent to show the last five files you visited; click one to open it in your editor. While shown, Claude also gets the list. |
| **Pause** | Stops sending anything to Claude until you press Resume. The band stays visible. |
| **Connection notices** | When no editor is open, the connection drops, or Node.js is missing, the band says so. Close hides the notice until something changes. |

## Requirements

- **The Claude desktop app** with Claude Code v2.1.287 or later.
- **The Claude Code extension in VS Code or Cursor** (by Anthropic, id `anthropic.claude-code`). This mod reads your editor state through it, so it must be installed and the editor open. See [Set up your editor](#set-up-your-editor).
- **Node.js 22 or later** on your machine. The mod finds it on your `PATH`, in Homebrew's folders, or through your login shell (nvm, fnm, volta).
- **macOS or Linux.**

## Set up your editor

This mod gets your open file and selection from the **Claude Code extension** for VS Code and Cursor. If you already use Claude Code inside your editor, you likely have it. Pick one way to install it:

- **From the editor:** open the Extensions view (`Cmd+Shift+X` on macOS, `Ctrl+Shift+X` on Linux), search for **Claude Code**, and install the one published by **Anthropic**. Cursor lists it too.
- **From your shell:**
  ```bash
  code --install-extension anthropic.claude-code     # VS Code
  cursor --install-extension anthropic.claude-code   # Cursor
  ```
- **Automatically:** run `claude` once in the editor's integrated terminal, and Claude Code installs the extension for you.

To check that it's running, open a project in the editor and run `ls ~/.claude/ide`. You should see a `.lock` file. The extension creates it while the editor is open, and that's what this mod connects to.

You don't need to use the extension's own Claude panel. It only has to be installed, with the editor open.

## Install

In a Claude Code session:

```
/plugin marketplace add talbarina/claude-editor-context
/plugin install editor-context@talbarina
```

Or from your shell:

```bash
claude plugin marketplace add talbarina/claude-editor-context
claude plugin install editor-context@talbarina
```

It's installed for your user, so it loads in every new desktop session, in any project. Run `/reload-plugins` to load it into a session that's already open.

## Using it

Open a file in your editor and the band appears above the prompt once a session is running. The orange dot means your file and selection are being shared with Claude; a grey ring means sharing is paused.

To see every row of the band at once with sample data, run `/editor-context-demo`. Run it again to switch back. Sample data is never sent to Claude.

### What Claude receives

Nothing appears in your chat. With each message, Claude also gets a short note like this:

```
The user has lines 12-30 of /path/to/project/src/components/CheckoutForm.tsx selected in Cursor.
"This", "here" or "these lines" likely refers to it:
<the selected code>
```

To save tokens, an unchanged selection, pin or recent-files list is referred to, not sent again. Selections longer than 20,000 characters are cut off.

## Privacy

Everything stays on your machine. The mod reads your editor state from the Claude Code extension's local connection and adds it only to the messages you send to Claude. Nothing else is sent anywhere. Press **Pause** whenever you don't want Claude to see what's open.

## How it works

The Claude Code extension in VS Code and Cursor runs a local server and writes its port to `~/.claude/ide/<port>.lock`. That's the same server the `claude` CLI uses for `/ide`.

On session start, the mod starts a small Node helper that:

1. picks the editor whose workspace contains your session's folder, or else the most recently opened one;
2. connects to that editor's server and listens for selection changes;
3. checks every 1.5 seconds whether the file has unsaved changes;
4. serves a Unix socket so the band's buttons can save and open files in the editor.

The editor's server accepts only one client at a time, so all your Claude Code sessions share a single connection per editor window. The first session's helper holds it and the others subscribe to it. When that session closes, another one takes over within a second. The helper reconnects on its own when the editor restarts, and quits with its session.

You can review exactly which events the mod handles and which Claude Code APIs it calls before installing:

```bash
git clone https://github.com/talbarina/claude-editor-context
claude plugin validate claude-editor-context/plugins/editor-context
```

## Troubleshooting

**The band isn't there on the desktop app's new-session screen.** That screen is the app's own, before any Claude Code session exists, so no mod can draw there. The band appears as soon as the session starts, and your first message still carries your editor context: the mod waits up to 4 seconds for it while starting up.

**There's no band in a terminal session.** That's by design: terminal sessions get your editor selection from Claude Code's own `/ide`, and the editor accepts one connection at a time, so the mod stays out of the way there.

**The band doesn't appear.**
- Make sure the editor is open, with the Claude Code extension installed. `ls ~/.claude/ide` should list a `.lock` file.
- Run `/plugin` and check that `editor-context` is listed as an active mod.

**"needs Node.js 22 or later" appears in the transcript.** Install Node 22+, then start a new session.

**"Lost connection" shows while a terminal session uses `/ide`.** The editor accepts one client at a time, so a terminal `claude` session connected to the same editor competes with the desktop app's band. The mod backs off and reconnects when the editor is free.

**It follows the wrong editor window.** It prefers the window whose workspace contains your session's folder. Start Claude Code from inside the project, or close the other window.

## Update or remove

```bash
claude plugin marketplace update talbarina
claude plugin uninstall editor-context@talbarina
```

## Credits

Icons from [Tabler Icons](https://tabler.io/icons) (MIT).

## License

[MIT](LICENSE) © 2026 Tal Barina
