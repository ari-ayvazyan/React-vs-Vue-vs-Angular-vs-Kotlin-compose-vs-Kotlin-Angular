import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(path: ReactNode, displayName: string) {
  function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {path}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

export const IconDashboard = make(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>,
  'IconDashboard',
);
export const IconList = make(
  <>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
  </>,
  'IconList',
);
export const IconBoard = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18" />
  </>,
  'IconBoard',
);
export const IconCalendar = make(
  <>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </>,
  'IconCalendar',
);
export const IconFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />, 'IconFolder');
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </>,
  'IconSettings',
);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
  'IconSearch',
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, 'IconPlus');
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </>,
  'IconSun',
);
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />, 'IconMoon');
export const IconMonitor = make(
  <>
    <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
    <path d="M8 21h8M12 16.5V21" />
  </>,
  'IconMonitor',
);
export const IconMenu = make(<path d="M4 6h16M4 12h16M4 18h16" />, 'IconMenu');
export const IconX = make(<path d="M18 6 6 18M6 6l12 12" />, 'IconX');
export const IconChevronLeft = make(<path d="m15 18-6-6 6-6" />, 'IconChevronLeft');
export const IconChevronRight = make(<path d="m9 18 6-6-6-6" />, 'IconChevronRight');
export const IconUndo = make(
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
  'IconUndo',
);
export const IconRedo = make(
  <>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </>,
  'IconRedo',
);
export const IconCheck = make(<path d="M20 6 9 17l-5-5" />, 'IconCheck');
export const IconTrash = make(
  <>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </>,
  'IconTrash',
);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
  'IconClock',
);
export const IconPlay = make(<path d="M7 4.5v15l12-7.5Z" fill="currentColor" />, 'IconPlay');
export const IconPause = make(<path d="M8 5v14M16 5v14" strokeWidth={3} />, 'IconPause');
export const IconReset = make(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </>,
  'IconReset',
);
export const IconFlame = make(
  <path d="M12 2c1 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-9Z" />,
  'IconFlame',
);
export const IconAlert = make(
  <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
  'IconAlert',
);
export const IconKeyboard = make(
  <>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </>,
  'IconKeyboard',
);
export const IconSidebar = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </>,
  'IconSidebar',
);
export const IconGrip = make(
  <>
    <circle cx="9" cy="6" r="1" fill="currentColor" />
    <circle cx="15" cy="6" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="18" r="1" fill="currentColor" />
    <circle cx="15" cy="18" r="1" fill="currentColor" />
  </>,
  'IconGrip',
);
export const IconDownload = make(<path d="M12 3v12M7 10l5 5 5-5M4 21h16" />, 'IconDownload');
export const IconUpload = make(<path d="M12 21V9M7 14l5-5 5 5M4 3h16" />, 'IconUpload');
export const IconPencil = make(<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />, 'IconPencil');
export const IconLogo = make(
  <>
    <path d="M4 12.5 9.5 18 20 6" strokeWidth={2.6} />
  </>,
  'IconLogo',
);
export const IconRepeat = make(
  <>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </>,
  'IconRepeat',
);
export const IconUsers = make(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </>,
  'IconUsers',
);
export const IconLock = make(
  <>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </>,
  'IconLock',
);
export const IconActivity = make(<path d="M3 12h4l3-8 4 16 3-8h4" />, 'IconActivity');
export const IconMessage = make(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />, 'IconMessage');
export const IconBookmark = make(<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z" />, 'IconBookmark');
export const IconTimeline = make(
  <>
    <path d="M3 4v16h18" />
    <path d="M7 8h7M10 12h8M7 16h5" strokeWidth={2.6} />
  </>,
  'IconTimeline',
);
export const IconBell = make(
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>,
  'IconBell',
);
export const IconUserPlus = make(
  <>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" />
  </>,
  'IconUserPlus',
);
export const IconAt = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </>,
  'IconAt',
);
export const IconUnlock = make(
  <>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 7.7-1.5" />
  </>,
  'IconUnlock',
);
export const IconChart = make(
  <>
    <path d="M3 3v18h18" />
    <path d="M8 16v-4M12 16V8M16 16v-6M20 16V5" />
  </>,
  'IconChart',
);
