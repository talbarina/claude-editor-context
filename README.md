<div align="center">

# editor-context

**Claude always knows what you're looking at in your editor.**

A mod for the Claude desktop app that shows your current Cursor or VS Code file and selection in a tab above the prompt, and quietly sends it to Claude with every message.

[![Version](https://img.shields.io/badge/version-1.8.2-D97757)](plugins/editor-context/.claude-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-8A8A8A)](LICENSE)
[![Claude desktop app](https://img.shields.io/badge/Claude-desktop%20app-8A8A8A)](https://code.claude.com/docs/en/plugins/mods/overview)

</div>

## Why

In the terminal, Claude Code already sees your editor selection through `/ide`. The desktop app doesn't. So you end up pasting code and file paths into every message.

With this mod, you just select the code and ask: "why does this fail?" or "explain this".

## Features

🗂️ **A tab above the prompt**<br>
The **Editor** tab shows the file you're in and its line range. Hover it for a card with everything else. Click the tab to turn sharing on or off. If other mods add tabs to the same row, they line up beside it.

👀 **Live file and selection**<br>
The tab follows your editor as you click around: the file, the selected lines, and a clay dot while it's sharing.

💬 **Sent with every message**<br>
Claude gets the file path and the selected code. It stays out of your chat; a small "Sent with" chip above your message shows what went with it.

⚡ **Start with `++`**<br>
Begin a new session's first message with `++`, as in `++ why does this jump?`, and it goes with your selection, then sharing stays on. The new-session screen has no tab yet, so this is how you turn it on from there. Claude doesn't see the `++`, though your message bubble still shows it. Works in sessions opened in a project folder, not in "No folder" sessions (see Good to know).

📌 **Pin**<br>
Pin up to 10 selections, from any files. They're attached to every message until you unpin them. Click a pin to jump back to its lines in your editor.

💾 **Unsaved warning**<br>
Tells you (and Claude) when the file has unsaved changes, with a Save button.

🔌 **Connection notices**<br>
Says when no editor is open or the connection drops.

🎛️ **Proper controls**<br>
The card's buttons are the app's own. The tab and the switch are drawn by the mod itself, styled after the app's own popovers.

## Quick start

**1. Install the Claude Code extension in your editor.**
Search for **Claude Code** by Anthropic in the Extensions view, or run:

```bash
cursor --install-extension anthropic.claude-code   # Cursor
code --install-extension anthropic.claude-code     # VS Code
```

**2. Install the mod.** In a Claude Code session:

```
/plugin marketplace add talbarina/claude-editor-context
/plugin install editor-context@talbarina
```

**3. Start a session** in the desktop app, in the same folder you have open in your editor, and click the **Editor** tab above the prompt to turn it on.

To preview every part of the tab and its card with sample data, run `/editor-context-demo`.

## Requirements

- The Claude desktop app, with Claude Code v2.1.287 or later
- VS Code or Cursor, open, with the Claude Code extension
- Node.js 22 or later
- macOS or Linux

## Good to know

- **Off at the start of every session.** Click the **Editor** tab to turn it on, or start the first message with `++`. The new-session screen comes before the session exists, so no mod can draw there; the tab appears once the session starts.
- **The card opens on hover.** Mods can only float a card on hover, not on click; the click on the tab is the on/off switch.
- **`++` needs a project folder.** In a "No folder" session the app starts the session ahead of time, and `++` doesn't turn sharing on there. Click the **Editor** tab instead.
- **Desktop app only.** In terminal sessions the mod stays off, because `/ide` already does this there.
- **One editor connection.** Your editor accepts one connection at a time. All your desktop sessions share it, but a terminal session using `/ide` on the same editor will take turns with them.
- **Long selections are cut** at 20,000 characters.

## What Claude sees

Nothing shows in your chat. Claude gets a short note with each message:

```
The user has lines 12-30 of /path/to/project/src/components/CheckoutForm.tsx
selected in Cursor. "This", "here" or "these lines" likely refers to it:
<the selected code>
```

If the selection hasn't changed since your last message, Claude gets a one-line reminder instead of the code again.

Select part of a row and only that part goes: the tab shows `L12:5–18`, and Claude reads "characters 5-18 of line 12". With nothing selected, Claude gets just the file path, with no line.

## 🔒 Privacy

Everything stays on your machine. The mod is off when a session starts: until you turn it on, it doesn't connect to your editor or send anything. Once on, it reads your editor through the Claude Code extension's local connection and adds it only to messages you send. Turn it off (click the tab, or the switch in its card) whenever you want Claude not to see what's open: it then sends nothing, and keeps the connection so turning it back on is instant.

## Troubleshooting

<details>
<summary><b>The tab says "off" or nothing is sent</b></summary>

- Click the **Editor** tab, or start the session's first message with `++`. It's off until you do.
- Check that the editor is open and the extension is installed: `ls ~/.claude/ide` should list a `.lock` file.
- Run `/plugin` and check that `editor-context` is listed as active.
- Make sure you're in the desktop app, not the terminal.
</details>

<details>
<summary><b>It says "Lost connection"</b></summary>

Another client took the editor's connection, usually a terminal session running `/ide`. The mod reconnects when the editor is free.
</details>

<details>
<summary><b>It says it needs Node.js</b></summary>

Install Node.js 22 or later, then start a new session.
</details>

<details>
<summary><b>It follows the wrong editor window</b></summary>

It picks the window that has your session's folder open. Start the session in that folder, or close the other window.
</details>

## How it works

<details>
<summary>Details</summary>

The Claude Code extension runs a small local server in your editor and records its port in `~/.claude/ide/`. When a desktop session starts, the mod launches a Node helper that connects to that server, listens for selection changes, and checks for unsaved changes every 1.5 seconds.

The editor accepts one client at a time, so the first session's helper holds the connection and the other sessions listen to it over a local socket. When that session closes, another takes over.

The tab sits in a row above the prompt that mods share: each tab's key carries its place in the row, so the order is the same whichever mod loads first. Its card is a hidden box the app shows as a popover while you hover the tab.

The tab and the card's switch are small custom controls (`hooks/controls.tsx`) that the app runs on its own. A click posts a press back to the mod, which runs that control's action. The card's other buttons are the app's own. The "Sent with" chips are drawn by `hooks/chips.tsx`.

To see exactly which events the mod handles and what it calls before you install it:

```bash
git clone https://github.com/talbarina/claude-editor-context
claude plugin validate claude-editor-context/plugins/editor-context
claude plugin test claude-editor-context/plugins/editor-context
```
</details>

## Update or remove

```bash
claude plugin marketplace update talbarina          # update
claude plugin uninstall editor-context@talbarina    # remove
```

## Credits

Icons by [Tabler Icons](https://tabler.io/icons) (MIT).

## License

[MIT](LICENSE) © 2026 Tal Barina
