# MINDSPACE design system (Phase 1)

Source of truth: `src/renderer/src/design-system/tokens.css` (Tailwind v4 `@theme`).
Tailwind's default palette is disabled (`--color-*: initial`), so only these tokens exist as utilities.

- **Surfaces**: canvas `#121214`, sidebar `#17171a`, surface `#1a1a1e`, raised `#212126`, hover `#26262c`, active `#2d2d34`.
- **Text**: fg `#ede9e3` (warm off-white), fg-muted, fg-subtle. All text tokens are >= 4.5:1 on every surface (`tests/unit/contrast.test.ts`).
- **Accent**: muted amber `#d3a157`; `accent-text` for amber text on dark surfaces.
- **Status** (success/info/warning/danger) is used only where it carries meaning (due dates, priority, status badges).
- **Type**: Inter Variable + Vazirmatn Variable (both SIL OFL, bundled locally, no CDN). Scale 11-28px.
- **Spacing** 4px step; **radii** 4-12px; **shadows** subtle, no glow; **motion** 120/180/260ms, one ease-out curve, spring only for shared indicators (`design-system/motion.tsx`, Motion for React). Opacity/transform only. "Reduce motion" and `prefers-reduced-motion` remove movement everywhere.
- **RTL**: logical properties (`ms-`, `ps-`, `start-`, `end-`); `dir="auto"` on user content; `.flip-rtl` for directional icons.
- **Components** (`design-system/components`): Button, IconButton, Field/Input/Textarea, Select, Segmented, Switch, TaskCheck, Dialog, Drawer, Menu, Popover, Tooltip, Toast, Badge, Tag, Panel, EmptyState, ErrorState, Skeleton, ProgressBar, Kbd, Notice. Radix primitives give keyboard and ARIA behaviour; visuals are custom.

## Phase 3 additions
`Tabs`/`TabPanel` (section tabs with an amber underline). Feature-level patterns reused across screens: `RelatedContent`/`RelatedList` (linked records with type icon, title, metadata, optional unlink), `DecisionStatusBadge` + `DecisionStatusGuide` (tones: proposed info, accepted success, rejected danger, superseded neutral), `LinkPickerDialog`, `TagEditor`, `ActivityTimeline`, `ConfirmDialog`. No new colours or tokens.
