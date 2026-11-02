# 原创参考图生成与修正记录

两张正式参考使用内置image_gen生成与修正，按大刘明确许可仅缩放至1536×864后放入包内。此页保存创作记录，不是运行规则；正式画法只由style.json与公共编译器表达。

公开调研参考：[愈心的即梦夜市作品](https://jimeng.jianying.com/ai-tool/work-detail/7669266665212841242?workDetailType=Image&itemType=9)。仅借鉴画法，未分发该作品。原v1样图偏向写实材质与摄影虚化；本轮直接对照原截图重画植物研究室，用户确认“更接近了，按这条继续”，随后统一前景材质与城市黄昏绘制。原始生成图保留在本会话generated_images。

## 同场景画法校准

原始输出：exec-e9f0cc4c-070d-42fe-a07e-8aba1e42da2b.png。输入为用户夜市截图（主要画法参考）和原植物研究室（仅内容与构图）。这是方向校准小样，后经前景材质修正形成下述正式主参考。

```text
Use case: style-transfer. Create one 16:9 revised botanical laboratory illustration.
INPUT 1 is the user's PRIMARY STYLE reference: a Jimeng browser screenshot. Use ONLY the actual tall night-market artwork in its centre; ignore and exclude every part of the browser interface, lettering, buttons and margins.
INPUT 2 is the EDIT TARGET and supplies only the laboratory content, people, object placement and framing. Repaint the whole laboratory in the drawing and painting language of the night-market artwork. Keep its current two adult researchers, their actions, clothing colours, specimen sheets, fern, magnifier, notebook, glass jar, wood table, shelving, plants and daylight windows. Keep the same camera and composition so the change is a direct comparison of drawing technique, not a new scene.

The essential correction is the illustration finish. In the source market artwork, convincing detail is built from deliberately drawn edges, shaped colour areas, abbreviated painted material marks and readable groups of light and shadow. Keep that visibly drawn two-dimensional finish across people, objects and background. Use selective dark coloured contours of natural weight, a clear but restrained hand-drawn line structure, broad designed shadows and economical painted accents. Preserve the source's rich, crafted environment and atmospheric colour relationships. Do not reduce it to a vector poster, a clean-line educational comic or a simple flat cartoon. Do not use thick uniform black outlines or coarse impasto.

Remove the edit target's photographic surface modelling: no lens depth-of-field blur, no realistic wood-grain texture pasted over the table, no individual hair strands, no skin gradients or shiny physically simulated glass and metal. Render faces, hands and clothing with a few purposeful drawn marks and shaped shadow areas rather than soft realistic anatomical modelling. Draw wood, glass, foliage and fabric as convincing illustrated forms with selected painted details. Foreground and background are drawn, not optically blurred.

This remains a sunny daytime research room: daylight and colours belong to that setting. Do not copy the market's night time, lanterns, particles, stalls, architecture or fixed orange-blue grading. No text, no labels, no diagram panels, no watermark, no borders. The result should feel drawn and painted by the same art team as the user's night-market reference.
```

## 正式主参考：白天植物研究室v2

正式文件：[modern-editorial-botanical-day-v2.png](assets/modern-editorial-botanical-day-v2.png)。原始输出：exec-23365313-df47-469c-8f83-700e42076bad.png。输入为用户夜市截图和上面的校准小样。仅修桌面、玻璃和前景绘制质感，保留内容、人物与构图。

```text
Use case: precise-object-edit / style-transfer. Finalize the supplied botanical research-room illustration for the user-approved direction. INPUT 1 is the user's night-market artwork inside a browser screenshot, PRIMARY STYLE reference only: ignore all webpage UI. INPUT 2 is the edit target, the latest improved hand-drawn laboratory image.

Keep the edit target's complete composition, two researchers, identities, poses, clothing, specimen work, table, fern sheets, magnifier, notebook, glass jar, shelves, room and daylight unchanged. Preserve the improved two-dimensional drawn contours, broad shaped shadows and selective painted detail throughout the people and background.

Make one focused finish correction to the foreground: unify the tabletop, glass jar, cloth, books and foreground foliage with the existing hand-drawn illustration language. The tabletop is painted wood with a few broad directional marks and grouped areas of light, not photographic grain or intricate streaks of specular gloss. The transparent jar is drawn with a clear contour, a simple visible stem and water line, a few designed pale highlight strokes and restrained broad reflected colour; remove tiny realistic refractions, detailed reflected room patterns and intricate glossy modelling. Retain transparency and recognisable glass. Render the cloth and foreground plants with selected clear shapes and painted marks, removing optical focus blur; near/far separation comes from colour, overlap and simplified detail, not lens blur.

Keep the current sunny light and rich but controlled illustrated colour. Do not change the characters, reframe the room, add props, flatten all shading, add thick black outlines, make rough impasto or imitate a photograph. No text, labels, interface, border or watermark. One full-bleed 16:9 finished original illustration, ideally 1536 by 864 pixels.
```

## 正式补充参考：城市黄昏v2

正式文件：[modern-editorial-city-dusk-v2.png](assets/modern-editorial-city-dusk-v2.png)。原始输出：exec-6b1f8b59-bf37-4980-a71d-c8f6a0bc50b0.png。输入为用户夜市截图、修正后的植物研究室和原城市黄昏（仅内容与构图）。

```text
Use case: style-transfer. Repaint the existing 16:9 light-rail maintenance scene in the user's selected hand-drawn two-dimensional scene-illustration style.
INPUT 1: PRIMARY original style reference, the night-market artwork in the centre of the browser screenshot; exclude all browser UI and lettering.
INPUT 2: the newly refined botanical-room illustration, reference for the approved drawing and painted finish only.
INPUT 3: EDIT TARGET, the previous urban dusk scene; use its content and composition only, not its glossy or blurred finish.

Preserve the edit target's full connected rail-stop space, camera position, two adult technicians, mature proportions, identities, orange vest and dark work clothing, the woman's work on the open cabinet, the man's notebook, waiting passengers, rail vehicle, tracks, street, trees, ordinary shops and blue-hour dusk. Keep this evening's coherent cool ambient light and warm lamps. Do not copy the botanical-room setting or the market's lanterns and stalls.

Repaint every part into the same clearly drawn and painted image language as the style references: naturally varying dark coloured structural contours, economical facial marks, hair shape groups, designed broad clothing shadows, selective painted material detail, grouped environmental light and shadow, rich connected background drawing. Use drawn colour planes for pavement, vehicle metal, glass, foliage and cabinets; reflections are a few designed painted shapes, not simulated photographic surface textures. The technical equipment remains identifiable, but labels and tiny wiring details are abbreviated. Remove photographic depth-of-field blur everywhere, including the left foreground foliage and equipment; depth comes from perspective, overlap, colour and reduced distant detail. Retain atmosphere through painted colour, not lens blur.

Keep the overall drawing expressive and detailed enough to be the same art team as the source market, without turning it into a flat vector poster, thick black cartoon outlines, clean-line instructional comic or coarse impasto. No text, signs with readable lettering, diagrams, panels, logos, borders, particles or watermark. One finished full-bleed 16:9 raster illustration, ideally 1536 by 864 pixels.
```
