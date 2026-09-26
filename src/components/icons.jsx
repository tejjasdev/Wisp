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
export const FullscreenIcon = ({ on }) => (
  <Svg>{on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</Svg>
);
export const PipIcon = () => (
  <Svg><rect x="3" y="5" width="18" height="14" rx="1.5" /><rect x="12" y="11.5" width="7" height="5" rx="1" fill="currentColor" stroke="none" /></Svg>
);
export const StatsIcon = () => (
  <Svg><path d="M4 19V11M9.33 19V5M14.67 19v-6M20 19V8" /></Svg>
);
export const GridIcon = () => (
  <Svg><rect x="3.5" y="4.5" width="7.5" height="6.5" rx="1" /><rect x="13" y="4.5" width="7.5" height="6.5" rx="1" /><rect x="3.5" y="13" width="7.5" height="6.5" rx="1" /><rect x="13" y="13" width="7.5" height="6.5" rx="1" /></Svg>
);
export const CameraIcon = () => (
  <Svg><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z" /><circle cx="12" cy="13.2" r="3.2" /></Svg>
);
export const ZenIcon = () => (
  <Svg><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.5" /></Svg>
);
export const CloseIcon = ({ size }) => (
  <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);
export const PlusIcon = () => (
  <Svg><path d="M12 5v14M5 12h14" /></Svg>
);
export const GearIcon = () => (
  <Svg><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Svg>
);
export const GuideIcon = () => (
  <Svg><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M3.5 9h17M9 9v10.5" /></Svg>
);
