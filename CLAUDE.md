# Day-app constraints

This is one app in a 100-apps-in-100-days challenge. Keep every build fast and shippable.

## Hard constraints
- **One core feature.** Build exactly what the idea's one-line scope says, nothing more. No login, no backend, no payments.
- **No server.** Persistence, if needed, is `localStorage` only.
- **APIs** (if the idea uses one): only free, keyless public APIs. Never ask the user for an API key mid-build.
- **Single page.** One route, one screen. Mobile-responsive via Tailwind (it's already wired up).
- **Stack is fixed**: React + TypeScript + Vite + Tailwind, already scaffolded in `src/App.tsx`. Don't add component libraries, routers, or state-management packages — plain React state/hooks is enough for apps this size.
- **Finish in one sitting.** If the idea is trailing on past ~2-3 hours of iteration, cut scope rather than extend time.

## Definition of done
1. `npm run dev` shows a working app with the one core feature functioning end to end.
2. `npm run build` succeeds with no TypeScript errors.
3. Update the page `<title>` in `index.html` and the heading in `App.tsx` to the actual app name.
4. Update this folder's `README.md` with a one-line description (used later by the Day 100 capstone portfolio).

## Explicitly out of scope unless the idea says otherwise
Accounts/auth, databases, real-time multiplayer, animations beyond what's needed to show the core interaction, settings/preferences screens, onboarding flows.
