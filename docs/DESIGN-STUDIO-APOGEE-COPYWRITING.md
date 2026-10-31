# Visual Design Studio — Apogee + Conversion Copy

## Apogee integration

- Package: `@ava-ui/apogee@0.11.0` (MIT; preserve copyright and licence notices when copying source files).
- The source registry is bundled by npm under `node_modules/@ava-ui/apogee/registry/index.json`.
- `npm run apogee:catalog` builds a compact public catalogue from that registry. It includes components, sections, blocks and full-page patterns; source code is not copied into the browser bundle.
- In the editor, choose an item and add it to the portable page spec. Each Apogee block records its registry name, source files, JS requirement and package dependencies.
- To materialize the selected component in a target Astro + Tailwind v4 project, run the generated command: `npx @ava-ui/apogee add <registry-name>`. Apogee resolves registry dependencies and prints any npm dependencies to install. Review generated files before production use.
- The CMS remains framework-neutral at the JSON/spec layer. Apogee source installation is the Astro renderer path; other framework renderers are future adapters.
- Apogee CLI telemetry can be disabled with `APOGEE_TELEMETRY=0` when using the CLI.

## Conversion Copy Studio

This is an original copywriting workflow inspired by publicly documented FlexiFunnels Marketing Agents, not copied proprietary prompts or page copy.

Documented FlexiFunnels process: define a customer profile (audience, desired result, pain points), create a campaign and select content tasks, deploy a task-specific agent, answer its follow-up questions, then review, regenerate or edit the output. Documented content categories include ad hooks, email copy, page headlines and video scripts.

The CMS copy brief supports widely used frameworks:
- AIDA — Attention, Interest, Desire, Action
- PAS — Problem, Agitate, Solution
- BAB — Before, After, Bridge
- 4Ps — Promise, Picture, Proof, Push

Guardrails: do not invent testimonials, credentials, performance numbers, scarcity, guarantees or customer outcomes. User-provided evidence must be reviewed before publishing.

## FlexiFunnels connection status

FlexiFunnels calls its conversational assistant **Flexi Genie**. FlexiFunnels MCP is the Model Context Protocol connection that exposes account actions to ChatGPT, Claude and other assistants; it is not a separate GPT model. The official help article documents ChatGPT MCP setup using a user-authorized connection URL from the FlexiFunnels dashboard. No FlexiFunnels account connection is configured in this CMS branch, so the builder uses the public knowledge-base workflow as design guidance only. Never hard-code MCP URLs, credentials or account tokens into the repository.
