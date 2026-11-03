# Historical Explainer Video

[简体中文](README.md) | **English**

[![Checks](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml/badge.svg)](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Turn a historical question into a complete video—with a story to follow and ideas to understand.**

Bring a topic, a book or source material to **Codex**. Work through P0–P4: research and planning, narration, covers, voiceover, subtitles, storyboards, visuals, an opener and a locally rendered MP4. Built for independent creators making historical explainers and documentaries.

[See the visuals](#inside-an-episode) · [Watch complete episodes](#watch-the-finished-videos) · [Explore the workflow](#from-sources-to-a-finished-episode) · [Install](#1-install) · [Start creating](#4-create-your-first-program)

## Inside an episode

**Scenes tell the story. Animation unpacks the relationships.** The left preview comes from the published *Xiao Daocheng: From Saving Liu Song to Founding Qi* episode. The right features the explainer template’s *What Does the Average Salary Hide?* example.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=Qvwd7P1AvsQ&t=145s"><img src=".github/assets/showcase/narrative-motion.gif" alt="Narrative scene: foreground soldiers, city gates, crowds and distant fire create a battlefield with depth as the camera advances" width="100%"></a>
      <strong>Storytelling: enter the characters’ world</strong>
      <p>Look past a foreground soldier toward the burning gates. Crowds, walls and distant fire build layers of depth, while framing, lighting and camera movement convey the tension of battle.</p>
    </td>
    <td width="50%" valign="top">
      <a href="packages/templates/vox-explainer/examples/salary/README.md"><img src=".github/assets/showcase/explainer-motion.gif" alt="Explainer template example: money moves between eight people in an office, then transforms into an income staircase" width="100%"></a>
      <strong>Explanation: reveal how the relationships work</strong>
      <p>The same payroll is redistributed among eight people, then the money stacks become an income staircase. Characters, objects and camera movement reveal why an average can misrepresent most people’s earnings.</p>
    </td>
  </tr>
</table>

These are compressed, silent previews. Select the left image to watch the published episode with sound, or the right to explore the example’s source code and production notes. Maps, routes and diagrams are also available when the subject needs them. [Narrative method](packages/templates/fullframe-narrative/AUTHOR.md) · [Explainer animation method](packages/templates/vox-explainer/AUTHOR.md)

## From sources to a finished episode

### Decide what the episode should explain before making the visuals

Start from a topic, a specified book or a reference program. Establish the editorial direction, each episode’s question and the source material before writing. Explainers and documentaries use their own planning and writing methods. Source references, factual grounding and the boundaries of historical reconstruction remain part of the production records.

For *Yuan Shu*, the question is: “With money and troops, why couldn’t he command his allies?” The script, scenes and explanations develop that question. [Program planning](packages/modules/plan-program/SKILL.md) · [Documentary planning](packages/modules/plan-historical-documentary/SKILL.md)

### Work in stages, resume progress and revise specific parts

Use natural language to request a stage or a range. Codex resumes existing progress. Scripts, subtitles, openers and main visuals have targeted revision paths that preserve work which remains valid. Preview visuals during production in HyperFrames Studio.

```text
Complete P0 for ../my-program.
```

Once the program is planned, work on an episode:

```text
Complete P1 for ep01 in ../my-program.
Complete P2 through P4 for ep01 in ../my-program.
Adjust only the opener visuals for ep01; keep the narration unchanged.
```

### Get the finished video, production documents and publishing materials

<table>
  <tr>
    <td width="70%" align="center" valign="top">
      <a href="https://www.youtube.com/watch?v=xhhdzvd3pbI&t=2s"><img src=".github/assets/showcase/opener.jpg" alt="Yuan Shu opener: why did declaring himself emperor weaken his authority over his allies?" height="220"></a><br>
      <strong>An opener that introduces the episode’s question</strong>
    </td>
    <td width="30%" align="center" valign="top">
      <img src=".github/assets/showcase/yuan-shu-vertical.jpg" alt="Portrait cover for Yuan Shu, delivered alongside the landscape version below" height="220"><br>
      <strong>Portrait cover</strong>
    </td>
  </tr>
</table>

The video gallery below uses landscape covers. Each episode also delivers a portrait cover to help prepare publishing materials for different platforms.

| Stage | What you receive |
|---|---|
| P0 — Planning | Program direction, sources and episode plan |
| P1 — Writing | Narration, opener copy, platform copy and landscape/portrait covers |
| P2 — Audio | Narration and subtitles, including pronunciation handling for proper names |
| P3 — Main visuals | Storyboards, full-frame scenes, explanatory animation and camera design |
| P4 — Opener and final render | Opener and the episode’s `output/final.mp4` |

The final delivery retains the **MP4, two cover formats, publication copy and chapter timing**, plus formal scripts, subtitles, storyboards, designs and source records. Rendering chooses concurrency based on temporary disk space and memory conditions, then cleans production media and caches after success.

**Generated video clips are off by default and require an explicit request.** The open-source production workflow ends at P4; publishing is handled outside the project. After cleanup, previewing or rendering again requires preparing deleted media again. Documents and publishing materials remain available.

## Watch the finished videos

Published episodes made with this project. Select a cover to watch on YouTube.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=xhhdzvd3pbI"><img src=".github/assets/showcase/yuan-shu.jpg" alt="Yuan Shu: why did his allies ignore him?" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=xhhdzvd3pbI"><strong>▶ Yuan Shu: why did his allies ignore him?</strong></a>
    </td>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=JVIIlA-AvBw"><img src=".github/assets/showcase/song-gaozong.jpg" alt="Why did Emperor Gaozong depend on Qin Hui?" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=JVIIlA-AvBw"><strong>▶ Why did Emperor Gaozong depend on Qin Hui?</strong></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=LHVS_zGPVvI"><img src=".github/assets/showcase/northern-wei.jpg" alt="Northern Wei reform: who gained a future?" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=LHVS_zGPVvI"><strong>▶ Northern Wei reform: who gained a future?</strong></a>
    </td>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=Qvwd7P1AvsQ"><img src=".github/assets/showcase/liu-song.jpg" alt="Xiao Daocheng: from saving Liu Song to founding Qi" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=Qvwd7P1AvsQ"><strong>▶ Xiao Daocheng: from saving Liu Song to founding Qi</strong></a>
    </td>
  </tr>
</table>

## 1. Install

**macOS is currently supported.** Sign in to the AI tools and external services you use. Image generation, narration and other services may incur charges. Install the local tools first, then configure accounts as each stage needs them.

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
| Lower resource use while rendering | Automatic selection uses video duration, temporary disk space and available memory. Set `RENDER_WORKERS=1` in `.env` for one worker, or `RENDER_WORKERS=auto` to restore automatic selection. |

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

After the final video passes the media checks and is saved, production images, intermediate audio/video and episode caches are cleaned automatically. Formal scripts, subtitles, storyboards, designs and source records remain, along with the MP4, covers, publication copy and chapter timing. Failed renders, shared programme materials and other episodes are not cleaned. Publishing and document review still work; rendering again requires preparing the removed media again. Existing completed videos are not retroactively cleaned.

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
