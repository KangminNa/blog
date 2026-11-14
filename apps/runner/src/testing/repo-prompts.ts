import { resolve } from 'node:path';
import { PromptPack } from '../prompt-pack';

/** 저장소의 지시문 틀 (skills/cairn-runner). 시험은 실제 판으로 지시문을 본다 */
export const REPO_PROMPTS = PromptPack.read(resolve(__dirname, '../../../../skills'));
