# Phase 0 — Global Feedback Panel

## Decision
Use one global feedback entry point in the dashboard instead of adding comment controls to every tab, card, button, or block. This keeps Phase 0 smaller and leaves room for precise per-block comments later if they prove useful.

## User workflow
1. Open the global **Feedback** panel from the dashboard header.
2. Enter feedback by typing or dictate it with browser speech recognition where supported.
3. The user can describe locations naturally, e.g. "Sites & Stacks tab, filter button" or "Overview, second statistics card".
4. Add multiple feedback notes in one session.
5. Review the collected notes and use **Copy all feedback** to copy one consolidated prompt.
6. The exported prompt includes the note, any named tab/section/control, and priority if supplied. If the location is unclear, preserve the user's wording rather than inventing a target.

## Suggested exported format
Please apply the following feedback to the Phase 0 dashboard:

1. Location: [tab / section / control named by user]
   Feedback: [user's exact note]
   Priority: [optional]

## UI requirements
- A single persistent Feedback button in the dashboard header.
- One modal/drawer with a text area, voice-dictation control, Add note, collected-notes list, remove-note control, and Copy all feedback.
- Clearly show when voice dictation is unsupported or permission is denied; typing must always remain available.
- No per-block comment icons in Phase 0.
- Keep notes in browser localStorage so they survive refreshes on the same browser. Do not claim cross-device sync or database persistence unless implemented.
- Responsive and keyboard accessible; use visible labels and focus states.
- Do not deploy from this branch or merge to main as part of this Phase 0 task.

## Acceptance checks
- Feedback can be added by typing.
- Dictation works where browser Web Speech API is available, with a graceful fallback otherwise.
- Multiple notes can be collected, removed, and copied together.
- Export preserves the user's wording and location references.
- Notes survive page refresh in the same browser.
- Build succeeds and no critical console errors are present.
