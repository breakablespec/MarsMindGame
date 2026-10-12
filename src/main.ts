import { Game } from './engine/game';
import * as sim from './sim/tick';

async function start() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('8px Silkscreen'), document.fonts.load('20px VT323'), document.fonts.load('16px "Pixelify Sans"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch { /* fonts are optional */ }
  const game = new Game(document.getElementById('app')!);
  (window as unknown as { __game: Game; __sim: typeof sim }).__game = game;
  (window as unknown as { __sim: typeof sim }).__sim = sim;
  const params = new URLSearchParams(location.search);
  await game.boot(params.has('skip'));
}
void start();
