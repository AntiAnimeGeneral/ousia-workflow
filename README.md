# Ousia Workflow

Ousia Workflow is a framework for installing and evolving agent-facing development workflows. It owns the structure, lifecycle, validation rules, and agent reading protocol; projects fill facts inside Ousia-defined slots.

## Model

| Layer            | Owner              | Role                                                                                                                          |
| ---------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Framework core   | Ousia Workflow     | Base instructions, facade skills, shared task modes, validation contracts, and upgrade policy.                                |
| Project profile  | Ousia Workflow     | Ousia-controlled skeleton for a class of projects. A profile defines which `.ousia/**` slots exist and how agents read them.  |
| Adapter instance | Project            | Installed `.ousia/**` surface containing project facts, design conclusions, validation commands, references, and constraints. |
| Local override   | Project, temporary | Explicit deviations from the framework or profile. Overrides must name the rule they cover and their exit condition.          |

Profile and adapter are one responsibility line: a profile is the Ousia-defined skeleton, and `.ousia/**` is its installed adapter instance in a project. It is not a freeform plugin system.

There is only one Ousia project directory: `.ousia/**`. Profile definitions, installed project facts, design evidence, pending work, and overrides all live under that tree so profile and adapter cannot drift into parallel concepts.

## Repository Layout

| Path                                                      | Role                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.github/instructions/ousia-*.instructions.md`            | Active framework instructions for agents working in this repository.                                                               |
| `.github/instructions/ext-ousia-workflow.instructions.md` | Active repository policy for this workflow project profile.                                                                        |
| `.github/skills/**`                                       | Active framework skills and shared mode components.                                                                                |
| `.ousia/workflow.json`                                    | Manifest for ownership, profile, and upgrade policy.                                                                               |
| `.ousia/design/**`                                        | Installed adapter instance for this workflow project; this repository fills the Ousia-defined slots.                               |
| `.ousia/profiles/ext-ousia-os/**`                         | Preserved Ousia OS profile definition. It is not active workflow core.                                                            |
| `.ousia/profiles/ext-ousia-workflow/**`                   | Ousia Workflow self rules: release, migration, dogfood, fixture, schema, and upgrade rules.                                       |
| `fixtures/**`                                             | Future smoke fixtures for install and upgrade behavior.                                                                            |

## Upgrade Boundary

- Ousia-owned files can be replaced by upgrade tooling when unmodified.
- Ousia-structured/project-filled files are merged by stable sections and preserve project content.
- Profile definitions live under `.ousia/profiles/**` and are upgraded by profile version, not by a parallel adapter directory.
- Project-owned files are routed and validated but not rewritten by default.
- Local overrides are never overwritten silently and must carry an exit condition.

The central rule is: Ousia Workflow owns structure, lifecycle, validation, and reading protocol; projects own facts inside the installed `.ousia/**` adapter instance.
