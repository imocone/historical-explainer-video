// Standalone demo host; picture and captions use the project's actual consumers.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createRenderer} from '../../render/index.jsx';
import {CaptionLayer} from '../../../../modules/render-video/runtime/captions.jsx';
import {loadSceneFonts} from '../../../../modules/render-video/runtime/scene-view.jsx';

export function mount(data) {
  const captions = createRoot(document.getElementById('captions'));
  let renderer;
  const ready = loadSceneFonts(data.segment.visualStyle).then(async () => {
    renderer = createRenderer({element:document.getElementById('picture'),segment:data.segment});
    await renderer.seek(0);
  });
  window.__hyperframes.registerFrameSource({element:document.getElementById('pulley-film'),ready,
    async render(time) {
      const frame = Math.max(0, Math.min(Math.round(data.duration * 60) - 1, Math.round(time * 60)));
      await renderer.seek(frame);
      flushSync(() => captions.render(<CaptionLayer captions={data.cues}
        visualStyle={data.segment.visualStyle} frame={frame} fps={60}/>));
    },
    dispose() {renderer?.dispose();captions.unmount();}
  });
}
