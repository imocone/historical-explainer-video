import {assetRecords} from '../../../runtime-config.mjs';
export const OPENER_AUDIO_ASSETS = Object.freeze(assetRecords({
  openingFlash: Object.freeze({
    file: "packages/templates/episode-opener/audio/opening-flash.wav",
    sha256: "c21e96ade5cfbfa7f3a0618acbfa3720698516ffe0cefa71d220ec7fa89dcad3",
    durationFrames: 10
  }),
  cutOne: Object.freeze({
    file: "packages/templates/episode-opener/audio/cut-one.wav",
    sha256: "289de550090dc22d5dafae8722077ac631b0ffccb97cad3cb0fac8568242e776",
    durationFrames: 20
  }),
  cutTwo: Object.freeze({
    file: "packages/templates/episode-opener/audio/cut-two.wav",
    sha256: "1b3f889bb7454e597198e972352946c36f1e831c22958bd55473b43373eb994a",
    durationFrames: 24
  }),
  stripsPass: Object.freeze({
    file: "packages/templates/episode-opener/audio/strips-pass.wav",
    sha256: "9ee6a5de5ba8d725624b748bebd51dbe728cc358723ff469ba37e2e47407ab88",
    durationFrames: 28
  }),
  stripsImpact: Object.freeze({
    file: "packages/templates/episode-opener/audio/strips-impact.wav",
    sha256: "604641a47bbd61fdfaa12105ec072be280907341f6e186178123637cb40c198d",
    durationFrames: 14
  }),
  stripsInertia: Object.freeze({
    file: "packages/templates/episode-opener/audio/strips-inertia.wav",
    sha256: "dc95cde2ac7fa3e1c4ae7ebf48b08489cf8b505a04765ac73f6c84a33ab93575",
    durationFrames: 86
  }),
  exitReveal: Object.freeze({
    file: "packages/templates/episode-opener/audio/exit-reveal.wav",
    sha256: "012f9958028ef2637052bb9119c2a09abe5b9446b5f80919f8869a3953a1ae13",
    durationFrames: 29
  }),
  exitRevealExtended: Object.freeze({
    file: "packages/templates/episode-opener/audio/exit-reveal-extended.wav",
    sha256: "5fe8f78f863b8a4b412f9f896bf8a8e3b8f233ca410ae190073c044a97c489b1",
    durationFrames: 46
  }),
  backgroundBed: Object.freeze({
    file: "packages/templates/episode-opener/audio/background-bed.wav",
    sha256: "f197058f33b1b3a0bb3593c9e7eda8221e1e1eeb626b19960ccc795d79b35a00",
    durationFrames: 900
  })
}));

const originalSources = [
  {
    provider: "Mixkit",
    license: "Mixkit Sound Effects Free License",
    licenseUrl: "https://mixkit.co/license/",
    sourceId: "1482",
    name: "Ending wind swoosh",
    downloadUrl: "https://assets.mixkit.co/active_storage/sfx/1482/1482.wav",
    sourceSha256: "eeee9e9a55d230ed1802d49f3d702e503016d9a47a25b273c87077926e4ee79a",
    usedBy: ["cut-two.wav", "exit-reveal.wav", "exit-reveal-extended.wav"]
  },
  {
    provider: "Mixkit",
    license: "Mixkit Sound Effects Free License",
    licenseUrl: "https://mixkit.co/license/",
    sourceId: "1530",
    name: "Paper slide",
    downloadUrl: "https://assets.mixkit.co/active_storage/sfx/1530/1530.wav",
    sourceSha256: "2e945267f56208884153867d062838888e6bddc92b512e130aa9566255ad36bb",
    usedBy: ["opening-flash.wav", "cut-one.wav", "cut-two.wav"]
  },
  {
    provider: "Mixkit",
    license: "Mixkit Sound Effects Free License",
    licenseUrl: "https://mixkit.co/license/",
    sourceId: "2858",
    name: "Gear metallic lock sound",
    downloadUrl: "https://assets.mixkit.co/active_storage/sfx/2858/2858.wav",
    sourceSha256: "8255e8de6596d6ca3d243df7c7817c341dc31de8c398a4b2ad04d224c9586246",
    usedBy: ["strips-pass.wav"]
  },
  {
    provider: "Mixkit",
    license: "Mixkit Sound Effects Free License",
    licenseUrl: "https://mixkit.co/license/",
    sourceId: "2857",
    name: "Gear fast lock tap",
    downloadUrl: "https://assets.mixkit.co/active_storage/sfx/2857/2857.wav",
    sourceSha256: "c05e7e46c1d5b9d18e9fe64161d1cc567ebfcfc2674959b6e3dd4947904cc2af",
    usedBy: ["strips-impact.wav", "strips-inertia.wav"]
  },
  {
    provider: "DOVA-SYNDROME",
    license: "DOVA-SYNDROME 音源利用ライセンス",
    licenseUrl: "https://dova-s.jp/help/articles/license/",
    sourceId: "22485",
    name: "沈黙",
    creator: "のる",
    downloadUrl: "https://dova-s.jp/bgm/detail/22485",
    sourceSha256: "727f2251e335692744fa1c65f45e5978bf531c842cc5d86f07e0b8072abe1333",
    usedBy: ["background-bed.wav"]
  }
];

export const OPENER_AUDIO_SOURCES = Object.freeze([
 ...originalSources.map(source=>({...source,usedBy:source.usedBy.filter(name=>Object.values(OPENER_AUDIO_ASSETS).some(asset=>asset.file.startsWith('local-media/private-assets/')&&asset.file.endsWith('/'+name)))})).filter(source=>source.usedBy.length),
 ...(Object.values(OPENER_AUDIO_ASSETS).some(asset=>!asset.file.startsWith('local-media/private-assets/'))?[{provider:'Project',name:'Silent placeholders',license:'MIT',usedBy:Object.values(OPENER_AUDIO_ASSETS).filter(asset=>!asset.file.startsWith('local-media/private-assets/')).map(asset=>asset.file.split('/').at(-1))}]:[])
]);
