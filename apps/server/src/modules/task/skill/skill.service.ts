import { Injectable } from '@nestjs/common';
import {
  type Actor,
  Conflict,
  Database,
  EntityService,
  Idempotency,
  NotFound,
  type Sql,
} from '../../platform';
import { RepoSkillGateway } from './repo-skill.gateway';
import { Skill } from './skill';
import type { ActivateSkillInput, SaveSkillRevisionInput } from './skill.input';
import { SkillRepository } from './skill.repository';
import { SkillFiles } from './skill-files';

// 러너 스킬 쓰기: 콘솔 판 쌓기, 쓸 판 옮기기. 주인만 (write 기기도 안 된다: 스킬은 AI의 지시문이다).
// 고칠 수 있는 것은 저장소의 러너 전용 스킬뿐이다 (cairn-save · cairn-recall은 사람의 AI 도구에 복사해 넣는 스킬이라 서버가 보낼 길이 없다).
@Injectable()
export class SkillService extends EntityService<Skill> {
  private static readonly SAVE = 'save_skill_revision';

  constructor(
    db: Database,
    private readonly repo: RepoSkillGateway,
  ) {
    super(db);
  }

  protected store(tx: Sql): SkillRepository {
    return new SkillRepository(tx);
  }

  /** 새 판을 쌓고 바로 그 판을 쓴다. 같은 requestId가 다시 오면 처음 결과. 본 version이 다르면 409 */
  async saveRevision(actor: Actor, req: SaveSkillRevisionInput): Promise<Skill> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const base = this.runnerSkill(req.name);
    const files = SkillFiles.of(req.name, req.files);
    const now = new Date();
    return this.transaction(async (tx) => {
      const skills = new SkillRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, SkillService.SAVE);
      const before = await once.previous();
      if (before) return skills.load(spaceId, String(before.skillId));
      const found = await skills.lockByName(spaceId, req.name);
      // 콘솔 판이 아직 없으면 화면이 본 version은 0이다
      if (!found && req.version !== 0)
        throw new Conflict('다른 곳에서 먼저 바뀌었어요. 새로 불러온 뒤 다시 해 주세요');
      found?.assertVersion(req.version);
      const skill = found ?? Skill.open(spaceId, req.name, now);
      skill.addRevision(files, base.hash, req.note, now);
      await skills.save(skill);
      await once.remember({ skillId: skill.id });
      return skill;
    });
  }

  /** 쓸 판을 옮긴다 (되돌리기). null이면 저장소 판. 콘솔 판이 하나도 없으면 404 */
  async activate(actor: Actor, req: ActivateSkillInput): Promise<Skill> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    this.runnerSkill(req.name);
    return this.transaction(async (tx) => {
      const skills = new SkillRepository(tx);
      const skill = await skills.lockByName(spaceId, req.name);
      if (!skill) throw new NotFound(`콘솔 버전이 없는 스킬이에요: ${req.name}`);
      skill.assertVersion(req.version);
      skill.activate(req.revision, new Date());
      await skills.save(skill);
      return skill;
    });
  }

  private runnerSkill(name: string): SkillFiles {
    const files = this.repo.get(name);
    if (!files) throw new NotFound(`러너 스킬이 아니에요: ${name}`);
    return files;
  }
}
