import {assetRecords} from '../../../runtime-config.mjs';
export const AUDIO = Object.freeze(assetRecords({
  "music": {
    "file": "packages/templates/crossfire-opener/audio/background-bed.wav",
    "sha256": "f197058f33b1b3a0bb3593c9e7eda8221e1e1eeb626b19960ccc795d79b35a00"
  },
  "cut": {
    "file": "packages/templates/crossfire-opener/audio/ember-cut.wav",
    "sha256": "bc765f70299d1165273af519e193a7d868eebd9077c238ccb3b970c44f7d1e7f"
  },
  "lock": {
    "file": "packages/templates/crossfire-opener/audio/ember-lock.wav",
    "sha256": "3ad972d2517470c203ec2df085affcaed14dc1272f4b017e54942144d605bf31"
  },
  "release": {
    "file": "packages/templates/crossfire-opener/audio/ember-release.wav",
    "sha256": "2f145f5376b0d3e79bf437d3296fb64dbdc7da530ba76bf98def6451716daaba"
  }
}));

const originalMusicSource = Object.freeze({
  provider: "DOVA-SYNDROME",
  name: "沈黙",
  creator: "のる",
  sourceUrl: "https://opentracks.com/bgm/detail/22485",
  license: "DOVA-SYNDROME 音源利用ライセンス",
  licenseUrl: "https://dova-s.jp/help/articles/license/",
  sourceSha256: "727f2251e335692744fa1c65f45e5978bf531c842cc5d86f07e0b8072abe1333"
});

export const MUSIC_SOURCE = AUDIO.music.file.startsWith('local-media/private-assets/') ? originalMusicSource : Object.freeze({provider:'Project',name:'Silent placeholder',license:'MIT',sourceSha256:AUDIO.music.sha256});
