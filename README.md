# herdr-dsh

Herdr integration for the **DeepSeek Harness (DSH)** terminal UI.

Herdr normally shows a DSH pane as `unknown` because it has no built-in DSH
process manifest. This plugin makes DSH report itself through Herdr's
[agent API](https://herdr.dev/docs/add-herdr-support/), so you get:

- `dsh` in `herdr agent list` and the sidebar;
- `idle` / `working` / `done` from real harness events;
- `blocked` while an approval or `ask_user_question` prompt waits for you;
- the same conversation restored after a Herdr server restart;
- automatic release when the TUI exits.

No Herdr rebuild or pull request is required.

## Requirements

- **Herdr 0.9.2+** for resume support; state reporting works on 0.9.x.
- A DSH TUI built on Cordis profiles. The 0.1.x TUI is the one shipped by
  `@peiyu_wang/deepseek-harness-cli`; the official 0.2.x CLI no longer includes
  a TUI.
- **Node.js 22+**.

Tested with Herdr 0.9.3 and DSH 0.1.0-rc.15 on macOS.

## Install

Clone next to the harness home and run the installer:

```sh
git clone https://github.com/zeidalqadri/herdr-dsh.git "$HOME/.dsh/herdr-dsh"
"$HOME/.dsh/herdr-dsh/install.sh"
```

The script links the package into `~/.dsh/profiles/tui/node_modules`, backs up
`cordis.patch.yml`, appends the insert entry, and validates the composed profile
when `dsh` is on `PATH`. It is safe to run twice.

If `DSH_HOME` is set, the script uses `$DSH_HOME/profiles/tui`.

Restart the DSH TUI in its Herdr pane once. Profiles are read at boot, so a
running pane will not hot-load the plugin.

### Manual install

```sh
mkdir -p "$HOME/.dsh/profiles/tui/node_modules"
ln -sfn "$HOME/.dsh/herdr-dsh" "$HOME/.dsh/profiles/tui/node_modules/herdr-dsh"
```

Add this to `~/.dsh/profiles/tui/cordis.patch.yml`:

```yaml
- insert:
    - id: herdr-dsh
      name: 'herdr-dsh'
```

If the file currently contains only `[]`, replace it with the block above.

## Verify

Inside the pane that runs `dsh`:

```sh
herdr pane get "$HERDR_PANE_ID"
herdr agent list
```

Expected: the pane has `agent: dsh` and `agent_status: idle`. Send a prompt and
the state moves through `working` to `done`; an approval prompt shows `blocked`.
Herdr's `done` is an unviewed completion — `idle` and `done` both mean the agent
is ready for input.

The resume command is persisted in `~/.config/herdr/session.json`:

```sh
jq '.. | objects | select(.agent_resume?.source == "dsh") | .agent_resume' \
  "$HOME/.config/herdr/session.json"
```

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `resumeBin` / `DSH_HERDR_RESUME_BIN` | `deepseek` | Command Herdr runs to resume the session. The 0.1.x CLI installs `deepseek` and `dsh` aliases; use `dsh` if only that alias exists. |
| `DSH_HERDR_DEBUG=1` | off | Append report argv to `$TMPDIR/dsh-herdr-report.log`. |

Plugin config in the profile patch:

```yaml
- insert:
    - id: herdr-dsh
      name: 'herdr-dsh'
      config:
        resumeBin: dsh
```

## How it works

| DSH signal | Herdr report |
|---|---|
| `agent/status` `running` | `working` |
| `agent/status` `idle` | `idle` |
| `approval/request` or `user-questions/request` pending | `blocked` |
| root `session/created` | session id + `resumeBin --resume=<id>` |
| `agent/disposed` | removes that agent from the running set |
| process `exit` | `pane release-agent` |

A running counter keeps the pane `working` while subagents are active. Every
call is a short-lived detached `herdr` invocation with errors ignored, so a
slow or missing Herdr never fails the agent turn. Outside Herdr
(`HERDR_ENV != 1`) `apply()` returns immediately and the plugin is inert.

## Limitations

- Herdr has no built-in DSH manifest, so this is a **self-reported** agent.
  Herdr 0.9.3 shows the state but does not display the self-reported session id
  in `agent list`; the resume argv is persisted under `agent_resume` in
  `session.json` and is what a restore uses.
- Targets the 0.1.x TUI. The official 0.2.x CLI has no TUI. The events used
  here are part of the harness Cordis core, but other DSH surfaces are untested.
- The plugin reports only semantic state, the session id, and the resume
  command. It does not read credentials, prompts, or model output.
- Not affiliated with Herdr or DeepSeek.

## Uninstall

Remove the `herdr-dsh` insert from `cordis.patch.yml` and delete
`~/.dsh/profiles/tui/node_modules/herdr-dsh`, then restart the TUI. The
installer keeps a timestamped backup of the patch file.

## License

MIT
