import {assetRecords} from '../../../runtime-config.mjs';
import { OPENER_AUDIO_ASSETS } from "../../episode-opener/audio/sources.mjs";

export const AUDIO = Object.freeze(assetRecords({
  rushOne: Object.freeze({
    file: "packages/templates/opposed-opener/audio/rush-one.wav",
    sha256: "e1578edae77e13c2aecbf0c9c95fb4256b2e1fd39075ce4a07ce76b911849e20",
    durationFrames: 20
  }),
  rushTwo: Object.freeze({
    file: "packages/templates/opposed-opener/audio/rush-two.wav",
    sha256: "d9559db44f5092398990d964fa5a2091ab6d19a401cb63a5d8979b3aa36e6fb7",
    durationFrames: 24
  }),
  gear: OPENER_AUDIO_ASSETS.stripsImpact,
  releaseAir: OPENER_AUDIO_ASSETS.exitReveal,
  music: OPENER_AUDIO_ASSETS.backgroundBed
}));
