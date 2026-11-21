// Which library tasks have a simulator (owner: Anaís). A task without one is listed but can't be run here.
import { C172Cockpit } from './c172/cockpit';
import type { Simulator } from './types';

export const SIMULATORS: Record<string, { name: string; create: () => Simulator }> = {
  c172_takeoff: { name: 'Cessna 172 Skyhawk', create: () => new C172Cockpit() },
};
