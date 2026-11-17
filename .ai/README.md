# .ai — shared context for humans and AI agents

Read these before changing anything. Keep them current when you change direction.

| File | What it holds |
|------|---------------|
| [context.md](context.md) | What KarotX is, who it's for, requirements |
| [architecture.md](architecture.md) | How the system is built, folder layout, key interfaces |
| [decisions.md](decisions.md) | Decision log (why things are the way they are) |
| [roadmap.md](roadmap.md) | Phases and what's in each |
| [progress.md](progress.md) | What's done, what's in flight, open questions |

## Working rules

1. **Ask when unsure.** Don't guess on product decisions.
2. **Minimal, effective code.** Only write what's needed now. Before a large change, check that it is actually worth it.
3. **Design for humans.** Every UI change must be clear, accessible (WCAG AA contrast, keyboard navigable, visible focus) and easy for a beginner.
4. **No AI attribution** in commits or PRs: no `Co-Authored-By` AI lines and no "Generated with" footers. Commits use the owner's GitHub identity.
5. Update `progress.md` at the end of each meaningful piece of work. Add an entry to `decisions.md` when you make a non-obvious choice.
