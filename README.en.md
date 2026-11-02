# Historical Explainer Video

[简体中文](README.md) | **English**

[![Checks](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml/badge.svg)](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Create historical explainers and documentaries locally with **Codex**. Bring a topic and your sources. The agent and local tools work through planning, scripts, covers, narration, subtitles, visuals and an opener, then deliver an MP4. Work one stage at a time, resume existing progress, or revise a specific part.

**macOS is currently supported.** Sign in to the AI tools and external services you use. Image generation, narration and other services may incur charges. Install the local tools first, then configure accounts as each stage needs them.

[Install](#1-install) · [Codex](#2-use-codex) · [Configure](#3-configure-the-services-you-need) · [First project](#4-create-your-first-program) · [FAQ](#faq)

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

Use **Node.js 22.12 or newer**. Setup downloads Node dependencies, a Python environment and the rendering browser, so internet access is required. The final message `安装完成` means the local dependencies are ready.

Setup creates `.env` automatically and preserves it on subsequent runs. You do not need to create a Python environment or install Python packages yourself. Setup does not sign in to accounts or call paid generation services.

## 2. Use Codex

Install and sign in to [Codex](https://developers.openai.com/codex/), then open this repository as your project. Production uses Codex native image generation and subagents; no image API key or client configuration is needed. **Open the code repository, `historical-explainer-video`, and store program files in a separate directory.**

## 3. Configure the services you need

**Put keys and tool paths in your local `.env`, not `.env.example`.** Programs read it automatically; no repeated `export` commands are needed. Existing process environment variables take precedence. `.env` and login state are excluded from Git.

| When needed | What to prepare |
|---|---|
| Start P0 planning | A signed-in Codex host; public-source explainer planning can begin here |
| Use NotebookLM sources | `nlm` is included in setup; sign in with the command below. The documentary route requires NotebookLM |
| P1 scripts and P2 default subtitle author | Install and sign in to [Antigravity CLI (AGY)](https://antigravity.google/docs/getting-started?tab=cli) |
| P1 covers and P3 / P4 images | Codex native image generation |
| P2 narration and narrated openers | Set `MINIMAX_API_KEY`; keep the public default `MINIMAX_VOICE_ID` or choose a voice available to your account |
| Optional lookup of a specific claim in cited sources | Set `TYPESAFE_API_KEY`; the existing `~/.config/typesafe/api-key` location also works |
| Fallback subtitle recognition or word timing for narrated openers | Install [VideoCaptioner](https://github.com/WEIFENG2333/VideoCaptioner) with Bcut / Jianying word-level timing support and set `VIDEO_CAPTIONER_ROOT` |
| Explicitly requested generated video clips | Follow the [Dreamina CLI and login instructions](packages/modules/produce-video-assets/references/canvas-cli.md) |

Get a MiniMax key from the [China platform](https://platform.minimax.cn/docs/guides/quickstart-preparation) or [international platform](https://platform.minimax.io/docs/guides/quickstart-preparation). The original China endpoint remains the default. For an international account, add `MINIMAX_API_HOST=https://api.minimax.io` to `.env`; use a key from that region. Get a TypeSafe key from its [official console](https://console.typesafe.ai/).

<details>
<summary>NotebookLM login, AGY and optional music</summary>

Sign in to NotebookLM from the repository directory:

```bash
node packages/runtime-config.mjs nlm login
```

Install AGY using the command in its [official guide](https://antigravity.google/docs/getting-started?tab=cli):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Open a new terminal, run `agy` and complete the interactive login. AGY remains the script and default subtitle author.

When VideoCaptioner is needed, follow its [source installation instructions](https://github.com/WEIFENG2333/VideoCaptioner#开发) in a sibling directory:

```bash
git clone https://github.com/WEIFENG2333/VideoCaptioner.git ../VideoCaptioner
(cd ../VideoCaptioner && uv sync)
```

Then set `VIDEO_CAPTIONER_ROOT=../VideoCaptioner` in this repository’s `.env`. VideoCaptioner has its own environment; do not copy its files into this project.

No personal default background track is included. Without one, the main video has no background music. See the [music configuration](packages/features/background-music/library/README.md) to add music you have permission to use. Some teaching and opener sound files are silent placeholders; see [asset notices](THIRD_PARTY_NOTICES.md).

</details>

To inspect local dependencies and configuration:

```bash
npm run setup -- --check
```

This checks local dependencies and reports configuration status. It does not sign in or call generation services. A local check passing does not verify account login, API credit or final video quality. You do not need to run it before every production session.

## 4. Create your first program

From the repository directory, create a program directory outside the repository:

```bash
mkdir -p ../my-program
cp scripts/request.example.yaml ../my-program/request.yaml
```

Open `../my-program/request.yaml` in an editor. Replace `idea` with your topic; keep the other fields for your first try. Despite the `.yaml` extension, this file contains JSON: preserve its double quotes and commas.

In Codex, with this repository open, send the following. When first accessing the program directory, approve its read/write access in your host if prompted:

```text
Read director/SKILL.md and complete P0 for ../my-program.
```

P0 delivers the program plan. When ready to continue, send:

```text
Complete P1 for ep01 in ../my-program.
```

Continue with P2, P3 and P4 as needed, or explicitly request a range such as “Complete P2 through P4.” A request for P0 stops after P0.

To inspect the example request's planning progress:

```bash
node engine/cli.mjs status --workspace ../my-program --program first-video --stage p0
```

The final MP4 is in the episode's `output/final.mp4` **inside the program directory**. The director returns the exact path. Ask it for previews and revisions at the current stage.

The production skills and detailed methods are currently written in Chinese. Both hosts use those same files; the prompts above can be given in English.

## Common commands

Normally, tell Codex or Claude which stage to complete or which part to change. These commands are available for direct use:

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
