import {partId} from './drawing.mjs';

export function scroll({id: name}) {
  const id = partId(name);
  return `<g id="${id}">
    <defs>
      <linearGradient id="${id}-parchment" x2="0" y2="1" gradientUnits="objectBoundingBox">
        <stop stop-color="#f9eed8"/>
        <stop offset=".72" stop-color="#efdfbe"/>
        <stop offset="1" stop-color="#e4cca5"/>
      </linearGradient>
      <linearGradient id="${id}-wood" x2="1" y2="0" gradientUnits="objectBoundingBox">
        <stop stop-color="#543c32"/>
        <stop offset=".3" stop-color="#a77959"/>
        <stop offset=".48" stop-color="#bb8e68"/>
        <stop offset=".77" stop-color="#815f49"/>
        <stop offset="1" stop-color="#523c32"/>
      </linearGradient>
      <pattern id="${id}-paper-fibers" width="41" height="27" patternUnits="userSpaceOnUse">
        <path d="M4 5l5-1m13 12l8-1m-21 8h3m23-17 4 1" fill="none" stroke="#826948" stroke-width=".65" opacity=".19"/>
      </pattern>
      <path id="${id}-scroll-surface" d="M25 23Q148 17 282 24v159q-117 12-257 3Z"/>
    </defs>
    <path d="M13 185q109-5 290 1l12 12q-142 15-302 7Z" fill="#4f4439" opacity=".11"/>
    <g id="${id}-scroll-paper">
      <path d="M26 176q133 9 258-5l-2 17q-120 11-257 3Z" fill="#c2a883" stroke="#8a745c" stroke-width="1"/>
      <use href="#${id}-scroll-surface" fill="url(#${id}-parchment)" stroke="#92795f" stroke-width="1.25"/>
      <use href="#${id}-scroll-surface" fill="url(#${id}-paper-fibers)"/>
      <path d="M30 31q128-5 244 1M31 178q123 7 244-3" fill="none" stroke="#fff6df" stroke-width="1.4" opacity=".85"/>
      <path d="M48 27q6 78-1 157m212-158q-5 83 1 151" fill="none" stroke="#a38259" stroke-width="6" opacity=".13"/>
    </g>
    <g id="${id}-scroll-left-roller">
      <rect x="16" y="7" width="23" height="195" rx="6" fill="url(#${id}-wood)" stroke="#61493c" stroke-width="1.4"/>
      <path d="M23 20v167m8-152v133" fill="none" stroke="#ecc7a0" stroke-width="1" opacity=".37"/>
      <ellipse cx="27.5" cy="9" rx="14" ry="5.5" fill="#ab825f" stroke="#62473a" stroke-width="1.4"/>
      <ellipse cx="27.5" cy="9" rx="8" ry="2.9" fill="none" stroke="#6d5040" stroke-width=".8"/>
      <path d="M15 193q12 6 25-1v7q-13 7-25 0Z" fill="#6e503e" stroke="#573f34" stroke-width="1"/>
    </g>
    <g id="${id}-scroll-right-roller">
      <rect x="269" y="8" width="27" height="190" rx="7" fill="url(#${id}-wood)" stroke="#61493c" stroke-width="1.4"/>
      <path d="M278 22v165m10-159v131" fill="none" stroke="#ecc7a0" stroke-width="1" opacity=".4"/>
      <ellipse cx="282.5" cy="9" rx="15" ry="6" fill="#ad8563" stroke="#62473a" stroke-width="1.4"/>
      <ellipse cx="282.5" cy="9" rx="9" ry="3" fill="none" stroke="#715241" stroke-width=".85"/>
      <path d="M267 189q15 7 31-2v8q-16 8-31 1Z" fill="#6e503e" stroke="#573f34" stroke-width="1"/>
    </g>
  </g>`;
}

export function documentSheet({id: name, impression = false}) {
  const id = partId(name);
  return `<g id="${id}">
    <defs>
      <pattern id="${id}-paper-fibers" width="41" height="27" patternUnits="userSpaceOnUse">
        <path d="M4 5l5-1m13 12l8-1m-21 8h3m23-17 4 1" fill="none" stroke="#826948" stroke-width=".65" opacity=".19"/>
      </pattern>
      <path id="${id}-sheet-surface" d="M31 16l207-7 19 19 6 161q-103 15-230 13Z"/>
    </defs>
    <path d="M20 169l244-12 15 38q-134 21-260 19Z" fill="#4f4439" opacity=".12"/>
    <g id="${id}-document-underlay">
      <path d="M26 26l222-9 14 169-225 23Z" fill="#c5b299" stroke="#94826e"/>
      <path d="M21 24l223-8 12 174-222 14Z" fill="#e9dcc4" stroke="#a2917a"/>
      <path d="M38 204l206-13" stroke="#f5e9d1" stroke-width="1.2"/>
    </g>
    <g id="${id}-document-top">
      <use href="#${id}-sheet-surface" fill="#f8efd9" stroke="#9b896c" stroke-width="1.2"/>
      <use href="#${id}-sheet-surface" fill="url(#${id}-paper-fibers)" opacity=".75"/>
      <path d="M238 9l19 19-16 2Z" fill="#dbcaad" stroke="#a18b6b"/>
      <path d="M38 193q131 0 213-11" fill="none" stroke="#fff8e8" stroke-width="1.35"/>
    </g>
    <g id="${id}-document-impression" opacity="${impression ? 1 : 0}" transform="translate(222 165) rotate(-7)">
      <rect x="-11" y="-11" width="22" height="22" rx="1" fill="#a05f51" opacity=".72"/>
      <path d="M-7-7H7V7H-7Z" fill="none" stroke="#f4dfca" stroke-width="1" opacity=".9"/>
    </g>
  </g>`;
}

