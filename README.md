# Ousia Workflow

Ousia Workflow is a framework for installing and evolving agent-facing development workflows. It owns the structure, lifecycle, validation rules, and agent reading protocol; projects fill facts inside Ousia-defined slots.

## Model

| Layer            | Owner              | Role                                                                                                                          |
| ---------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Framework core   | Ousia Workflow     | Base instructions, facade skills, shared task modes, validation contracts, and upgrade policy.                                |
| Adapter instance | Project            | Installed `.ousia/**` surface containing project facts, design conclusions, validation commands, references, and constraints. |
| Local override   | Project, temporary | Explicit deviations from the framework. Overrides must name the rule they cover and their exit condition.                     |

There is only one Ousia project directory: `.ousia/**`. It contains the installed project facts, design conclusions, pending work, and overrides.

## Repository Layout

| Path                                                      | Role                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.github/instructions/ousia-*.instructions.md`            | Active framework instructions for agents working in this repository.                                                               |
| `.github/instructions/ext-ousia-workflow.instructions.md` | Active repository policy for this workflow project.                                                                                |
| `.github/skills/**`                                       | Active framework skills and shared mode components.                                                                                |
| `.ousia/workflow.json`                                    | Manifest for ownership and upgrade policy.                                                                                         |
| `.ousia/design/**`                                        | Installed project design facts organized as Architecture, Proposal, and Experience.                                                |
| `fixtures/**`                                             | Future smoke fixtures for install and upgrade behavior.                                                                            |

## Upgrade Boundary

- Ousia-owned files can be replaced by upgrade tooling when unmodified.
- Ousia-structured/project-filled files are merged by stable sections and preserve project content.
- Project-owned files are routed and validated but not rewritten by default.
- Local overrides are never overwritten silently and must carry an exit condition.

The central rule is: Ousia Workflow owns structure, lifecycle, validation, and reading protocol; projects own facts inside the installed `.ousia/**` adapter instance.
