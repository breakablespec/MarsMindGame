// Entry gate: log in with an X handle, then complete 4 quests (+1000 each) to unlock the game.

import { CONFIG } from '../account/config';
import { QUESTS, account, fmt, login, logout, openQuest, questDone, questWait, questsComplete, questsDoneCount, tickQuests, validHandle } from '../account/account';
import { h } from './dom';

const X_LOGO = '𝕏';
const ICON: Record<string, string> = { follow: '＋', like: '♥', rt: '⇄', reply: '💬' };

export function loginScreen(o: { onDone: () => void; onBack: () => void; sound: (n: string) => void }): HTMLElement {
  const input = h('input', { type: 'text', placeholder: '@yourhandle', maxlength: '16', 'aria-label': 'Your X handle', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const err = h('div', { class: 'gerr' });
  const form = h('div', { class: 'gform', hidden: true }, h('div', { class: 'grow2' }, input, h('button', { class: 'btn orange', type: 'button', onclick: () => go() }, 'CONTINUE')), err);
  const go = () => {
    if (!validHandle(input.value)) { err.textContent = 'Enter your X handle, e.g. @marsfan'; o.sound('error'); return; }
    login(input.value); o.sound('core'); o.onDone();
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
  const xbtn = h('button', { class: 'btn big xbtn', type: 'button', onclick: () => { xbtn.hidden = true; form.hidden = false; setTimeout(() => input.focus(), 30); } }, h('span', { class: 'xl' }, X_LOGO), 'LOG IN WITH X');
  return h('div', { class: 'title gate' }, h('div', { class: 'titlecard gcard' },
    h('div', { class: 'brand' }, 'MARS MIND', h('span', { class: 'chip core' }, '● ACCESS')),
    h('h2', null, 'Join the colony'),
    h('p', { class: 'sub' }, `Log in, complete 4 quests, earn ${fmt(CONFIG.questReward * QUESTS.length)} ${CONFIG.currency}.`),
    xbtn, form,
    h('button', { class: 'btn small ghost', type: 'button', style: 'color:var(--paper2);justify-self:start', onclick: o.onBack }, '← BACK')));
}

export function questScreen(o: { onDone: () => void; onBack: () => void; sound: (n: string) => void; toast: (m: string, k: 'good') => void }): HTMLElement {
  const a = account()!;
  const list = h('div', { class: 'quests' });
  const head = h('div', { class: 'qhead' });
  const enter = h('button', { class: 'btn big orange', type: 'button', onclick: () => { if (questsComplete()) o.onDone(); } }, 'ENTER COLONY');
  const root = h('div', { class: 'title gate' }, h('div', { class: 'titlecard gcard' },
    h('div', { class: 'brand' }, 'MARS MIND', h('span', { class: 'chip core' }, `● @${a.handle}`)),
    head, list, enter,
    h('div', { class: 'row' },
      h('button', { class: 'btn small ghost', type: 'button', style: 'color:var(--paper2)', onclick: o.onBack }, '← BACK'),
      h('button', { class: 'btn small ghost', type: 'button', style: 'color:var(--paper2)', onclick: () => { logout(); o.onBack(); } }, 'NOT YOU?'))));
  let key = '';
  const render = () => {
    const done = questsDoneCount();
    const k = `${done}:${QUESTS.map((q) => `${questDone(q.id)}${Math.ceil(questWait(q.id))}${account()?.quests[q.id]?.openedAt ? 1 : 0}`).join()}:${account()?.tokens}`;
    if (k === key) return; key = k;
    head.replaceChildren(
      h('h2', null, done === QUESTS.length ? 'Access granted' : 'Unlock the game'),
      h('div', { class: 'qbar' }, h('i', { style: `width:${(done / QUESTS.length) * 100}%` }), h('span', null, `${done}/${QUESTS.length}`)),
      h('div', { class: 'bal' }, h('b', null, fmt(account()?.tokens ?? 0)), ` ${CONFIG.currency}`));
    list.replaceChildren(...QUESTS.map((q) => {
      const isDone = questDone(q.id), wait = questWait(q.id), opened = !!account()?.quests[q.id]?.openedAt;
      const action = isDone ? h('span', { class: 'qok' }, '✓')
        : opened ? h('span', { class: 'qwait' }, `${Math.ceil(wait)}s`)
          : h('a', { class: 'btn small green', href: q.url(), target: '_blank', rel: 'noopener noreferrer', onclick: () => { openQuest(q.id); o.sound('click'); render(); } }, 'GO');
      return h('div', { class: `quest ${isDone ? 'done' : ''}` }, h('span', { class: 'qi' }, ICON[q.id]), h('span', { class: 'qt' }, q.title), h('span', { class: 'qr' }, `+${fmt(CONFIG.questReward)}`), action);
    }));
    (enter as HTMLButtonElement).disabled = done < QUESTS.length;
  };
  render();
  const iv = window.setInterval(() => {
    if (!root.isConnected) { clearInterval(iv); return; }
    for (const id of tickQuests()) { o.sound('done'); o.toast(`+${fmt(CONFIG.questReward)} ${CONFIG.currency} · ${QUESTS.find((q) => q.id === id)!.short}`, 'good'); }
    render();
  }, 250);
  return root;
}
