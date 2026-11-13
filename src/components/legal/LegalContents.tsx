// "Contents" box for the legal pages: anchor links to each numbered section.
// Server component. The ids must match the <h2 id> values on the page.
export function LegalContents({ sections }: { sections: readonly (readonly [id: string, title: string])[] }) {
  return (
    <nav aria-label="Contents" className="mt-8 rounded-2xl border border-border bg-surface px-5 py-4">
      <p className="mb-2 text-[14px] font-semibold text-trust-navy">Contents</p>
      <ol className="list-decimal gap-x-8 pl-6 text-[14.5px] text-text-secondary sm:columns-2">
        {sections.map(([id, title]) => (
          <li key={id} className="mb-1 break-inside-avoid">
            <a href={`#${id}`} className="transition-colors hover:text-[color:var(--lp-teal-700)]">
              {title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
