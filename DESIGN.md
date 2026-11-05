# HSW design system

Taken from the HSW Quote & Invoice Builder. Every screen in HSW Orders must look and behave like that app. `src/styles.css`, `src/tokens.css` and `src/base.css` are the source of truth: reuse their classes and tokens, never restyle from scratch.

## Look
- Warm paper background, near-black ink and hairline rules, with HSW teal (`--color-accent`) as the one brand colour. Teal is always a fill with dark ink on it; `--color-link` is the deepened teal for text.
- Myriad Pro (Adobe Fonts kit in `VITE_ADOBE_FONTS_KIT`), with Source Sans 3 as the stand-in. Light (300) for reading, Semibold (600) for labels, buttons and section heads, Regular (400) for what people type. Numbers use tabular figures (`.num`, `td.r`).
- Small radii (`--radius-pill` 6px on controls, `--radius-card` 10px on cards). Flat, ruled, quiet: no gradients, no heavy shadows except modals (`--shadow-lift`).
- Sentence case everywhere. Plain Australian English. Labels are body text one size down, never uppercase or letter-spaced.

## Tokens (in `src/tokens.css`, the only place colours, fonts, spacing and radii are declared)
Use `var(--space-*)`, `var(--text-*)`, `var(--color-*)`, `var(--radius-*)`, `var(--dur-*)`, `var(--control)` (40px) and `var(--hit)` (44px). No literal colours, font families or pixel spacing in components.

## Layout and patterns (copy the classes from `styles.css`)
- **Shell:** sticky `.topbar` with the logo, segmented `.tab` navigation, `.who` on the right. Page content in `.page` with a `.pagehead` (title left, `.actions` right).
- **Forms:** `label` wrapping an `input`, with a `<small>` hint beside the label text; fields in `.grid`; one primary `.btn.primary` per screen, secondary `.btn`, destructive `.btn.danger`. Search and filters sit in `.filters` with a `.segmented` control for few-option filters.
- **Lists:** `.tablewrap > table.book` with a modifier (`docs`, `reports`, `stores`). Every `td` has `data-label`; on phones each row becomes a card of separate cells on a hairline grid, so a new table needs the matching phone rules added to the mobile block.
- **Status:** `.chip` (`part_paid`, `paid`, `overdue`, `quote` variants). Wording is plain: "Deposit received", "Paid in full".
- **Popups:** `.modal > .modalbox` with an X (`.modal-x`), Escape closes, focus goes to the first field. Use `Confirm.tsx` (`useConfirm`) for any "are you sure", never `window.confirm` or `alert`. Use `Toast.tsx` for success and error messages.
- **States:** every data screen has loading (`.skeleton`), empty (`.state`), error (`.state.error` with "Try again") and full states.
- **Phone first:** no horizontal scroll at 390px; tap targets 44px; hover styles only under `@media (hover: hover)`.
- **Motion:** only transform and opacity, short durations from the tokens, never `transition: all`, always a `prefers-reduced-motion` fallback.
- **Accessibility:** visible `:focus-visible` on everything interactive, labels on every input, `role="dialog"` and `aria-modal` on popups.

## What to copy from the Quote app
`reference-from-quote-app/` holds the Quote app's `App.tsx` (shell, tabs, roles), `Login.tsx`, `Documents.tsx` (list and filters), `PaymentDialog.tsx` (a modal form), `StorePanel.tsx` (a management popup), `Reports.tsx`, `Tour.tsx` and `supabase.ts` (types, demo data). They are there to match the patterns, not to be reused for ordering logic.

## Sign-in and people (same as the Quote app unless told otherwise)
Supabase email and password. Admin is `george.mridun@hsw.com.au`. Everyone else belongs to one or more stores as Manager or Store, with identical access inside their store. Sign-in help line: "Unable to log in? Reach out to support@hsw.com.au". First-login tour shown once per account.
