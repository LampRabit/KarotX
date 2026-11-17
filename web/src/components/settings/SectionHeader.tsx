export function SectionHeader({ title, text }: { title: string; text: string }) {
  return (
    <header className="mb-6">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-muted-foreground">{text}</p>
    </header>
  )
}
