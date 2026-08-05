# Changelog

## 2026.8.5 - 2026-08-05

### Other

- Declare renderer ownership so the host enforces scoping the package only applied at runtime ([pm-starter-nf9u](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-nf9u.toon))

## 2026.8.4 - 2026-08-04

### Other

- Resolve pm-changelog to the release that derives release dates in UTC ([pm-starter-9fbt](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-9fbt.toon))

## 2026.7.31 - 2026-07-31

### Fixed

- Release commits discard the rebuilt dist, so the git-install path serves the previous version ([pm-starter-sthp](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/issues/pm-starter-sthp.toon))

## 2026.7.29 - 2026-07-29

### Added

- Enforce a real coverage gate by running tests against TypeScript sources ([pm-starter-91fh](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/features/pm-starter-91fh.toon))

### Other

- Adopt pm-cli 2026.7.29 ([pm-starter-a28w](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-a28w.toon))

## 2026.7.28 - 2026-07-28

### Fixed

- Extension reports a stale runtime version after the 2026.7.27 bump ([pm-starter-1atg](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/issues/pm-starter-1atg.toon))

### Other

- Adopt pm-cli 2026.7.28 ([pm-starter-evym](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-evym.toon))

## 2026.7.27 - 2026-07-27

### Removed

- Adopt pm-cli 2026.7.26 typed authoring contracts and remove the any-cast defineExtension shim ([pm-starter-fafo](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-fafo.toon))

## 2026.7.26 - 2026-07-26

### Fixed

- Starter template used any throughout, hiding three wrong SDK contracts and three unguarded pm reads ([pm-starter-kre3](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/issues/pm-starter-kre3.toon))

### Other

- Enable governance duplicate-detection advisory mode and adopt pm-cli 2026.7.25 ([pm-starter-tfh8](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-tfh8.toon))

## 2026.7.25 - 2026-07-25

### Fixed

- pm item reads are capped at Node's 1 MiB spawnSync default, so a mature tracker fails with no diagnosis ([pm-starter-y8hb](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/issues/pm-starter-y8hb.toon))

### Other

- Adopt --respect-item-release in changelog scripts and bump pm-changelog to 2026.7.24 ([pm-starter-toz4](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-toz4.toon))

## 2026.7.23 - 2026-07-23

### Fixed

- Recommend pm merge reconcile (2026.7.22) over raw history-repair in Multi-agent merge safety docs ([pm-starter-ll3f](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/issues/pm-starter-ll3f.toon))

### Other

- Adopt pm field-aware merge driver for multi-agent branch-merge safety ([pm-starter-ey52](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-ey52.toon))

## 2026.7.19 - 2026-07-19

### Added

- Hands-on functional test pass 2026-05-29 (real data) ([pm-starter-yly8](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/features/pm-starter-yly8.toon))

### Other

- Harden release bun-verify so registry-mirror lag cannot block the GitHub release ([pm-starter-p9ez](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-p9ez.toon))

## 2026.7.10 - 2026-07-10

### Other

- Ecosystem release readiness pass 2026-07-06 ([pm-starter-rcbt](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-rcbt.toon))

## 2026.7.6 - 2026-07-06

### Fixed

- Fix release CI ordering (publish-before-tag) ([pm-starter-3hxr](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-3hxr.toon))

### Other

- Align Node engine with pm CLI runtime ([pm-starter-z28y](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-z28y.toon))
- Regenerate CHANGELOG after pm close item ([pm-starter-4mkx](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-4mkx.toon))

## 2026.6.13 - 2026-06-13

### Other

- Daily Release publish step runs prepublishOnly post-tag: align npm publish with --ignore-scripts ([pm-starter-5wig](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-5wig.toon))

## 2026.6.8 - 2026-06-08

### Other

- Full-cycle hardening wave: pm-starter ([pm-starter-se0g](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-se0g.toon))

## 2026.6.7 - 2026-06-07

### Other

- Harden release readiness checks ([pm-starter-q3m0](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-q3m0.toon))
- Strengthen starter SDK capability smoke coverage ([pm-starter-u0c7](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-u0c7.toon))
- Align package dependencies to pm CLI/SDK 2026.6.6 ([pm-starter-u1tx](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-u1tx.toon))

## 2026.6.4 - 2026-06-04

### Fixed

- Fix README to document all 9 capabilities accurately + strengthen smoke test ([pm-starter-xwkh](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/chores/pm-starter-xwkh.toon))

## 2026.6.2 - 2026-06-02

### Added

- Make pm-starter the canonical full ExtensionApi reference ([pm-starter-oi1i](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/features/pm-starter-oi1i.toon))

## 2026.5.30 - 2026-05-30

### Other

- Production-readiness audit 2026-05-28 ([pm-starter-rmnj](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-rmnj.toon))

## 2026.5.28 - 2026-05-28

### Added

- Add publish retry + provenance fallback to release workflow ([pm-starter-vcxr](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-vcxr.toon))

## 2026.5.27 - 2026-05-27

### Added

- Add bun-install verification to release workflow ([pm-starter-zai7](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-zai7.toon))

## 2026.5.26 - 2026-05-26

### Fixed

- ci: fix release workflow step ordering ([pm-starter-6i6j](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-6i6j.toon))

### Other

- Release readiness hardening for pm-starter ([pm-starter-d7yd](https://github.com/unbraind/pm-starter/blob/main/.agents/pm/tasks/pm-starter-d7yd.toon))
