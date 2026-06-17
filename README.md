# Ousia Workflow

Ousia Workflow is a framework for installing and evolving agent-facing development workflows. It owns the structure, lifecycle, validation rules, and agent reading protocol; projects fill facts inside Ousia-defined slots.

## Model

| Layer | Owner | Role |
| --- | --- | --- |
| Framework core | Ousia Workflow | Base instructions, facade skills, shared task modes, validation contracts, and upgrade policy. |
| Project profile | Ousia Workflow | Ousia-controlled skeleton for a class of projects. A profile defines which slots exist and how agents read them. |
| Project payload | Project | Project facts, design conclusions, validation commands, references, and local constraints placed inside profile-defined slots. |
| Local override | Project, temporary | Explicit deviations from the framework or profile. Overrides must name the rule they cover and their exit condition. |

Adapters and profiles are not freeform plugin systems. Their architecture is defined by Ousia Workflow so installed workflows can be upgraded predictably.

## Repository Layout

| Path | Role |
| --- | --- |
| `.github/instructions/ousia-*.instructions.md` | Active framework instructions for agents working in this repository. |
| `.github/instructions/ext-ousia-workflow.instructions.md` | Active repository policy for this workflow project profile. |
| `.github/skills/**` | Active framework skills and shared mode components. |
| `.ousia/workflow.json` | Manifest for ownership, profile, and upgrade policy. |
| `.ousia/design/**` | Ousia-defined design skeleton for this workflow project; this repository fills the slots. |
| `adapters/ext-ousia-os/**` | Preserved Ousia OS profile payload. It is not active workflow core. |
| `adapters/ext-ousia-workflow/**` | Reserved profile payload for developing Ousia Workflow itself; active policy currently lives in `.github/instructions/ext-ousia-workflow.instructions.md`. |
| `fixtures/**` | Future smoke fixtures for install and upgrade behavior. |

## Upgrade Boundary

- Ousia-owned files can be replaced by upgrade tooling when unmodified.
- Ousia-structured/project-filled files are merged by stable sections and preserve project content.
- Project-owned files are routed and validated but not rewritten by default.
- Local overrides are never overwritten silently and must carry an exit condition.

The central rule is: Ousia Workflow owns structure, lifecycle, validation, and reading protocol; projects own facts inside Ousia-defined slots.
