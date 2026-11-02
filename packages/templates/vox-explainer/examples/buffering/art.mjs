const perforations = Array.from({length: 6}, (_, i) =>
  `<rect x="${-66 + i * 24}" y="-64" width="14" height="10" rx="2"/><rect x="${-66 + i * 24}" y="54" width="14" height="10" rx="2"/>`).join('');

export const tile = (id, number = 1) => `<g id="${id}">
  <path d="M-83-73L84-71L86 72L-85 74Z" fill="#243b37" stroke="#172d2a" stroke-width="4"/>
  <path d="M-77 74L84 72L88 79L-76 82Z" fill="#111f1e"/>
  <g fill="#e7dfce">${perforations}</g>
  <rect x="-75" y="-44" width="150" height="88" rx="2" fill="#bfd1bf"/>
  <circle cx="47" cy="-20" r="15" fill="#ecd79d"/>
  <path d="M-75 28L-30-29L15 25L43 0L75 33V44H-75Z" fill="#63826f"/>
  <path d="M-75 36Q-21 7 20 32T75 31V44H-75Z" fill="#36584b"/>
  <path d="M-75 42Q-6 16 75 40" fill="none" stroke="#d2b78b" stroke-width="9"/>
  <g transform="translate(-9 17)" stroke="#263b35" stroke-width="2.7" fill="none">
    <circle cx="-15" cy="9" r="8"/><circle cx="15" cy="9" r="8"/>
    <path d="M-15 9L-8-6L3 9H-15M-8-6H10L15 9M3 9L10-6" stroke="#c96b4e"/>
    <path d="M-6-7L-2-22L7-13L10-6" stroke="#e4b277" stroke-width="5"/>
    <circle cx="0" cy="-29" r="5" fill="#e6bb91" stroke="none"/>
  </g>
  <text class="tile-number" x="60" y="35" text-anchor="end" fill="#fff1d6" font-size="30" font-family="var(--font-title)">${String(number).padStart(2, '0')}</text>
</g>`;

function spokes(x, name) {
  return `<g class="${name}" transform="translate(${x} 28)"><circle r="37" fill="#dacbab" stroke="#273a35" stroke-width="9"/><circle r="29" fill="none" stroke="#f4ead6" stroke-width="4"/>${Array.from({length: 6}, (_, i) => `<path d="M0 0L${Math.cos(i * Math.PI / 3) * 28} ${Math.sin(i * Math.PI / 3) * 28}" stroke="#697b66" stroke-width="2.4"/>`).join('')}<circle r="5" fill="#273a35"/></g>`;
}

