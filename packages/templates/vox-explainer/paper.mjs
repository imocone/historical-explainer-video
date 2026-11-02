const contour = vertices => {
  const points = [];
  vertices.forEach((a, edge) => {
    const b = vertices[(edge + 1) % vertices.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (!length) throw new Error('纸面轮廓相邻顶点不能重合');
    const count = Math.ceil(length / 18);
    for (let i = 0; i < count; i++) {
      const t = i / count, fade = Math.min(1, t * length / 18, (1 - t) * length / 18);
      const n = fade * (.65 * Math.sin(i * 1.73 + edge * 2.1) + .4 * Math.sin(i * .63 + edge * .91));
      points.push([a[0] + dx * t - dy / length * n, a[1] + dy * t + dx / length * n]);
    }
  });
  return 'M' + points.map(point => point.map(value => value.toFixed(2)).join(' ')).join('L') + 'Z';
};

// 在制作时生成固定纸面；顶点不抖动，可作为窗口连接点。
export function paperSurface({id, vertices}) {
  if (typeof id !== 'string' || !/^[A-Za-z][\w-]*$/.test(id))
    throw new Error('纸面id须以字母开头，只含字母、数字、下划线或连字符');
  if (!Array.isArray(vertices) || vertices.length < 3
    || vertices.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))
    throw new Error('纸面轮廓至少需要三个有限坐标点，末尾不重复起点');
  const d = contour(vertices), xs = vertices.map(point => point[0]), ys = vertices.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y;
  if (!width || !height) throw new Error('纸面轮廓须有宽度和高度');
  return `<g id="${id}-paper"><defs>
<clipPath id="${id}-clip"><path d="${d}"/></clipPath>
<filter id="${id}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".32 .48" numOctaves="3" seed="19"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".075"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter>
<linearGradient id="${id}-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--paper)" stop-opacity=".18"/><stop offset="1" stop-color="var(--ink)" stop-opacity=".06"/></linearGradient>
</defs>
<path d="${d}" transform="translate(.8 1.8)" fill="var(--contour, var(--ink))" opacity=".28" style="filter:drop-shadow(1px 3px 3px #00000024)"/>
<path id="${id}-edge" d="${d}" fill="var(--paper)"/>
<g clip-path="url(#${id}-clip)"><rect x="${x - 4}" y="${y - 4}" width="${width + 8}" height="${height + 8}" fill="var(--paper)" filter="url(#${id}-grain)"/><path d="${d}" fill="url(#${id}-light)"/></g>
<path d="${d}" fill="none" stroke="var(--contour, var(--ink))" stroke-opacity=".32" stroke-width=".8"/>
</g>`;
}
