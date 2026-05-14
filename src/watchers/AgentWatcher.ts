import { ConversationTurn } from '../types';

export type TurnCallback = (turn: Omit<ConversationTurn, 'seq'>) => void;

export interface AgentWatcher {
  readonly agentId: string;
  isAvailable(): Promise<boolean>;
  start(workspaceRoot: string, onTurn: TurnCallback): void;
  stop(workspaceRoot: string): void;
  dispose(): void;
}
