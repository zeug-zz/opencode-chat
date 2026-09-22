# vibefeld-af-activation Specification

## Purpose
Provide bounded, host-owned AF executable discovery and explicit-path resolution so
Vibefeld activation can remain deterministic, side-effect free, and fail closed.

## Requirements

### Requirement: Discover the host-owned AF executable across system and home install roots

AF discovery SHALL consider the approved system roots
(`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`) followed by the
home-relative install roots (`~/go/bin`, `~/bin`, `~/.local/bin`) and then the
host `PATH` entries, deduplicated in that order. Every candidate SHALL continue
to require host-uid ownership, regular-file status, and executable access. A
second distinct valid candidate SHALL still resolve unavailable with the
`ambiguous` reason, and every existing bounded reason SHALL remain unchanged.
Discovery SHALL NOT spawn a process, read a model- or webview-supplied value,
mutate `PATH`, or write configuration.

#### Scenario: AF is installed only in a home root

- **WHEN** a supported host has no `af` in the system roots or host `PATH`, but
  has a host-owned executable `af` under `~/go/bin`
- **THEN** discovery SHALL resolve the home-root executable
- **AND** the runtime resolution SHALL be able to reach the ready state with the
  same bounded contract as a system-root install

#### Scenario: A home candidate is not host-owned or not executable

- **WHEN** the only home-root candidate exists but is not owned by the host uid
  or lacks executable access
- **THEN** discovery SHALL keep the existing bounded unavailable reason
  (`not-owned` or `not-executable`)
- **AND** no other fallback path SHALL be attempted

#### Scenario: Two distinct installs exist

- **WHEN** two distinct valid `af` candidates are found across the approved
  roots
- **THEN** discovery SHALL resolve unavailable with `ambiguous`
- **AND** the runtime SHALL stay dormant unless an explicit executable path is
  configured

### Requirement: Accept an explicit host-owned AF executable path

The host SHALL read an optional `opencode-chat.vibefeld.afPath` setting once
during activation. When set, the value SHALL be accepted only if it is an
absolute path to a host-uid-owned, executable regular file; a valid value SHALL
be used as the resolved executable without consulting other candidates. An
invalid value SHALL resolve dormant with the bounded `missing-af` reason and
SHALL NOT fall back to discovery. An unset or blank value SHALL leave discovery
behavior unchanged. The setting SHALL never be read from a model, prompt,
plugin, MCP server, webview message, or child result.

#### Scenario: A valid explicit path is configured

- **WHEN** `vibefeld.afPath` names an absolute, host-owned, executable `af`
- **THEN** the runtime resolution SHALL use exactly that executable
- **AND** ambiguity with other installs SHALL not apply

#### Scenario: The explicit path is invalid

- **WHEN** the setting is relative, missing, not host-owned, not a regular file,
  or not executable
- **THEN** the resolution SHALL stay dormant with `missing-af`
- **AND** no discovery fallback, process launch, or configuration write SHALL
  occur

### Requirement: Keep activation bounded and side-effect free

Reading the setting and resolving the runtime SHALL remain a single bounded
activation step. Status reads SHALL NOT re-resolve, re-probe, or read the
setting again. No configuration or workspace file SHALL be written, and every
dormant and failure reason SHALL stay within the existing bounded vocabulary.

#### Scenario: Activation runs on a host without AF

- **WHEN** the extension activates on a host with no valid AF candidate
- **AND** no explicit path is configured
- **THEN** the runtime SHALL stay dormant with the existing bounded reason
- **AND** no process, workspace allocation, or configuration write SHALL occur

#### Scenario: A status read happens after activation

- **WHEN** any status read occurs after the single activation resolution
- **THEN** it SHALL NOT re-run discovery, re-read the setting, or touch the
  filesystem
