## 1. Companion server configuration

- [x] 1.1 Start `OpenCodeAgent` with the SDK's typed in-memory Scout overlay (`mode: all`, read-only permission profile, no model), and add focused agent tests asserting the exact child-server config and no user-config persistence path.

## 2. Primary-agent selection contract

- [x] 2.1 Restore Scout initialization to accept only server-reported `primary` or `all` Scout, remove the incorrect pending `subagent` promotion behavior and coverage, and retain Scout-as-chat plus Build fallback scenarios.

## 3. Focused verification

- [x] 3.1 Add or update focused extension/scenario coverage proving a companion-provided `scout (all)` becomes `chat`, sends the GUI-selected model/effort at prompt level, and leaves independent user configuration untouched.