// Font loading is shared; each presentation owns its face and browser identity.
export const visualFontEntries = (visualStyle, scopes = null) => [
  ...Object.entries(visualStyle.shared.fonts).map(([role, font]) => [`shared.${role}`, font]),
  ...Object.entries(visualStyle.p4 ?? {}).flatMap(([scope, style]) =>
    Object.entries(style.fonts ?? {}).map(([role, font]) => [`${scope}.${role}`, font]))
].filter(([role]) => scopes === null || scopes.includes(role.split('.')[0]));

export const withVisualFontPaths = (tokens, visualId) => {
  const fontsFor = (fonts, scope) => Object.fromEntries(Object.entries(fonts).map(([role, font]) => [role, {
    ...font,
    family: scope === 'shared' ? font.family : `${visualId}-${scope}-${role}`,
    publicPath: `visuals/${visualId}/${font.file}`
  }]));
  return {
    ...tokens,
    shared: {...tokens.shared, fonts: fontsFor(tokens.shared.fonts, 'shared')},
    p4: Object.fromEntries(Object.entries(tokens.p4).map(([scope, style]) => [scope,
      style.fonts ? {...style, fonts: fontsFor(style.fonts, scope)} : style]))
  };
};
