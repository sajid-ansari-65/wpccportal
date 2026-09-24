@AGENTS.md

## Git in this project

Sajid has allowed Claude to run `git commit` and `git push` in this repo
only. This overrides the global "never write" rule for those two commands
here and nowhere else. Everything else in that rule still applies: no
`merge`, `rebase`, `tag`, `reset` or force-push — hand those over as
commands for him to paste.
