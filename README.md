# Cockpit

A Claude Code mod that puts the controls you reach for most into one place: a settings pane with a model and effort picker, a usage status line, a conversations pane, a Quicky pane of your own skills, and Clean View, a plain-English checklist of what Claude is doing.

Cockpit was previously called `usage-status`. On first start it brings over your saved `usage-status` settings.

## Install

```
/plugin marketplace add Mahtab12381/cockpit
/plugin install cockpit@local-mods
```

Restart Claude Code. Buttons for **✦ settings**, **✶ quicky** and **✧ conversations** then appear in the footer.

## Features

### Settings pane

Click **✦ settings** to open the pane. Press Tab to move between items, Enter to toggle one, and Esc to close.

- **Model & effort:** pick Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.1, plus an effort level (`auto`, `low`, `medium`, `high`, `xhigh`, `max`). `auto` keeps the session's own effort setting.
- **Theme:** five gradients (aurora, sunset, ocean, forest, neon). Cockpit remembers the one you pick.
- **List of mods:** turn each of the features below on or off, and set its options.

### Status line

A band above the prompt that shows:

- the current model
- how much of the context window is used
- your 5-hour usage window and when it resets

You can hide any of these parts. You can also choose the bar width (5, 10 or 15 cells) and the bar height (thin, half, tall or full).

### Clean View

Clean View hides the technical tool rows. In their place it shows a short checklist of the plan above the status line, with a progress bar for each step. It also tells you in plain words when Claude needs your OK, has a question, is stuck or has stopped.

Claude fills the checklist through two tools that Cockpit provides, `plan_steps` and `report_progress`. Run `/simple` to turn Clean View on or off.

### Quicky

Quicky is a pane of your own skills and slash commands, and each one runs with one click.

- **What it lists:** your own commands (`mine`), the ones you use most (`most used`), or every command (`all`). Each can show its description and how many times you've used it.
- **Presets:** save the arguments you use often under a command so it runs in one press. If a preset still contains a placeholder such as `<ticket>`, Cockpit puts it in the prompt for you to fill in instead of running it.
- **Detect options:** asks the model to suggest presets for a command. This makes a small model call.

### Conversations

A pane that lists this project's conversations, newest first. Click a row to switch to that conversation, or click **+ New conversation** to start a fresh one.

A colored dot shows each conversation's status:

| Status | Meaning |
|---|---|
| working | a turn is running |
| waiting | Claude asked for your OK or an answer |
| idle | open in Claude Code and finished |
| stopped | the last turn failed or was cut off |
| closed | not open anywhere |

You can show 5, 10, 20 or 40 conversations. The status dots, the legend, the age column and the new-conversation button can each be turned off.

## Development

```
claude plugin validate .   # check the plugin and marketplace manifests
claude plugin test .       # run the tests in tests/
claude plugin tag . --push # tag a release as cockpit--v<version>
```

| Path | Contents |
|---|---|
| `hooks/register.tsx` | the entry point: hooks, panes, the status line and commands |
| `hooks/clean-view.ts` | Clean View's checklist logic and wording |
| `hooks/conversations.ts` | reading and labelling conversations |
| `hooks/quicky.ts` | listing, ranking and presets for Quicky |
| `hooks/theme.ts` | theme gradients |
| `hooks/view.ts` | builds the status line view |
| `types/index.d.ts` | shared types and the plugin's state shape |

Before you tag a release, bump `version` in `.claude-plugin/plugin.json`.
