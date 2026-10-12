// Structured commands: the only thing the parser (or Claude) may produce.

import type { ModuleKind, ResId, RobotKind, TechId, PowerCat } from '../sim/defs';

export type Intent =
  | 'build' | 'mine' | 'move' | 'repair' | 'allocate_power' | 'prioritize' | 'explore'
  | 'transport' | 'research' | 'expand' | 'charge' | 'recall' | 'inspect' | 'prepare'
  | 'optimize' | 'cancel' | 'schedule' | 'produce' | 'build_robot' | 'urgent'
  | 'safety' | 'fix' | 'clean' | 'survive' | 'resume' | 'unknown';
export const INTENTS: Intent[] = ['build', 'mine', 'move', 'repair', 'allocate_power', 'prioritize', 'explore', 'transport', 'research', 'expand', 'charge', 'recall', 'inspect', 'prepare', 'optimize', 'cancel', 'schedule', 'produce', 'build_robot', 'urgent', 'safety', 'fix', 'clean', 'survive', 'resume'];

export type System = 'oxygen' | 'power' | 'research' | 'mining' | 'lighting' | 'production' | 'storage' | 'safety' | 'water' | 'charging' | 'life';
export type Direction = 'north' | 'south' | 'east' | 'west' | 'nearest';

export interface Command {
  intent: Intent;
  module?: ModuleKind;
  count?: number;
  resource?: ResId | 'lowest' | 'all';
  qty?: number;
  robot?: RobotKind;
  robots?: number;
  robotName?: string;
  direction?: Direction;
  near?: ModuleKind | ResId | 'mine' | 'base';
  system?: System;
  over?: System;
  off?: boolean;           // allocate_power: switch off (true) / on (false)
  colonists?: number;
  tech?: TechId;
  schedule?: { minute: number };
  then?: Command;
  question?: string;
  storm?: boolean;          // prepare: storm vs night/cold
}

export const SYSTEM_CAT: Partial<Record<System, PowerCat>> = { oxygen: 'life', life: 'life', research: 'research', lighting: 'lighting', production: 'production', mining: 'production', charging: 'charging' };
