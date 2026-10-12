import './styles.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const game = new Game(canvas, uiRoot);
(window as unknown as { __derby: Game }).__derby = game;

game.init().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `Couldn’t start the game<small>${String(err?.message ?? err)}</small>`;
  uiRoot.appendChild(el);
});
