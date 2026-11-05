# HSW Orders

An ordering app for Howards Storage World stores. It must look and feel exactly like the HSW Quote & Invoice Builder (the sibling folder `../HSW_QUOTE`), but its logic is different: ordering, not quoting.

## Rules that never change
1. Read `DESIGN.md` before building or changing any screen, and follow it.
2. `src/tokens.css`, `src/base.css` and `src/styles.css` are the design system. Reuse their classes and tokens. Add new rules to `styles.css` in the same style (tokens only, no literal colours or fonts, no `transition: all`, only animate transform and opacity, a reduced-motion fallback, `:focus-visible` on everything interactive).
3. Never invent a new colour, font, radius, button style or popup style. If something genuinely new is needed, build it from the existing tokens and tell the user what you added.
4. Use `Confirm.tsx` for confirmations and `Toast.tsx` for messages. Never `window.confirm` or `alert`.
5. When unsure how something should look, open the matching file in `reference-from-quote-app/` or the same screen in `../HSW_QUOTE/src` and match it.
6. Check every screen at phone width (390px) with no horizontal scroll, and run `npm run build` and `npm test` before finishing.
7. Hallmark rules apply (`.claude/skills/hallmark`): for an existing design, work inside this project's own system; never redesign.

## Stack
Vite, React 18, TypeScript, Supabase (auth, Postgres with Row Level Security, edge functions, Realtime), Vercel. Same conventions as the Quote app: migrations in `supabase/migrations`, edge functions in `supabase/functions`, GitHub Actions to deploy Supabase.
