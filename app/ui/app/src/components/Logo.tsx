export default function Logo() {
  return (
    <div className="flex mb-8 justify-center select-none">
      <svg
        width="64"
        height="64"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="select-none"
      >
        <circle cx="50" cy="50" r="48" className="fill-neutral-100 dark:fill-neutral-800" />

        <g className="fill-neutral-900 dark:fill-neutral-100">
          {/* Body — realistic dromedary profile */}
          <path d="M 25 36 C 22 34, 19 31, 18 28 C 17 25, 18 22, 20 20 C 21 18, 22 17, 23 16 C 25 14, 27 13, 29 13 Q 28 8, 31 12 C 32 14, 33 18, 33 22 C 33 30, 34 38, 37 44 C 39 50, 43 56, 51 56 C 55 52, 59 42, 62 34 C 64 30, 66 26, 68 25 C 70 24, 72 25, 73 27 C 75 30, 76 36, 77 42 C 78 50, 78 56, 76 60 L 76 62 L 35 62 C 33 58, 30 50, 27 42 C 26 40, 25 38, 25 36 Z" />

          {/* Legs */}
          <rect x="37" y="62" width="4" height="22" rx="2" />
          <rect x="44" y="62" width="4" height="22" rx="2" />
          <rect x="64" y="62" width="4" height="22" rx="2" />
          <rect x="71" y="62" width="4" height="22" rx="2" />
        </g>

        {/* Tail */}
        <path
          d="M 77 48 Q 83 42 81 36"
          className="stroke-neutral-900 dark:stroke-neutral-100"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />

        {/* Eye */}
        <circle cx="26" cy="18" r="1.5" className="fill-neutral-100 dark:fill-neutral-800" />
      </svg>
    </div>
  );
}
