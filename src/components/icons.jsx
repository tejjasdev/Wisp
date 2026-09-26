// Small inline SVG icons (no icon font, no extra requests).

const Svg = ({ children, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const StarIcon = ({ filled }) => (
  <Svg>
    <path fill={filled ? 'currentColor' : 'none'}
      d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />
  </Svg>
);
export const PlayIcon = ({ size }) => (
  <Svg size={size}><path fill="currentColor" stroke="none" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></Svg>
);
export const PauseIcon = ({ size }) => (
  <Svg size={size}><path d="M8.5 5v14M15.5 5v14" stroke-width="3" /></Svg>
);
export const ShareIcon = () => (
  <Svg><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></Svg>
);
export const VolumeIcon = ({ muted }) => (
  <Svg>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
  </Svg>
);
export const SearchIcon = () => (
  <Svg size={18}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></Svg>
);
export const RetryIcon = () => (
  <Svg size={18}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" /></Svg>
);