export function movie(id) {
  return `<g id="${id}">
    <ellipse cx="0" cy="183" rx="306" ry="20" fill="#122a24" opacity=".16"/>
    <path d="M-314-194L313-190L321 174L-311 180Z" fill="#172f2a" stroke="#142720" stroke-width="8"/>
    <path d="M-311 180L321 174L308 193L-299 198Z" fill="#10201c"/>
    <g clip-path="url(#${id}-clip)">
      <rect x="-300" y="-180" width="600" height="348" fill="#c6d8c7"/>
      <circle cx="166" cy="-83" r="61" fill="#edd49c"/>
      <path d="M-330 54L-188-133L-97-19L-5-100L130 60L210-39L340 70V180H-330Z" fill="#91a48b"/>
      <path d="M-188-133L-208-88L-184-96L-171-78L-155-89Z M-5-100L-26-57L-6-68L14-47L18-70Z" fill="#e4e0c9"/>
      <g class="far-land"><path d="M-710 100Q-559-40-420 60T-130 50T160 60T450 36T740 90V180H-710Z" fill="#617e64"/>
      <path d="M-710 147Q-555 34-409 113T-120 106T160 123T450 111T740 140V180H-710Z" fill="#405e48"/></g>
      <g class="trees">${Array.from({length: 11}, (_, i) => { const x = -500 + i * 113, y = 108 + (i % 3) * 9, s = .7 + (i % 4) * .13; return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-91L-26-44H-16L-36-10H36L17-44H27Z" fill="${i % 2 ? '#294d3c' : '#365a41'}" stroke="#284937" stroke-width="3"/><path d="M0-16V13" stroke="#6d5a40" stroke-width="8"/><path d="M0-81V-21" stroke="#53704c" stroke-width="3"/></g>`; }).join('')}</g>
      <path d="M-320 148Q-80 113 310 141V182H-320Z" fill="#bda77c"/>
      <path d="M-320 155Q-80 120 310 148" fill="none" stroke="#e0cca3" stroke-width="12"/>
      <g class="road-marks">${Array.from({length: 12}, (_, i) => `<path d="M${-450 + i * 85} 165h24" stroke="#7f765b" stroke-width="3"/>`).join('')}</g>
      <g class="bicycle" transform="translate(0 90)">
        <ellipse cx="0" cy="70" rx="105" ry="11" fill="#435443" opacity=".25"/>
        ${spokes(-68, 'wheel-back')}${spokes(68, 'wheel-front')}
        <path d="M-68 28L-34-38L11 28H-68M-34-38H42L68 28M11 28L42-38L37-59H61" fill="none" stroke="#24362f" stroke-width="13" stroke-linejoin="round"/>
        <path d="M-68 28L-34-38L11 28H-68M-34-38H42L68 28M11 28L42-38L37-59H61" fill="none" stroke="#bb6547" stroke-width="7" stroke-linejoin="round"/>
        <path d="M-34-38L-38-53M-54-55H-23" fill="none" stroke="#26372e" stroke-width="8" stroke-linecap="round"/>
        <path class="leg-far" d="M-27-76L18-41L11 28" fill="none" stroke="#8f8c71" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M-46-83Q-40-115-10-126L14-107L-13-60Z" fill="#b4593e" stroke="#3d4031" stroke-width="4"/>
        <path d="M-42-85L-18-114L-6-107L-28-69Z" fill="#d07b50"/>
        <path d="M-42-81L-17-66L-26-51L-48-64Z" fill="#ddd0ab" stroke="#444b38" stroke-width="3"/>
        <path class="leg-near" d="M-31-69L-4-18L11 28" fill="none" stroke="#e5d6af" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
        <path class="shoe" d="M5 29L23 31" stroke="#283a32" stroke-width="8" stroke-linecap="round"/>
        <path d="M-5-116L22-89L53-66" fill="none" stroke="#e2b18a" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="M-3-117L14-100" stroke="#c97850" stroke-width="16" stroke-linecap="round"/>
        <path d="M-10-127L0-143" stroke="#d8a37d" stroke-width="15"/>
        <g class="head"><ellipse cx="8" cy="-152" rx="18" ry="21" fill="#e7b78d" stroke="#3b4432" stroke-width="3"/><path d="M-12-155Q-12-181 11-178Q29-178 32-158L11-159L4-146Z" fill="#3d5d51" stroke="#283f33" stroke-width="4"/><path d="M-5-169L22-168" stroke="#7a9477" stroke-width="4"/><circle cx="23" cy="-151" r="2.4" fill="#273d31"/><path d="M22-141L29-143" stroke="#754a34" stroke-width="2"/></g>
        <path class="scarf" d="M-5-134Q-45-133-70-153L-61-128Q-34-117-6-122Z" fill="#e3bb70" stroke="#6e5b3e" stroke-width="3"/>
        <circle cx="11" cy="28" r="8" fill="#293c31"/>
      </g>
    </g>
    <path d="M-297-175L299-176" stroke="#71806b" stroke-width="3" opacity=".7"/>
    <g class="loading"><rect x="-300" y="-180" width="600" height="348" fill="#132c25" opacity=".35"/><circle r="47" fill="#203d32" opacity=".9"/><path class="spinner" d="M0-29A29 29 0 1 1-29 0" fill="none" stroke="#f2dfb4" stroke-width="9" stroke-linecap="round"/></g>
    <defs><clipPath id="${id}-clip"><path d="M-300-180H300V168H-300Z"/></clipPath></defs>
  </g>`;
}

export const markup = `<style>
svg{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}
text{font-family:var(--font-body);font-weight:500;font-variant-numeric:tabular-nums}
.title{font-family:var(--font-title);font-weight:900;letter-spacing:-3px}
.label{font-size:60px;fill:#30443a}
</style>
<svg id="canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
<defs>
  <pattern id="grain" width="139" height="131" patternUnits="userSpaceOnUse"><g stroke="#2d4437" stroke-opacity=".055" stroke-width="2"><path d="M12 18h3M72 31h2M113 91h4M43 117h3M21 73h2M84 71h3M128 11h2"/></g></pattern>
  <linearGradient id="coil-edge" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#8c9c7a"/><stop offset="1" stop-color="#485f48"/></linearGradient>
  <clipPath id="ribbon-crop"><rect x="0" y="0" width="1920" height="820"/></clipPath>
</defs>
<rect id="backdrop" width="1920" height="1080" fill="#e7dfce"/>
<rect width="1920" height="1080" fill="url(#grain)"/>
<path id="ambient-line" d="M-100 764Q440 660 990 730T2020 685" fill="none" stroke="#d5cbb7" stroke-width="4"/>
<g id="world" clip-path="url(#ribbon-crop)">
  <g id="hero-ground"><ellipse cx="1030" cy="749" rx="639" ry="46" fill="#67785b" opacity=".12"/>
    <path d="M376 666L520 513L1497 518L1682 668L1558 741L534 747Z" fill="#a6ac88" stroke="#465640" stroke-width="5"/>
    <path d="M376 666L534 747L1558 741L1682 668L1663 696L1553 772L530 778L388 694Z" fill="#8d7753" stroke="#465640" stroke-width="5"/>
    <path d="M530 778V747L1558 741L1553 772Z" fill="#a48d63"/>
    <path d="M560 756l24 8m55-9l37 9m291-7l24 8m358-12l30 8m88-13l36 9" stroke="#6f654e" stroke-width="4"/>
    <path d="M477 658Q838 576 1593 646" stroke="#d3bd92" stroke-width="58" fill="none"/>
    <path d="M477 655Q838 573 1593 643" stroke="#f0dcaf" stroke-width="7" fill="none"/>
    <g fill="#4d6948" stroke="#344c37" stroke-width="4"><path d="M481 652L454 594L477 604L464 556L501 591L517 578L523 651Z"/><path d="M1579 638L1556 592L1574 602L1584 562L1600 599L1621 582L1614 639Z"/></g>
  </g>
  <g id="coil-shadow"><ellipse cx="818" cy="669" rx="431" ry="37" fill="#495b43" opacity=".15"/></g>
  <g id="coil">
    <path id="coil-depth" d="M213 405C357 405 406 636 619 640L1001 640C1169 640 1205 476 1343 467" fill="none" stroke="#354a39" stroke-width="122" stroke-linecap="round"/>
    <path id="coil-surface" d="M213 391C357 391 406 618 619 622L1001 622C1169 622 1205 458 1343 449" fill="none" stroke="url(#coil-edge)" stroke-width="111" stroke-linecap="round"/>
    <path id="coil-light" d="M213 358C357 358 406 585 619 589L1001 589C1169 589 1205 425 1343 416" fill="none" stroke="#b7bf9c" stroke-width="13" stroke-linecap="round"/>
    <path id="coil-holes" d="M213 415C357 415 406 642 619 646L1001 646C1169 646 1205 482 1343 473" fill="none" stroke="#223d2d" stroke-width="9" stroke-dasharray="10 18"/>
  </g>
  <g id="source"><path d="M-93 36C-139 34-147-20-109-45C-125-95-61-135-24-103C5-149 79-129 90-76C147-80 166-1 119 28C68 57-31 27-93 36Z" fill="#b3c0a6" stroke="#3b5540" stroke-width="6"/><path d="M-106-43Q-75-72-46-49M-25-103Q-13-75-20-60M90-76Q67-72 60-49" fill="none" stroke="#738d6b" stroke-width="5"/><path d="M-60 60L-45 88M4 65V103M66 58L57 88" stroke="#628064" stroke-width="8" stroke-linecap="round"/></g>
  <g id="stream-cards">${Array.from({length:12}, (_,i) => tile(`frame-${i}`, i+1)).join('')}</g>
  <g id="hero-movie">${movie('main-movie')}</g>
  <g id="frame-halo" fill="none" stroke="#ba6046" stroke-width="12"><path d="M-340-225H-300M-340-225V-183M340-225H300M340-225V-183M-340 215H-300M-340 215V173M340 215H300M340 215V173"/></g>
  <g id="top-label"><text class="label" id="source-label" x="194" y="242" text-anchor="middle">网络</text><text class="label" id="player-label" x="1510" y="221" text-anchor="middle">播放</text></g>
  <g id="stock-badge"><path d="M-240-88L231-92L242 83L-235 90Z" fill="#f5ebd4" stroke="#40553b" stroke-width="5"/><text x="0" y="-29" text-anchor="middle" font-size="59" fill="#3e5740">余量</text><text id="stock-value" x="-22" y="66" text-anchor="middle" font-size="103" class="title" fill="#365c44">2.0</text><text x="103" y="65" font-size="58" fill="#3e5740">秒</text></g>
  <g id="network-gap"><path d="M-85 0H85" stroke="#b76448" stroke-width="12" stroke-dasharray="15 20"/><path d="M-28-43L28 43M28-43L-28 43" stroke="#b76448" stroke-width="9" stroke-linecap="round"/><text x="0" y="102" text-anchor="middle" font-size="57" fill="#9f503a">暂时没送来</text></g>
  <g id="rewind-mark"><circle r="160" fill="#e8dcc1" stroke="#a7ad8e" stroke-width="4"/><path d="M-92 57A112 112 0 1 0-104-22" fill="none" stroke="#415c43" stroke-width="15"/><path d="M-137-41L-103-5L-64-40" fill="none" stroke="#415c43" stroke-width="15" stroke-linejoin="round"/><path d="M-6-44L-54-6L-6 32ZM52-44L4-6L52 32Z" fill="#b66447"/></g>
  <g id="comparison">
    <g id="compare-wash"><path d="M89 260L1835 255L1815 486L101 494Z" fill="#dcceba"/><path d="M96 522L1830 515L1824 783L84 776Z" fill="#d0d7bd"/></g>
    <text x="132" y="331" font-size="65" fill="#9e503c" class="title">收到就播</text>
    <text x="132" y="596" font-size="65" fill="#385b42" class="title">先等2秒</text>
    <g id="time-ribbons"></g>
    <path id="compare-clockline" d="M430 290V750" stroke="#6b7961" stroke-width="4" stroke-dasharray="9 12"/>
    <g id="compare-cursor"><path d="M0 0V456" stroke="#ab6247" stroke-width="6"/><path d="M-14 0H14L0 20Z" fill="#ab6247"/></g>
    <g id="compare-top-screen">${movie('top-movie')}</g><g id="compare-bottom-screen">${movie('bottom-movie')}</g>
    <g id="top-stall-tag"><path d="M-89-44L90-47L95 43L-91 47Z" fill="#b75d42"/><text y="21" text-anchor="middle" font-size="57" fill="#f8edda" class="title">卡顿</text></g>
    <g id="bottom-wait-tag"><path d="M-108-44L105-47L112 43L-105 47Z" fill="#788a68"/><text y="21" text-anchor="middle" font-size="53" fill="#fff0d8" class="title">先等待</text></g>
    <text id="compare-time" x="1755" y="228" font-size="48" text-anchor="end" fill="#4c6048">0.0 秒</text>
  </g>
  <g id="wait-clock"><circle r="86" fill="#f3e5c9" stroke="#3d5139" stroke-width="7"/>${Array.from({length:12},(_,i)=>`<path d="M0-69V-59" stroke="#748166" stroke-width="5" transform="rotate(${i*30})"/>`).join('')}<path id="clock-hand" d="M0 12V-54" stroke="#ad6346" stroke-width="10" stroke-linecap="round"/><circle r="8" fill="#3e533c"/><text x="0" y="149" text-anchor="middle" font-size="54" fill="#45593f">开播等待</text></g>
</g>
<g id="opening-type"><text x="130" y="181" font-size="116" class="title" fill="#344d3c">又卡住了。</text><path d="M135 211Q355 222 682 208" fill="none" stroke="#b76244" stroke-width="10" stroke-linecap="round"/></g>
<g id="headline"><text id="headline-text" x="120" y="168" font-size="98" class="title" fill="#324a39"></text></g>
<g id="detail-line"><text id="detail-text" x="122" y="784" font-size="60" fill="#59684d"></text></g>
<g id="final-type"><text x="122" y="173" font-size="116" class="title" fill="#344d3c">流畅，可以攒出来。</text><path d="M718 199Q1000 213 1177 194" stroke="#b86347" stroke-width="11" stroke-linecap="round" fill="none"/></g>
</svg>`;
