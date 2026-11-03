# Historical Explainer Video

[简体中文](README.md) | **English**

[![Checks](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml/badge.svg)](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Create historical explainers and documentaries locally with **Codex**. Bring a topic and your sources. The agent and local tools work through planning, scripts, covers, narration, subtitles, visuals and an opener, then deliver an MP4. Work one stage at a time, resume existing progress, or revise a specific part.

**macOS is currently supported.** Sign in to the AI tools and external services you use. Image generation, narration and other services may incur charges. Install the local tools first, then configure accounts as each stage needs them.

[Install](#1-install) · [Codex](#2-use-codex) · [Sign in and voiceover](#3-sign-in-and-voiceover) · [First project](#4-create-your-first-program) · [FAQ](#faq)

## What it produces

- Historical explainers and documentaries, each with its own planning and writing method.
- Full-frame visual storytelling, code-driven explanatory animation, diagrams and maps.
- Landscape and portrait covers, voiceover, subtitles, sound effects, an opener and a final MP4.
- HyperFrames Studio previews, saved progress and targeted revisions.

| Stage | Output |
|---|---|
| P0 — Planning | Program direction, sources and episode plan |
| P1 — Writing | Narration, opener copy, platform copy and two cover formats |
| P2 — Audio | Narration audio and subtitles |
| P3 — Main visuals | Storyboards, images, animation and camera design |
| P4 — Opener and final render | Opener and the episode's `output/final.mp4` |

**Generated video clips are off by default and require an explicit request.** P4 normally creates the opener and renders the final video last. The open-source workflow ends at P4; publish to platforms yourself.

## 1. Install

Install [Homebrew](https://brew.sh/) first. Then run these commands in Terminal, in order:

```bash
brew install git node ffmpeg imagemagick uv
git clone https://github.com/imocone/historical-explainer-video.git
cd historical-explainer-video
npm run setup
```

Use **Node.js 22.12 or newer**. Setup downloads Node dependencies, a Python environment and the rendering browser, so internet access is required. The final message `本地工具已就绪` means the local dependencies are ready.

Setup creates `.env` automatically and preserves it on subsequent runs. It also installs VideoCaptioner; no separate Python environment, package installation or word-timing tool setup is needed. Setup does not sign in to accounts or call paid generation services.

## 2. Use Codex

Install and sign in to [Codex](https://developers.openai.com/codex/), then open this repository as your project. Production uses Codex native image generation and subagents; no image API key or client configuration is needed. **Open the code repository, `historical-explainer-video`, and store program files in a separate directory.**

## 3. Sign in and voiceover

For the default finished video, sign in to Codex, install and sign in to AGY, then enter your own MiniMax key. Images and word timing need no additional configuration.

Install AGY using its [official guide](https://antigravity.google/docs/getting-started?tab=cli):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Open a new terminal, run `agy` once and sign in. It authors scripts and the default subtitles.

Open the local configuration created by setup:

```bash
open -a TextEdit .env
```

Fill in `MINIMAX_API_KEY`. Keep `MINIMAX_VOICE_ID` at its default or choose a voice available to your account. Get a key from the [MiniMax China console](https://platform.minimax.cn/); international accounts also set `MINIMAX_API_HOST=https://api.minimax.io`. The key and region must match. Enter keys only in your local `.env`, not `.env.example` or chat; `.env` is excluded from Git.

Prepare accounts as needed: Codex for P0, AGY before P1, and the narration key before P2.

<details>
<summary>Optional: sources, music, generated video and existing tools</summary>

| When needed | What to prepare |
|---|---|
| NotebookLM sources; required for documentaries | Already installed; run `node packages/runtime-config.mjs nlm login` from the repository |
| Lookup of a specific claim in cited sources | Set `TYPESAFE_API_KEY` from the [official console](https://console.typesafe.ai/); the existing `~/.config/typesafe/api-key` also works |
| Background music | Add music you have permission to use, following the [music configuration](packages/features/background-music/library/README.md) |
| Explicitly requested generated video | Follow the [Dreamina instructions](packages/modules/produce-video-assets/references/canvas-cli.md) |
| Your own separate VideoCaptioner installation | Only then set `VIDEO_CAPTIONER_ROOT` and, if needed, `VIDEO_CAPTIONER_PYTHON`; otherwise use the project-installed version |

The public version has no personal default BGM, some opener sounds are silent placeholders, and subtitles use bundled fonts. No other user's private files or settings are needed. See [asset notices](THIRD_PARTY_NOTICES.md). Programs read `.env` automatically; process environment values take precedence. Normally no tool-path changes or repeated `export` commands are needed.

</details>

To inspect local dependencies and configuration:

```bash
npm run setup -- --check
```

This checks the actual local tools and distinguishes them from account preparation. It does not sign in or call generation services. Do not run it before every production session.

## 4. Create your first program

With this repository open in Codex, send the following, replacing the topic:

```text
Read director/SKILL.md.
Create a historical explainer in ../my-program about [your historical question].
Plan from the topic and complete P0.
```

The director prepares the directory and request file; no manual JSON editing is needed. Include any source paths or links. State explicitly if you want a documentary or planning based on a book or reference program. Approve access to the program directory when prompted by the host.

P0 delivers the program plan. When ready to continue, send:

```text
Complete P1 for ep01 in ../my-program.
```

Continue with P2, P3 and P4 as needed, or explicitly request a range such as “Complete P2 through P4.” A request for P0 stops after P0.

To inspect progress or continue, tell Codex the program directory and stage.

The final MP4 is in the episode's `output/final.mp4` **inside the program directory**. The director returns the exact path. Ask it for previews and revisions at the current stage.

The production skills and detailed methods are currently written in Chinese. The prompts above can be given to Codex in English.

## Common commands

Normally, tell Codex which stage to complete or which part to change. These commands are available for direct use:

```bash
# Inspect program or episode progress
node engine/cli.mjs status --workspace <program-directory> [--episode <epNN>]
# Inspect or continue one stage
node engine/cli.mjs status --workspace <program-directory> --episode <epNN> --stage <p1|p2|p3|p4>
node engine/cli.mjs next --workspace <program-directory> --episode <epNN> --stage <p1|p2|p3|p4>
# Run an explicitly authorized range
node engine/cli.mjs run --workspace <program-directory> --episode <epNN> --from p1 --to p4
# Restart an explicitly requested whole stage; previous accepted output is retained until replacement
node engine/cli.mjs reset --workspace <program-directory> --episode <epNN> --stage <p1|p2|p3|p4>
# P4 defaults to opener + final render; enable generated video only on explicit request
node engine/cli.mjs next --workspace <program-directory> --episode <epNN> --stage p4 --video on
node engine/cli.mjs next --workspace <program-directory> --episode <epNN> --stage p4 --video off
```

Replace `<...>` placeholders before running a command; brackets mark optional arguments. `next` returns the current work order for the agent or executes a program-owned action. The director handles author work and acceptance through the existing workflow. See the [full command reference](README.md#常用命令) for detailed revision commands.

## Update

If you have not modified repository code, run from the repository directory:

```bash
git pull --ff-only
npm run setup
```

Your `.env` and program directories outside the repository are preserved. Resolve local code conflicts before updating; do not force-overwrite your changes.

## FAQ

**`brew` or `node` not found?** Complete the [Homebrew installation](https://brew.sh/) and its shell setup instructions, open a new terminal, then retry. `node --version` must report 22.12 or newer.

**Missing background music or sound effects?** Personal music and restricted original audio are not distributed. Some public sounds are silent placeholders. Configure media you are allowed to use.

**Windows or Linux?** The installer currently supports macOS only. Media-tool integration on other platforms has not been completed.

## Contributing, support and license

Report usage problems in [Issues](https://github.com/imocone/historical-explainer-video/issues) and read [CONTRIBUTING](CONTRIBUTING.md) before submitting changes. Send vulnerabilities through [private security reporting](https://github.com/imocone/historical-explainer-video/security/advisories/new); see [SECURITY](SECURITY.md).

Original code and documentation are [MIT licensed](LICENSE). Fonts, maps, textures, audio and dependencies retain their own licenses; see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md). Real programs, rendered and example videos, keys, login state, old development archives and restricted original media are not distributed.

The basic installer, package and resource checks, configuration and image authorization tests have been verified. Real paid generation and final production quality still require acceptance during actual use.
