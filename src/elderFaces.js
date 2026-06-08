// Elder portrait faces for the Council of 5.
//
// Source art was a 4×4 expression sheet per elder (with printed labels); we
// cropped clean, label-free face tiles for the three expressions the council
// uses. Each elder's avatar wears the expression matching its stance.
//
// Character → elder mapping is encoded in the filenames; to re-map an elder,
// regenerate the *-{neutral,agree,skeptical}.png tiles from a different sheet.
import marcusNeutral from './assets/elders/marcus-neutral.png';
import marcusAgree from './assets/elders/marcus-agree.png';
import marcusDisagree from './assets/elders/marcus-disagree.png';
import lyraNeutral from './assets/elders/lyra-neutral.png';
import lyraAgree from './assets/elders/lyra-agree.png';
import lyraDisagree from './assets/elders/lyra-disagree.png';
import zenoNeutral from './assets/elders/zeno-neutral.png';
import zenoAgree from './assets/elders/zeno-agree.png';
import zenoDisagree from './assets/elders/zeno-disagree.png';
import ariaNeutral from './assets/elders/aria-neutral.png';
import ariaAgree from './assets/elders/aria-agree.png';
import ariaDisagree from './assets/elders/aria-disagree.png';
import rexNeutral from './assets/elders/rex-neutral.png';
import rexAgree from './assets/elders/rex-agree.png';
import rexDisagree from './assets/elders/rex-disagree.png';

const FACES = {
  Marcus: { neutral: marcusNeutral, agree: marcusAgree, disagree: marcusDisagree },
  Lyra: { neutral: lyraNeutral, agree: lyraAgree, disagree: lyraDisagree },
  Zeno: { neutral: zenoNeutral, agree: zenoAgree, disagree: zenoDisagree },
  Aria: { neutral: ariaNeutral, agree: ariaAgree, disagree: ariaDisagree },
  Rex: { neutral: rexNeutral, agree: rexAgree, disagree: rexDisagree },
};

// Council stance (pass-2) → which face the elder wears.
const STANCE_EXPR = { agrees: 'agree', challenges: 'disagree', neutral: 'neutral' };
export const exprForStance = (stance) => STANCE_EXPR[stance] || 'neutral';

// Inline style for an avatar showing the elder's face at a given expression.
export function faceStyle(elder, expr = 'neutral', size = 64) {
  const set = FACES[elder] || {};
  const src = set[expr] || set.neutral;
  return {
    width: size,
    height: size,
    backgroundImage: src ? `url(${src})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}
