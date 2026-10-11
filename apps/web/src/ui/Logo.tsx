import { useId } from 'react';

// The arrow of the logo: the F's middle arm, extended through the N.
export const ARROW_PATH = 'M8,50 H102 V38 L120,56 L102,74 V62 H8 Z';

// The NF mark (viewBox 128x100): the N in the text color, the F and its arrow in the brand navy.
export function LogoMark({ className = 'h-7 w-auto' }: { className?: string }) {
  // The gap where the arrow crosses the N is a mask, so it works on any background.
  const mask = `nf-gap-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 128 100" className={className} aria-hidden="true">
      <defs>
        <mask id={mask}>
          <rect width="128" height="100" fill="white" />
          <path d={ARROW_PATH} fill="black" stroke="black" strokeWidth="6" />
        </mask>
      </defs>
      <g className="fill-fg" mask={`url(#${mask})`}>
        <rect x="8" y="12" width="16" height="76" />
        <polygon points="8,12 25,12 76,88 59,88" />
      </g>
      <g className="fill-brand">
        <rect x="60" y="12" width="16" height="76" />
        <rect x="60" y="12" width="56" height="16" />
        <path d={ARROW_PATH} />
      </g>
    </svg>
  );
}

export function Logo({ markClassName }: { markClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-display text-lg font-semibold text-fg">
      <LogoMark {...(markClassName ? { className: markClassName } : {})} />
      NotaFlow
    </span>
  );
}