export function readingPanel({id: name}) {
  const id = partId(name);
  return `<g id="${id}">
    <rect x="5" y="7" width="293" height="137" rx="4" fill="#514b40" opacity=".1"/>
    <rect x="2" y="3" width="293" height="137" rx="4" fill="#d9d0ba" stroke="#b5aa92"/>
    <rect width="293" height="137" rx="4" fill="#f7f3e6" stroke="#a8a18d" stroke-width="1.2"/>
    <path d="M8 4h277" stroke="#fffdf5" stroke-width="1.4"/>
  </g>`;
}

export function woodenTag({id: name}) {
  const id = partId(name);
  return `<g id="${id}" stroke-linejoin="round">
    <path d="M14 37L30 22H250L267 37V118L249 134H28L14 117Z" transform="translate(2 6)" fill="#503a2e" opacity=".18"/>
    <g id="${id}-board">
      <path d="M14 37L30 22H250L267 37V118L249 134H28L14 117Z" fill="#9b6d4b" stroke="#624937" stroke-width="2.4"/>
      <path d="M19 37L33 26H247L261 38V109L248 122H33L19 109Z" fill="#d2aa7b" stroke="#8b6246" stroke-width="1.5"/>
      <path d="M35 44Q93 52 146 44T242 43M33 106Q108 113 166 105T246 107" fill="none" stroke="#836047" stroke-width="1.7" opacity=".52"/>
      <path d="M27 37L35 31H243M36 125H246" fill="none" stroke="#eed0a0" stroke-width="1.5" opacity=".74"/>
      <circle cx="70" cy="38" r="5" fill="#624937"/><circle cx="210" cy="38" r="5" fill="#624937"/>
    </g>
    <g id="${id}-cord" fill="none" stroke-linecap="round">
      <path d="M70 37Q92 7 140 7T210 37" stroke="#6c5140" stroke-width="5"/>
      <path d="M70 35Q95 8 140 8T210 35" stroke="#b59470" stroke-width="1.8"/>
    </g>
  </g>`;
}

// The contact point at the bottom of the stamp is local (0, 0).
export function sealStamp({id: name}) {
  const id = partId(name);
  return `<g id="${id}" stroke-linejoin="round">
    <path d="M-73-48L-56-68H49L73-50V-15L57 0H-59L-73-14Z" fill="#935647" stroke="#624339" stroke-width="2.6"/>
    <path d="M54-43L73-50V-15L57 0H46Z" fill="#674237"/>
    <path d="M-73-48L-56-68H49L73-50L54-35H-56Z" fill="#b17857" stroke="#624339" stroke-width="2.6"/>
    <path d="M-72-18L-58-9H47L70-24M-57-41L54-40" fill="none" stroke="#e6b389" stroke-width="2.2"/>
    <path d="M-57-9H47L68-22V-15L57 0H-59L-72-13V-18Z" fill="#8f3f38"/>
    <path d="M-24-51V-76C-24-90-45-98-45-121C-45-144-27-156 0-156C28-156 44-144 44-121C44-98 25-91 25-76V-51Z" fill="#a06b51" stroke="#624339" stroke-width="2.7"/>
    <path d="M6-153Q39-143 34-119Q32-102 14-91V-53H25V-76C25-91 44-98 44-121Q46-148 6-153Z" fill="#7c4d3f"/>
    <path d="M-37-126Q-24-151 9-147Q-14-140-26-121M-16-75V-59" fill="none" stroke="#d0a07a" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

export function woodBox({id: name}) {
  const id = partId(name);
  return `<g id="${id}" stroke-linejoin="round">
    <path d="M26 158L225 160L270 119L258 141L231 174L27 173Z" fill="#503a2e" opacity=".17"/>
    <g id="${id}-body">
      <path d="M18 61L67 32H265L216 71Z" fill="#5c4636" stroke="#654932" stroke-width="2.5"/>
      <path d="M30 61L70 39H249L213 65Z" fill="#41352c" stroke="#9e7753" stroke-width="2"/>
      <path d="M18 61L216 71V163L20 154Z" fill="#b78a60" stroke="#654932" stroke-width="2.5"/>
      <path d="M216 71L265 32L262 122L216 163Z" fill="#8a6247" stroke="#654932" stroke-width="2.5"/>
      <path d="M20 87L215 96L264 57M20 112L215 122L263 82M20 137L215 146L262 106" fill="none" stroke="#795339" stroke-width="2"/>
      <path d="M36 70V155L25 155L24 68ZM201 76V161L212 162V77Z" fill="#caa376" stroke="#8a6247" stroke-width="1.8"/>
      <path d="M40 76L197 83M40 119L197 126M222 82L257 54" fill="none" stroke="#e0b688" stroke-width="1.8" opacity=".82"/>
      <path d="M105 85L130 86V110L106 109Z" fill="#8f7050" stroke="#654932" stroke-width="1.8"/>
      <circle cx="117" cy="99" r="2.5" fill="#473729"/>
    </g>
    <g transform="translate(67 32)">
      <g id="${id}-lid">
        <path d="M-52 27L-5-5H199L151 37Z" fill="#d4aa7a" stroke="#654932" stroke-width="2.4"/>
        <path d="M-52 27L151 37L199-5V6L151 48L-52 38Z" fill="#98704e" stroke="#654932" stroke-width="2.4"/>
        <path d="M-39 19L159 27M-26 10L171 17M-13 1L185 8" fill="none" stroke="#a67952" stroke-width="1.8"/>
        <path d="M-47 25L148 34L193-3" fill="none" stroke="#eed2a8" stroke-width="2"/>
      </g>
    </g>
  </g>`;
}
